import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Sessions } from "../src/sessions.ts";
import { BridgeClient } from "../src/bridge-client.ts";
import { PermissionQueue } from "../src/permissions.ts";
import { liveDesktopProcesses, type DesktopProcess } from "../src/desktop.ts";

const id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const tick = () => new Promise(resolve => setImmediate(resolve));
const line = (value: unknown) => JSON.stringify(value) + "\n";

function fixture(t: import("node:test").TestContext, rejected = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-session-test-"));
  const projects = path.join(root, "projects");
  fs.mkdirSync(path.join(projects, "project"), { recursive: true });
  const file = path.join(projects, "project", `${id}.jsonl`);
  fs.writeFileSync(file, line({ type: "user", uuid: "old", cwd: root, message: { content: "old prompt" } }));
  const registry = new Map<string, DesktopProcess>([[id, { sessionId: id, pid: 42, status: "idle", bridgeSessionId: "bridge" }]]);
  const posts: Record<string, unknown>[] = [];
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let queries = 0;
  let now = Date.now(), workerStatus = "idle", stateReads = 0, stateFailure = false;
  const client = new BridgeClient({ auth: () => ({ accessToken: "private-token", organizationUuid: "org", expiresAt: Date.now() + 60_000 }), fetch: async (url, options) => {
    if (options?.method === "POST") {
      posts.push(JSON.parse(String(options.body)));
      return new Response("{}", { status: rejected ? 403 : 200 });
    }
    if (String(url).endsWith("/sessions/bridge")) {
      stateReads++;
      return stateFailure ? new Response("", { status: 503 }) : Response.json({ worker_status: workerStatus });
    }
    if (String(url).includes("/events?sort_order=desc")) return Response.json({ data: [] });
    assert.ok(String(url).includes("/events/stream?from_sequence_num="));
    return new Response(new ReadableStream<Uint8Array>({ start(c) { controller = c; options?.signal?.addEventListener("abort", () => c.close(), { once: true }); } }));
  } });
  const permissions = PermissionQueue.open(path.join(root, "permissions.json"));
  const sessions = new Sessions({ now: () => now, log() {}, dir: path.join(root, "host"), desktopProjects: projects, desktopRegistry: () => registry, desktopProcesses: () => "", bridgeClient: client, permissions,
    router: { status: async () => ({ ok: true, proxyEnv: {} }), figures: async () => { throw new Error("unused"); } },
    queryFn: () => { queries++; return { async *[Symbol.asyncIterator]() {}, interrupt: async () => {}, setModel: async () => {}, close() {} }; }, onEvent() {}, onSessions() {} });
  t.after(async () => { sessions.shutdown(); await tick(); fs.rmSync(root, { recursive: true, force: true }); });
  let sequence = 0;
  const emit = (payload: unknown, source = "worker") => controller!.enqueue(new TextEncoder().encode(`event: client_event\ndata: ${JSON.stringify({ source, event_id: `e${++sequence}`, sequence_num: sequence, payload })}\n\n`));
  return { root, file, registry, sessions, posts, permissions, emit, queries: () => queries,
    stateReads: () => stateReads, advance: () => { now += 3000; }, status: (value: string) => { workerStatus = value; }, failState: () => { stateFailure = true; } };
}

test("bridge worker state overrides busy registry for listed and opened sessions, caches and falls back on failure", async t => {
  const f = fixture(t);
  f.registry.get(id)!.status = "busy";
  await Promise.all([f.sessions.pollDesktop(), f.sessions.pollDesktop()]);
  assert.equal(f.sessions.list()[0]!.state, "idle");
  assert.equal(f.stateReads(), 1);
  f.sessions.log(id);
  await f.sessions.pollDesktop();
  assert.equal(f.sessions.summaryOf(id)!.state, "idle");
  assert.equal(f.stateReads(), 1);
  for (const [worker, state] of [["running", "running"], ["requires_action", "waiting"], ["idle", "idle"]]) {
    f.advance(); f.status(worker!);
    await f.sessions.pollDesktop();
    assert.equal(f.sessions.summaryOf(id)!.state, state);
  }
  f.advance(); f.failState();
  await f.sessions.pollDesktop();
  assert.equal(f.sessions.summaryOf(id)!.state, "running");
});

