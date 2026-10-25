import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as statusModel from "../src/status-model.ts";
import * as updateModel from "../src/update-model.ts";

// Evaluate the real main module with startup held at Electron's readiness boundary. No CLI,
// filesystem, network, native window, login item or updater can run in this harness.
const source = fs.readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source + `
exports.inspectTray = (status, language, fakeTray) => { last = status; L = STRINGS[language]; tray = fakeTray; render(); };
exports.health = healthy;
`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;

type WindowQuota = { used_percent?: number; window_minutes?: number };
type Fixture = {
  settings: { HTTPS_PROXY?: string }; listen: { host: string; port: number };
  providers: Record<string, { reachable: boolean }>; consecutiveUpstreamFailures: number;
  readiness?: { ready: boolean; problems: string[] };
  chatgpt?: { quota: Record<string, { plan_type?: string; rate_limits?: { primary?: WindowQuota | null; secondary?: WindowQuota | null } } | null> };
};
const good = (): Fixture => ({ settings: { HTTPS_PROXY: "http://127.0.0.1:1" }, listen: { host: "127.0.0.1", port: 1 }, providers: { test: { reachable: true } }, consecutiveUpstreamFailures: 0 });
function harness() {
  const labels: string[] = [];
  let image = "", tooltip = "";
  const forbidden = () => { throw new Error("Unexpected OS, filesystem, CLI or network access"); };
  const fakeTray = {
    setImage: (value: { file: string }) => { image = value.file; },
    setToolTip: (value: string) => { tooltip = value; },
    setContextMenu: (items: { label?: string }[]) => { labels.splice(0, labels.length, ...items.flatMap(item => item.label ? [item.label] : [])); },
  };
  const modules: Record<string, object> = {
    electron: {
      app: { requestSingleInstanceLock: () => true, on() {}, whenReady: () => ({ then() {} }), isPackaged: true, getLoginItemSettings: () => ({ openAtLogin: false }), getPreferredSystemLanguages: () => ["ko"], getSystemLocale: () => "ko", getLocale: () => "ko" },
      Menu: { buildFromTemplate: (items: object[]) => items },
      nativeImage: { createFromPath: (file: string) => ({ file, setTemplateImage() {} }) },
    },
    "node:child_process": { execFile: forbidden }, "node:fs": new Proxy({}, { get: () => forbidden }),
    "node:os": { homedir: forbidden }, "node:path": path,
    "./claude-desktop": { claudeStartedAt: forbidden, reopenClaude: forbidden },
    "./update-model": updateModel, "./status-model": statusModel,
    "./protocol": { registerScheme() {}, ORIGIN: "ripple://app" },
    "./window": { mainWindow: () => null },
  };
  const exports: {
    inspectTray?: (status: Fixture, lang: string, tray: typeof fakeTray) => void;
    health?: (status: Fixture | null) => string;
  } = {};
  runInNewContext(compiled, {
    exports, require: (id: string) => { assert.ok(id in modules, id); return modules[id]; },
    process: { env: { CLAUDERIPPLE_HOME: "/tmp/unused-tray-status" }, platform: process.platform },
    __dirname: "/tmp/unused-tray-status/src", console, fetch: forbidden, setTimeout: forbidden, setInterval: forbidden,
  });
  assert.ok(exports.inspectTray);
  assert.ok(exports.health);
  const inspect = exports.inspectTray;
  return { health: exports.health, render: (status: Fixture, lang = "ko") => { inspect(status, lang, fakeTray); return { labels, image, tooltip }; } };
}

for (const problem of ["picker-ca", "picker-proxy"]) {
  test(`readiness ${problem} failure changes the actual tray headline, icon and tooltip`, () => {
    const app = harness();
    const status = { ...good(), readiness: { ready: false, problems: [problem] } };
    assert.equal(app.health(status), "warn");
    const shown = app.render(status);
    assert.ok(shown.labels.includes("ClaudeRipple · 확인 필요"));
    assert.match(shown.image, /tray(?:Win)?Warn(?:Template)?\.png$/);
    assert.equal(shown.tooltip, "ClaudeRipple warn");
    assert.ok(shown.labels.some(label => label.includes(problem === "picker-ca" ? "인증서 신뢰 필요" : "프록시 설정 필요")));
  });
}

test("readiness is authoritative even if the old heuristic disagrees", () => {
  const app = harness();
  assert.equal(app.health({ ...good(), settings: {}, providers: { native: { reachable: false } }, consecutiveUpstreamFailures: 3, readiness: { ready: true, problems: [] } }), "ok");
  assert.equal(app.health({ ...good(), readiness: { ready: false, problems: [] } }), "warn");
});

test("older servers retain proxy, provider and upstream checks; no answer remains down", () => {
  const { health } = harness();
  assert.equal(health(null), "down");
  assert.equal(health(good()), "ok");
  assert.equal(health({ ...good(), settings: {} }), "warn");
  assert.equal(health({ ...good(), providers: { test: { reachable: false } } }), "warn");
  assert.equal(health({ ...good(), consecutiveUpstreamFailures: 1 }), "warn");
});

function quotaStatus(primary?: WindowQuota | null, secondary?: WindowQuota | null): Fixture {
  return { ...good(), chatgpt: { quota: { test: { plan_type: "plus", rate_limits: { primary, secondary } } } } };
}

test("ChatGPT primary five-hour usage and secondary weekly usage both appear with their real periods", () => {
  const shown = harness().render(quotaStatus({ used_percent: 21, window_minutes: 300 }, { used_percent: 64, window_minutes: 10080 }));
  assert.ok(shown.labels.some(label => label.includes("ChatGPT plus · 5시간 21% · 주간 64%")));
  assert.ok(shown.labels.every(label => !label.includes("이번 주")));
});

test("weekly primary and secondary-only windows do not depend on their slot order", () => {
  const app = harness();
  assert.ok(app.render(quotaStatus({ used_percent: 42, window_minutes: 10080 })).labels.some(label => label.includes("ChatGPT plus · 주간 42%")));
  assert.ok(app.render(quotaStatus(null, { used_percent: 0, window_minutes: 300 })).labels.some(label => label.includes("ChatGPT plus · 5시간 0%")));
});

test("other periods are formatted as minutes, and missing periods are never called weekly", () => {
  const app = harness();
  const minutes = new Intl.NumberFormat("ko", { style: "unit", unit: "minute", unitDisplay: "short" }).format(60);
  assert.ok(app.render(quotaStatus({ used_percent: 8, window_minutes: 60 })).labels.some(label => label.includes(`${minutes} 8%`)));
  assert.ok(app.render(quotaStatus({ used_percent: 9 })).labels.some(label => label.includes("ChatGPT plus · ? 9%")));
  assert.ok(app.render(quotaStatus({}, null)).labels.every(label => !label.includes("ChatGPT plus")));
});

test("all existing tray translations use the five-hour and weekly window labels", () => {
  const expected = { en: ["5h", "weekly"], ko: ["5시간", "주간"], zh: ["5 小时", "每周"], ja: ["5時間", "週間"], es: ["5 h", "semanal"], pt: ["5h", "semanal"] };
  const app = harness();
  for (const [lang, [fiveHour, week]] of Object.entries(expected)) {
    const shown = app.render(quotaStatus({ used_percent: 3, window_minutes: 300 }, { used_percent: 7, window_minutes: 10080 }), lang);
    assert.ok(shown.labels.some(label => label.includes(`ChatGPT plus · ${fiveHour} 3% · ${week} 7%`)), lang);
  }
});
