import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyAppProxy, configLibraryDir, currentAppProxy } from "../src/picker.ts";
import { directOn } from "../src/direct.ts";
import { applyProxyEnv, settingsEnv } from "../src/settings.ts";
import { removeClientIntegrations } from "../src/integrations.ts";
import { plistPath, renderPlist } from "../src/launchd.ts";

function fixture(t: { after(fn: () => void): void }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cr-desktop-legacy-"));
  const before = { ...process.env };
  const home = path.join(root, ".clauderipple");
  const other = path.join(root, "other");
  Object.assign(process.env, { HOME: root, CLAUDE_SETTINGS_PATH: path.join(root, "settings.json"), CLAUDE_APP_SUPPORT: path.join(root, "desktop"), CLAUDERIPPLE_LAUNCH_AGENTS_DIR: path.join(root, "LaunchAgents"), CODEX_HOME: path.join(root, "codex") });
  t.after(() => { process.env = before; fs.rmSync(root, { recursive: true, force: true }); });
  fs.mkdirSync(home);
  fs.writeFileSync(path.join(home, "config.json"), JSON.stringify({ listen: { host: "127.0.0.1", port: 18791 } }));
  const url = "http://127.0.0.1:18791";
  fs.mkdirSync(configLibraryDir(), { recursive: true });
  fs.writeFileSync(path.join(configLibraryDir(), "_meta.json"), JSON.stringify({ appliedId: "legacy", clauderipple: { ourId: "legacy", previousAppliedId: null } }));
  fs.writeFileSync(path.join(configLibraryDir(), "legacy.json"), JSON.stringify({ egressProxyUrl: url }));
  const service = (owner = home) => {
    fs.mkdirSync(path.dirname(plistPath()), { recursive: true });
    fs.writeFileSync(plistPath(), renderPlist({ home: owner, program: "/fake-node", stdoutLog: "/unused" }));
  };
  service();
  const deps = { platform: "darwin" as const, launchctl: (args: string[]) => { assert.equal(args[0], "print"); return { ok: true, out: "state = running\n pid = 4242\n" }; }, probe: () => ({ version: "0.12.14", home }), listenPids: () => [4242] };
  return { home, other, url, deps, service };
}

test("legacy Desktop apply migrates only with the current home's definition and verified live PID", t => {
  const f = fixture(t);
  applyAppProxy(f.url, f.home, undefined, f.deps);
  assert.equal(currentAppProxy().installationHome, f.home);
});

test("legacy Desktop uninstall completes for the default installation with independent evidence", t => {
  const f = fixture(t);
  assert.equal(removeClientIntegrations(f.home, () => "absent", { defaultHome: f.home, desktopService: f.deps }), true);
  assert.equal(currentAppProxy().egressProxyUrl, null);
});

test("migrated legacy Desktop evidence survives service removal before integration cleanup", t => {
  const f = fixture(t);
  applyAppProxy(f.url, f.home, undefined, f.deps);
  fs.unlinkSync(plistPath());
  assert.equal(removeClientIntegrations(f.home, () => "absent", { defaultHome: f.home, desktopService: { ...f.deps, launchctl: () => assert.fail("removed service must not be queried") } }), true);
  assert.equal(currentAppProxy().egressProxyUrl, null);
});

test("integration cleanup finishes a missing CA only after explicit manual trust removal confirmation", t => {
  const f = fixture(t);
  applyAppProxy(f.url, f.home, undefined, f.deps);
  assert.equal(removeClientIntegrations(f.home, undefined, { defaultHome: f.home }), false);
  assert.equal(fs.existsSync(path.join(f.home, "ca.pem")), false);
  assert.equal(removeClientIntegrations(f.home, undefined, { defaultHome: f.home, missingCaTrustRemoved: true }), true);
  fs.mkdirSync(path.join(f.home, "ca.pem"));
  assert.equal(removeClientIntegrations(f.home, undefined, { defaultHome: f.home, missingCaTrustRemoved: true }), false);
});

test("legacy Desktop direct on switches both clients with independent evidence", t => {
  const f = fixture(t);
  applyProxyEnv({ home: f.home, proxyUrl: f.url, caPath: path.join(f.home, "ca.pem"), force: false });
  const result = directOn(f.home, f.deps);
  assert.equal(result.ok, true);
  assert.equal(result.mode, "direct");
  assert.equal(currentAppProxy().egressProxyUrl, null);
  assert.equal(settingsEnv().HTTPS_PROXY, undefined);
});

test("legacy Desktop direct on never reports success with an unproven proxy still applied", t => {
  const f = fixture(t);
  f.service(f.other);
  const result = directOn(f.home, f.deps);
  assert.equal(result.ok, false);
  assert.equal(currentAppProxy().egressProxyUrl, f.url);
});

for (const scenario of ["foreign-definition", "wrong-listener", "missing-pid", "lookup-failed", "generation-changed"] as const) {
  test(`legacy Desktop migration preserves the entry on ${scenario}`, t => {
    const f = fixture(t);
    if (scenario === "foreign-definition") f.service(f.other);
    const deps = {
      ...f.deps,
      listenPids: () => scenario === "wrong-listener" ? [9999] : [4242],
      launchctl: (args: string[]) => {
        assert.equal(args[0], "print");
        if (scenario === "generation-changed") f.service(f.other);
        return scenario === "lookup-failed" ? { ok: false, out: "permission denied" } : { ok: true, out: scenario === "missing-pid" ? "state = waiting" : "state = running\n pid = 4242\n" };
      },
    };
    const before = currentAppProxy();
    assert.throws(() => applyAppProxy(f.url, f.home, undefined, deps));
    assert.deepEqual(currentAppProxy(), before);
  });
}