test("background counts reach listed and opened bridge summaries independently of the main state", async t => {
  const f = fixture(t);
  fs.appendFileSync(f.file, line({ type: "assistant", message: { content: [{ type: "tool_use", id: "a", name: "Agent", input: {} }] } }) +
    line({ type: "user", toolUseResult: { isAsync: true, agentId: "worker" }, message: { content: [{ type: "tool_result", tool_use_id: "a", content: "async" }] } }));
  await f.sessions.pollDesktop();
  assert.equal(f.sessions.list()[0]!.tasks, 1);
  assert.equal(f.sessions.list()[0]!.state, "idle");
  f.sessions.log(id);
  assert.equal(f.sessions.summaryOf(id)!.tasks, 1);
  fs.appendFileSync(f.file, line({ type: "user", message: { content: "<task-notification><task-id>worker</task-id><status>completed</status></task-notification>" } }));
  f.advance();
  await f.sessions.pollDesktop();
  assert.equal(f.sessions.summaryOf(id)!.tasks, 0);
  assert.equal(f.sessions.summaryOf(id)!.state, "idle");
});

test("live registry verifies pid and procStart and ignores stale/non-desktop entries", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "registry-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, `${process.pid}.json`);
  const value = { sessionId: id, pid: process.pid, entrypoint: "claude-desktop", status: "idle", bridgeSessionId: "bridge" };
  fs.writeFileSync(file, JSON.stringify(value));
  assert.equal(liveDesktopProcesses(root, 0).get(id)?.bridgeSessionId, "bridge");
  for (const override of [{ procStart: "wrong identity" }, { entrypoint: "sdk-cli" }, { pid: 1 }, { status: "unknown" }]) {
    fs.writeFileSync(file, JSON.stringify({ ...value, ...override }));
    assert.equal(liveDesktopProcesses(root, 0).size, 0);
  }
});

test("bridge prompts, transcript echo, permission allow/cancel and interrupt never spawn SDK", async t => {
  const f = fixture(t);
  assert.equal(f.sessions.list()[0]?.state, "idle");
  await Promise.all([f.sessions.send(id, "phone-uuid", "hello"), f.sessions.send(id, "phone-uuid", "hello")]);
  assert.equal(f.posts.length, 1);
  // The API rejects (400) any event uuid that is not a UUID; phones send short random ids.
  assert.match(String((f.posts[0] as { events: { payload: { uuid: string } }[] }).events[0]!.payload.uuid), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(f.queries(), 0);
  fs.appendFileSync(f.file, line({ type: "user", uuid: "phone-uuid", message: { content: "hello" } }) + line({ type: "assistant", uuid: "reply", message: { model: "model", content: [{ type: "text", text: "reply" }] } }));
  f.sessions.pollDesktop();
  const events = f.sessions.log(id).tail().events;
  assert.equal(events.filter(e => e.kind === "user" && e.clientMsgId === "phone-uuid").length, 1);
  assert.ok(events.some(e => e.kind === "assistant"));
  const request = { type: "control_request", request_id: "r1", request: { subtype: "can_use_tool", tool_name: "Bash", tool_use_id: "tool", input: { command: "true" } } };
  f.emit(request, "client");
  await tick();
  assert.equal(f.permissions.pending().length, 0);
  f.emit(request);
  await tick();
  const permission = f.permissions.pending()[0]!;
  assert.equal(f.sessions.log(id).tail().events.find(e => e.kind === "permission")?.kind, "permission");
  assert.equal(await f.sessions.decide(id, permission.id, "allow"), true);
  const response = f.posts[1] as { events: { payload: { response: unknown } }[] };
  assert.deepEqual(response.events[0]?.payload.response, { subtype: "success", request_id: "r1", response: { behavior: "allow", updatedInput: { command: "true" }, toolUseID: "tool" } });
  f.emit({ ...request, request_id: "r2" });
  await tick();
  const cancelled = f.permissions.pending()[0]!;
  f.emit({ type: "control_cancel_request", request_id: "r2" });
  await tick();
  assert.equal(await f.sessions.decide(id, cancelled.id, "allow"), false);
  assert.equal(f.posts.length, 2);
  await f.sessions.interrupt(id);
  assert.equal(f.posts.length, 3);
  assert.equal(f.queries(), 0);
  f.registry.clear();
  f.sessions.pollDesktop();
  await f.sessions.send(id, "closed-phone", "resume closed");
  await tick();
  assert.equal(f.queries(), 1);
});

test("a rejected live bridge send fails each attempt without logging the user or starting a writer", async t => {
  const f = fixture(t, true);
  await assert.rejects(Promise.resolve(f.sessions.send(id, "phone", "not accepted")), /받지 않았습니다/);
  await assert.rejects(Promise.resolve(f.sessions.send(id, "phone", "not accepted")), /받지 않았습니다/);
  assert.equal(f.posts.length, 2);
  assert.equal(f.queries(), 0);
  assert.equal(f.sessions.log(id).tail().events.some(e => e.kind === "user" && e.clientMsgId === "phone"), false);
});
