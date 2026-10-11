import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay, setImmediate as nextTick } from "node:timers/promises";
import { PermissionQueue } from "../src/permissions.ts";
import { INLINE_CAP } from "../src/protocol.ts";
import type { Effort, SessionEvent } from "../src/protocol.ts";
import { Sessions, modelArg, summarize } from "../src/sessions.ts";
import type { CanUseTool, PermissionAnswer, QueryFn, SdkUserMessage, SessionsOptions } from "../src/sessions.ts";

const router = {
  status: async () => ({ ok: true, proxyEnv: { HTTPS_PROXY: "http://127.0.0.1:1" } }),
  figures: async () => ({ effort: null, cachePct: null, contextPct: null, fiveHourPct: null, fiveHourResetAt: null, workers: [], at: Date.now() }),
  models: async () => [],
} satisfies SessionsOptions["router"] & { models: () => Promise<never[]> };

function scriptedQuery(script: { permission?: boolean; toolOutput?: string } = {}) {
  const options: Record<string, unknown>[] = [];
  const users: SdkUserMessage[] = [];
  const answers: PermissionAnswer[] = [];
  const suggestions = [{ type: "addRules" }];
  const spies = { interrupt: 0, setModel: [] as (string | undefined)[], close: 0 };
  const queryFn: QueryFn = params => {
    options.push(params.options);
    return {
      async *[Symbol.asyncIterator]() {
        let turn = 0;
        for await (const user of params.prompt) {
          users.push(user);
          if (turn++ === 0) yield { type: "system", subtype: "init", session_id: "sdk-1" };
          const id = `m${turn}`;
          yield { type: "stream_event", parent_tool_use_id: null, event: { type: "message_start", message: { id } } };
          yield { type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", delta: { type: "text_delta", text: "po" } } };
          if (script.permission) {
            const fn = params.options.canUseTool;
            const abort = params.options.abortController;
            assert.equal(typeof fn, "function");
            assert.ok(abort instanceof AbortController);
            answers.push(await (fn as CanUseTool)("Bash", { command: "ls" }, { signal: abort.signal, suggestions }));
          }
          if (script.toolOutput !== undefined) {
            yield { type: "user", parent_tool_use_id: null, message: { content: [{ type: "tool_result", tool_use_id: "tool-1", content: script.toolOutput, is_error: false }] } };
          }
          yield { type: "assistant", parent_tool_use_id: null, message: { id, model: "x", content: [{ type: "text", text: "pong" }] } };
          yield { type: "result", subtype: "success", is_error: false, duration_ms: 5, num_turns: 1, modelUsage: { x: { contextWindow: 1000 } } };
        }
      },
      interrupt: async () => { spies.interrupt++; },
      setModel: async model => { spies.setModel.push(model); },
      close: () => { spies.close++; },
    };
  };
  return { queryFn, options, users, answers, suggestions, spies };
}

function fixture(t: TestContext, script: Parameters<typeof scriptedQuery>[0] = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ripple-sessions-"));
  const cwd = path.join(dir, "project");
  fs.mkdirSync(cwd);
  const permissionsFile = path.join(dir, "permissions.json");
  const permissions = PermissionQueue.open(permissionsFile);
  const fake = scriptedQuery(script);
  const events: { session: string; event: SessionEvent }[] = [];
  const sessions = new Sessions({ dir, router, permissions, queryFn: fake.queryFn, coalesceMs: 5,
    onEvent: (session, event) => events.push({ session, event }), onSessions: () => {},
  });
  const instances = [sessions];
  t.after(async () => {
    // Let aborted permission/iterator continuations finish before closing their logs.
    for (const instance of instances) for (const session of instance.list()) instance.stop(session.id);
    await nextTick();
    for (const instance of instances) instance.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const create = (clientMsgId = "create-1", model = "claude-test", effort: Effort | null = "high") =>
    sessions.create({ clientMsgId, cwd, model, effort, text: "ping" });
  return { dir, cwd, permissionsFile, permissions, fake, sessions, instances, events, create };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = performance.now() + 2000;
  while (!predicate()) {
    assert.ok(performance.now() < deadline, "Timed out waiting for scripted query");
    await delay(5);
  }
  await nextTick();
}

function eventLabels(events: SessionEvent[]): string[] {
  return events.filter(event => event.kind !== "figures").map(event => event.kind === "state" ? `state ${event.state}` : event.kind);
}

for (const { model, effort, expected } of [
  { model: "claude-test", effort: "high" as const, expected: { model: "claude-test", effort: "high" } },
  { model: "gpt-test", effort: "max" as const, expected: { model: "gpt-test@max" } },
]) {
  test(`create uses cwd, proxy env and modelArg for ${model}, and emits an ordered turn`, { timeout: 4500 }, async t => {
    const f = fixture(t);
    const id = await f.create("create-1", model, effort);
    await waitFor(() => f.sessions.list().find(session => session.id === id)?.state === "idle");
    assert.equal(f.fake.options.length, 1);
    const options = f.fake.options[0]!;
    assert.equal(options.cwd, f.cwd);
    assert.equal(options.model, expected.model);
    if ("effort" in expected) assert.equal(options.effort, expected.effort);
    else assert.ok(!Object.hasOwn(options, "effort"));
    assert.deepEqual(modelArg(model, effort), expected);
    const env = options.env;
    assert.ok(env !== null && typeof env === "object");
    assert.equal(Reflect.get(env, "HTTPS_PROXY"), "http://127.0.0.1:1");
    assert.ok(!Object.hasOwn(env, "ANTHROPIC_BASE_URL"));
    assert.ok(!Object.hasOwn(options, "resume"));
    assert.deepEqual(eventLabels(f.events.filter(row => row.session === id).map(row => row.event)), [
      "state starting", "user", "turn", "state running", "delta", "assistant", "result", "state idle",
    ]);
    const delta = f.events.find(row => row.event.kind === "delta")?.event;
    assert.ok(delta?.kind === "delta");
    assert.equal(delta.text, "po");
    const stored = f.sessions.log(id).readAfter(0).events;
    const assistant = stored.find(event => event.kind === "assistant");
    assert.ok(assistant?.kind === "assistant");
    assert.equal(assistant.text, "pong");
    assert.deepEqual(stored.find(event => event.kind === "result"), {
      kind: "result", ok: true, ms: 5, turns: 1, seq: stored.find(event => event.kind === "result")!.seq,
      at: stored.find(event => event.kind === "result")!.at,
    });
    assert.equal(f.fake.users[0]?.message.content, "ping");
  });
}

test("sequential create and send retries with the same clientMsgId are idempotent", { timeout: 4500 }, async t => {
  const f = fixture(t);
  const id = await f.create();
  assert.equal(await f.create(), id);
  await waitFor(() => f.sessions.list()[0]?.state === "idle");
  assert.equal(f.fake.options.length, 1);
  f.sessions.send(id, "send-1", "again");
  f.sessions.send(id, "send-1", "again");
  await waitFor(() => f.fake.users.length === 2 && f.sessions.list()[0]?.state === "idle");
  const users = f.sessions.log(id).readAfter(0).events.filter(event => event.kind === "user");
  assert.deepEqual(users.map(event => event.clientMsgId), ["create-1", "send-1"]);
  assert.deepEqual(f.fake.users.map(user => user.message.content), ["ping", "again"]);
  assert.equal(f.fake.options.length, 1);
});

test("concurrent create retries with the same clientMsgId start only one query", {
  timeout: 4500,
}, async t => {
  const f = fixture(t);
  const ids = await Promise.all([f.create(), f.create()]);
  await waitFor(() => f.fake.options.length > 0);
  assert.equal(ids[0], ids[1]);
  assert.equal(f.sessions.list().length, 1);
  assert.equal(f.fake.options.length, 1);
});

for (const decision of ["allow", "allow_always", "deny"] as const) {
  test(`permission ${decision} waits, rejects another session and returns the SDK answer`, { timeout: 4500 }, async t => {
    const f = fixture(t, { permission: true });
    const id = await f.create();
    const otherId = await f.create("other-session");
    await waitFor(() => f.permissions.pending(id).length === 1 && f.permissions.pending(otherId).length === 1);
    const pending = f.permissions.pending(id)[0]!;
    const permission = f.events.find(row => row.session === id && row.event.kind === "permission")?.event;
    assert.ok(permission?.kind === "permission");
    assert.equal(permission.id, pending.id);
    assert.equal(permission.tool, "Bash");
    assert.equal(permission.input, "ls");
    assert.equal(permission.canAlways, true);
    assert.equal(f.sessions.list().find(session => session.id === id)?.state, "waiting");
    const labels = eventLabels(f.events.filter(row => row.session === id).map(row => row.event));
    assert.deepEqual(labels.slice(-3), ["delta", "permission", "state waiting"]);
    assert.equal(f.sessions.decide(otherId, pending.id, decision), false);
    assert.equal(f.permissions.pending(id).length, 1);
    assert.equal(f.sessions.decide(id, pending.id, decision), true);
    await waitFor(() => f.sessions.list().find(session => session.id === id)?.state === "idle");
    assert.equal(f.sessions.decide(id, pending.id, decision), false);
    const decided = f.sessions.log(id).readAfter(0).events.find(event => event.kind === "permission_decided");
    assert.ok(decided?.kind === "permission_decided");
    assert.equal(decided.id, pending.id);
    assert.equal(decided.decision, decision);
    const answer = f.fake.answers[0]!;
    assert.equal(answer.behavior, decision === "deny" ? "deny" : "allow");
    if (answer.behavior === "allow") {
      assert.deepEqual(answer.updatedInput, { command: "ls" });
      if (decision === "allow_always") assert.deepEqual(answer.updatedPermissions, f.fake.suggestions);
      else assert.ok(!Object.hasOwn(answer, "updatedPermissions"));
    } else assert.match(answer.message, /denied/);
    // Resolve the unrelated query too, so shutdown cannot race a permission continuation.
    assert.equal(f.sessions.decide(otherId, f.permissions.pending(otherId)[0]!.id, "deny"), true);
    await waitFor(() => f.sessions.list().every(session => session.state === "idle"));
  });
}

test("recover expires persisted permissions, stops a mid-turn session and resumes sdk-1", { timeout: 4500 }, async t => {
  const f = fixture(t);
  const id = await f.create();
  await waitFor(() => f.sessions.list()[0]?.state === "idle");
  f.sessions.stop(id);
  await nextTick();
  const file = path.join(f.dir, "sessions.json");
  const records = JSON.parse(fs.readFileSync(file, "utf8")) as { id: string; state: string; sdkSessionId: string | null }[];
  assert.equal(records[0]?.sdkSessionId, "sdk-1");
  fs.writeFileSync(file, JSON.stringify(records.map(record => ({ ...record, state: "running" }))));
  f.sessions.log(id).append({ kind: "state", state: "running" });
  const pending = f.permissions.request({ session: id, tool: "Bash", title: "", summary: "ls", input: { command: "ls" } });
  f.sessions.log(id).append({ kind: "permission", id: pending.record.id, tool: "Bash", title: "", summary: "ls", input: "ls", canAlways: true });
  const epoch = f.sessions.log(id).epoch;
  const before = f.sessions.log(id).lastSeq;
  f.sessions.shutdown();

  const permissions = PermissionQueue.open(f.permissionsFile);
  const fake = scriptedQuery();
  const recovered = new Sessions({ dir: f.dir, router, permissions, queryFn: fake.queryFn, coalesceMs: 5, onEvent: () => {}, onSessions: () => {} });
  f.instances.push(recovered);
  recovered.recover();
  assert.equal(recovered.log(id).epoch, epoch);
  assert.equal(permissions.pending().length, 0);
  assert.deepEqual(recovered.log(id).readAfter(before).events.map(({ seq: _seq, at: _at, ...event }) => event), [
    { kind: "permission_decided", id: pending.record.id, decision: "expired", reason: "host_restarted" },
    { kind: "notice", code: "host_restarted" },
    { kind: "state", state: "stopped" },
  ]);
  assert.equal(recovered.list()[0]?.state, "stopped");
  recovered.send(id, "after-restart", "continue");
  await waitFor(() => recovered.list()[0]?.state === "idle");
  assert.equal(fake.options.length, 1);
  assert.equal(fake.options[0]?.resume, "sdk-1");
  assert.equal(fake.options[0]?.cwd, f.cwd);
  assert.equal(fake.users[0]?.session_id, "sdk-1");
});

test("large SDK tool output is stored as a BlobRef and round-trips in full", { timeout: 4500 }, async t => {
  const text = "界😀\n".repeat(INLINE_CAP);
  const f = fixture(t, { toolOutput: text });
  const id = await f.create();
  await waitFor(() => f.sessions.list()[0]?.state === "idle");
  const result = f.sessions.log(id).readAfter(0).events.find(event => event.kind === "tool_result");
  assert.ok(result?.kind === "tool_result");
  assert.equal(result.toolUseId, "tool-1");
  assert.equal(result.ok, true);
  assert.ok(typeof result.text !== "string");
  assert.equal(result.text.bytes, Buffer.byteLength(text));
  assert.equal(result.text.preview, text.slice(0, 400));
  assert.equal(f.sessions.log(id).blob(result.text.blob), text);
});

test("summarize uses Bash's first line, cwd-relative Read paths and Grep pattern plus path", () => {
  const cwd = path.resolve(os.tmpdir(), "summary-project");
  assert.equal(summarize("Bash", { command: "ls -la\npwd" }, cwd), "ls -la");
  assert.equal(summarize("Bash", { command: "\n\nls\npwd" }, cwd), "ls");
  assert.equal(summarize("Read", { file_path: path.join(cwd, "src", "index.ts") }, cwd), "src/index.ts");
  assert.equal(summarize("Read", { file_path: cwd }, cwd), ".");
  const outside = `${cwd}-other/file.ts`;
  assert.equal(summarize("Read", { file_path: outside }, cwd), outside);
  assert.equal(summarize("Grep", { pattern: "needle", path: path.join(cwd, "src") }, cwd), "needle  src");
  assert.equal(summarize("Grep", { pattern: "needle" }, cwd), "needle");
});
