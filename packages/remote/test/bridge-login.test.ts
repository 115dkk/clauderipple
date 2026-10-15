// This Mac's Claude login expiring is one state of the host, not an error per request: on
// 2026-10-15 the host logged "[desktop state] 이 컴퓨터의 Claude 로그인이 만료되었습니다…" every few
// seconds per Claude app session, and read the keychain (a child process) for every one of them.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Sessions } from "../src/sessions.ts";
import { AUTH_REREAD_MS, BridgeAuthError, BridgeClient, LOGIN_EXPIRED, LOGIN_REFUSED } from "../src/bridge-client.ts";
import type { BridgeAuth } from "../src/bridge-client.ts";
import { PermissionQueue } from "../src/permissions.ts";
import type { DesktopProcess } from "../src/desktop.ts";

const id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const tick = () => new Promise(resolve => setImmediate(resolve));
const line = (value: unknown) => JSON.stringify(value) + "\n";

test("an expired login reads the keychain at most every 30 s, and says so as a login problem", async () => {
  let now = 1_000_000, reads = 0, calls = 0;
  let stored: BridgeAuth = { accessToken: "old", organizationUuid: "org", expiresAt: now - 1 };
  const client = new BridgeClient({ now: () => now, auth: () => { reads++; return stored; }, fetch: async () => { calls++; return Response.json({ worker_status: "idle" }); } });
  for (let i = 0; i < 10; i++) {
    await assert.rejects(client.session("bridge"), (e: Error) => e instanceof BridgeAuthError && e.message === LOGIN_EXPIRED);
    now += 1000;
  }
  assert.equal(reads, 1, "one keychain read for ten requests within 30 s");
  assert.equal(calls, 0, "nothing is sent with an expired token");
  // Claude Code refreshed the token; it is picked up on the next read.
  stored = { accessToken: "new", organizationUuid: "org", expiresAt: now + 3_600_000 };
  now += AUTH_REREAD_MS;
  assert.deepEqual(await client.session("bridge"), { worker_status: "idle" });
  assert.equal(reads, 2);
});

test("a 401 is a login problem; the refused token is not sent again until the keychain is reread", async () => {
  let now = 1_000_000, reads = 0, calls = 0;
  const client = new BridgeClient({ now: () => now, auth: () => { reads++; return { accessToken: "t", organizationUuid: "org", expiresAt: now + 3_600_000 }; },
    fetch: async () => { calls++; return new Response("", { status: 401 }); } });
  await assert.rejects(client.session("bridge"), (e: Error) => e instanceof BridgeAuthError && e.message === LOGIN_REFUSED);
  for (let i = 0; i < 5; i++) { now += 1000; await assert.rejects(client.session("bridge"), (e: Error) => e instanceof BridgeAuthError); }
  assert.equal(calls, 1, "one refused request, not one per poll");
  assert.equal(reads, 1);
  now += AUTH_REREAD_MS;
  await assert.rejects(client.session("bridge"), BridgeAuthError);
  assert.equal(reads, 2, "read again after 30 s");
  assert.equal(calls, 2);
});

function fixture(t: import("node:test").TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-login-test-"));
  const projects = path.join(root, "projects");
  fs.mkdirSync(path.join(projects, "project"), { recursive: true });
  fs.writeFileSync(path.join(projects, "project", `${id}.jsonl`), line({ type: "user", uuid: "old", cwd: root, message: { content: "old prompt" } }));
  const registry = new Map<string, DesktopProcess>([[id, { sessionId: id, pid: 42, status: "idle", bridgeSessionId: "bridge" }]]);
  let now = Date.now();
  let expired = true;
  const logs: string[] = [];
  const problems: (string | null)[] = [];
  const client = new BridgeClient({
    now: () => now,
    auth: () => ({ accessToken: "private-token", organizationUuid: "org", expiresAt: expired ? now - 1 : now + 3_600_000 }),
    fetch: async (url, options) => {
      if (options?.method === "POST") return new Response("{}");
      if (String(url).endsWith("/sessions/bridge")) return Response.json({ worker_status: "idle" });
      if (String(url).includes("/events?")) return Response.json({ data: [] });
      return new Response(new ReadableStream<Uint8Array>({ start(c) { options?.signal?.addEventListener("abort", () => { try { c.close(); } catch { /* closed */ } }, { once: true }); } }));
    },
  });
  const sessions = new Sessions({ now: () => now, log: l => logs.push(l), dir: path.join(root, "host"), desktopProjects: projects, desktopRegistry: () => registry, desktopProcesses: () => "", bridgeClient: client,
    permissions: PermissionQueue.open(path.join(root, "permissions.json")),
    router: { status: async () => ({ ok: true, proxyEnv: {} }), figures: async () => { throw new Error("unused"); } },
    queryFn: () => { throw new Error("must not spawn SDK"); }, onEvent() {}, onSessions() {}, onDesktopProblem: p => problems.push(p) });
  t.after(async () => { sessions.shutdown(); await tick(); fs.rmSync(root, { recursive: true, force: true }); });
  return { sessions, logs, problems, advance: (ms: number) => { now += ms; }, refresh: () => { expired = false; } };
}

test("an expired login is logged once and told to phones once, and its end too", async t => {
  const f = fixture(t);
  for (let i = 0; i < 20; i++) { await f.sessions.pollDesktop(); await tick(); f.advance(3000); }
  assert.deepEqual(f.logs.filter(l => l.includes("로그인")), [`[desktop] Claude app sessions cannot be reached: ${LOGIN_EXPIRED}`]);
  assert.deepEqual(f.problems, [LOGIN_EXPIRED]);
  assert.equal(f.sessions.desktopProblem(), LOGIN_EXPIRED);
  // A send into the Claude app session fails with that reason, which the phone shows.
  await assert.rejects(Promise.resolve(f.sessions.send(id, "phone-msg-1", "hello")), new RegExp(LOGIN_EXPIRED.slice(0, 20)));
  f.refresh();
  f.advance(31_000);
  await f.sessions.pollDesktop();
  await tick();
  assert.deepEqual(f.problems, [LOGIN_EXPIRED, null]);
  assert.ok(f.logs.includes("[desktop] Claude app sessions answer again"));
  assert.equal(f.sessions.desktopProblem(), null);
});
