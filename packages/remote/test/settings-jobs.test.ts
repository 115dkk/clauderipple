import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { SettingsJobs, type SettingsJob } from "../src/settings-jobs.ts";
import { DesktopSettings } from "../src/desktop-settings.ts";
import { Sessions } from "../src/sessions.ts";
import { PermissionQueue } from "../src/permissions.ts";

const job = (jobId: string, appSessionId = "local_target"): SettingsJob => ({ jobId, appSessionId, cliSessionId: "cli-1", model: "provider:model@high", createdAt: 1 });

test("settings jobs replace only unclaimed work, serialize writers, and retain the latest outcome", t => {
  const jobs = new SettingsJobs(); t.after(() => jobs.close());
  jobs.request(job("one")); jobs.request(job("two"));
  assert.deepEqual(jobs.pending("local_helper").map(j => j.jobId), ["two"]);
  assert.deepEqual(jobs.pending("local_target"), []);
  assert.equal(jobs.claim("one", "local_helper"), false);
  assert.equal(jobs.claim("two", "local_target"), false);
  assert.equal(jobs.result("two", "applied"), false);
  assert.equal(jobs.claim("two", "local_helper"), true);
  assert.equal(jobs.claim("two", "local_helper2"), false);
  jobs.request(job("three")); jobs.request(job("four"));
  assert.deepEqual(jobs.pending("local_helper"), []);
  assert.equal(jobs.claim("four", "local_helper"), false);
  assert.equal(jobs.result("two", "failed", "error"), true);
  assert.deepEqual(jobs.status("local_target"), { jobId: "four", outcome: "pending" });
  assert.equal(jobs.claim("four", "local_helper"), true);
  assert.equal(jobs.result("four", "applied"), true);
  assert.equal(jobs.result("four", "applied"), false);
  assert.deepEqual(jobs.status("local_target"), { jobId: "four", outcome: "applied" });
  assert.throws(() => jobs.request({ ...job("bad"), model: "bad/model" }));
  assert.throws(() => jobs.request({ jobId: "bad", appSessionId: "local_target", cliSessionId: "cli-1", createdAt: 1 }));
});

test("unclaimed jobs expire as no-helper and a claimed timeout fails without applying", async t => {
  const jobs = new SettingsJobs(20, 40); t.after(() => jobs.close());
  jobs.request(job("claimed")); assert.equal(jobs.claim("claimed", "local_helper"), true);
  jobs.request(job("waiting", "local_other"));
  await delay(70);
  assert.deepEqual(jobs.status("local_target"), { jobId: "claimed", outcome: "failed", detail: "helper result timed out" });
  assert.deepEqual(jobs.status("local_other"), { jobId: "waiting", outcome: "no-helper" });
  assert.equal(jobs.result("claimed", "applied"), false);
  assert.deepEqual(jobs.pending("local_helper"), []);
});

test("desktop session records map current CLI ids, refresh, and refuse ambiguous or damaged records", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ripple-app-settings-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, "claude-code-sessions", "account", "org"); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "local_target.json");
  fs.writeFileSync(file, JSON.stringify({ sessionId: "local_target", cliSessionId: "cli-1", model: "opus", effort: "high" }));
  let now = 0; const reader = new DesktopSettings(root, () => now);
  assert.deepEqual(reader.appSettingsFor("cli-1"), { appSessionId: "local_target", model: "opus", effort: "high" });
  assert.equal(reader.appSessionIdFor("missing"), undefined);
  fs.writeFileSync(file, JSON.stringify({ cliSessionId: "cli-2", model: "sonnet" }));
  assert.equal(reader.appSessionIdFor("cli-1"), "local_target");
  now += 3001;
  assert.equal(reader.appSessionIdFor("cli-1"), undefined);
  assert.deepEqual(reader.appSettingsFor("cli-2"), { appSessionId: "local_target", model: "sonnet", effort: undefined });
  fs.writeFileSync(path.join(dir, "local_other.json"), JSON.stringify({ cliSessionId: "cli-2" })); now += 3001;
  assert.equal(reader.appSessionIdFor("cli-2"), undefined, "two records naming one CLI id: neither is guessed at");
  fs.unlinkSync(path.join(dir, "local_other.json")); fs.writeFileSync(file, "broken");
  fs.writeFileSync(path.join(dir, "local_fine.json"), JSON.stringify({ cliSessionId: "cli-3" })); now += 3001;
  assert.equal(reader.appSessionIdFor("cli-2"), undefined, "a record mid-write is left out");
  assert.equal(reader.appSessionIdFor("cli-3"), "local_fine", "and does not hide the others");
});

test("Sessions only queues explicitly requested fields for a mapped app record", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ripple-settings-session-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const scope = path.join(dir, "app", "claude-code-sessions", "account", "org"); fs.mkdirSync(scope, { recursive: true });
  fs.writeFileSync(path.join(scope, "local_target.json"), JSON.stringify({ cliSessionId: "cli-1", model: "old", effort: "low" }));
  const sessions = new Sessions({ dir, desktopSidebar: { root: path.join(dir, "app") }, permissions: PermissionQueue.open(path.join(dir, "permissions.json")),
    router: { status: async () => ({ ok: true, proxyEnv: {} }), figures: async () => ({ effort: null, cachePct: null, contextPct: null, fiveHourPct: null, fiveHourResetAt: null, workers: [], at: 0 }) },
    queryFn: () => { throw new Error("must not launch"); }, onEvent() {}, onSessions() {} });
  t.after(() => sessions.shutdown());
  assert.equal(sessions.requestAppSettings("missing", { model: "new" }), false);
  assert.deepEqual(sessions.settingsJobs.pending("local_helper"), []);
  const requested = { effort: "high" as const, appSessionId: "local_other", cliSessionId: "other" };
  assert.equal(sessions.requestAppSettings("cli-1", requested), true);
  const [queued] = sessions.settingsJobs.pending("local_helper");
  assert.equal(queued?.appSessionId, "local_target"); assert.equal(queued?.effort, "high"); assert.equal(queued?.model, undefined);
});
