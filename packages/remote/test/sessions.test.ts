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

function scriptedQuery(script: { permission?: boolean; toolOutput?: unknown; images?: boolean } = {}) {
  const options: Record<string, unknown>[] = [];
  const users: SdkUserMessage[] = [];
  const answers: PermissionAnswer[] = [];
  const suggestions = [{ type: "addRules" }];
  const spies = { modeError: null as Error | null, setPermissionMode: [] as import('../src/protocol.ts').PermissionMode[], interrupt: 0, setModel: [] as (string | undefined)[], close: 0 };
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
          const image = { type: "image", source: { type: "base64", media_type: "image/png", data: Buffer.from("sdk image").toString("base64") } };
          if (script.images) yield { type: "user", uuid: "sdk-image-user", message: { content: [image] } };
          yield { type: "assistant", parent_tool_use_id: null, message: { id, model: "x", content: [{ type: "text", text: "pong" }, ...(script.images ? [image] : [])] } };
          yield { type: "result", subtype: "success", is_error: false, duration_ms: 5, num_turns: 1, modelUsage: { x: { contextWindow: 1000 } } };
        }
      },
      interrupt: async () => { spies.interrupt++; },
      setModel: async model => { spies.setModel.push(model); },
      setPermissionMode: async mode => { if (spies.modeError) throw spies.modeError; spies.setPermissionMode.push(mode); },
      close: () => { spies.close++; },
    };
  };
  return { queryFn, options, users, answers, suggestions, spies };
}

function fixture(t: TestContext, script: Parameters<typeof scriptedQuery>[0] = {}, extra: Pick<SessionsOptions, "handoff" | "log"> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ripple-sessions-"));
  const cwd = path.join(dir, "project");
  fs.mkdirSync(cwd);
  const permissionsFile = path.join(dir, "permissions.json");
  const permissions = PermissionQueue.open(permissionsFile);
  const fake = scriptedQuery(script);
  const events: { session: string; event: SessionEvent }[] = [];
  const sessions = new Sessions({ dir, router, permissions, queryFn: fake.queryFn, coalesceMs: 5, ...extra,
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

test("creation carries permission mode, enables bypass explicitly, and defaults to auto", async t => {
  const f = fixture(t);
  for (const mode of [undefined, 'plan', 'default', 'acceptEdits', 'auto', 'bypassPermissions'] as const) {
    const id = await f.sessions.create({ clientMsgId: `mode-${mode}`, cwd: f.cwd, model: 'test', effort: null, text: 'ping', ...(mode ? { permissionMode: mode } : {}) });
    await waitFor(() => f.fake.options.length > 0 && f.sessions.summaryOf(id)?.state === 'idle');
    const options = f.fake.options.at(-1)!;
    assert.equal(options.permissionMode, mode ?? 'auto');
    assert.equal(options.allowDangerouslySkipPermissions, mode === 'bypassPermissions' ? true : undefined);
    assert.equal(f.sessions.summaryOf(id)?.permissionMode, mode ?? 'auto');
  }
});

test("set_mode applies during a turn and stores mode for a stopped session", async t => {
  const f = fixture(t, { permission: true });
  const id = await f.create();
  await waitFor(() => f.permissions.pending(id).length === 1);
  await f.sessions.setMode(id, 'plan');
  assert.deepEqual(f.fake.spies.setPermissionMode, ['plan']);
  assert.equal(f.sessions.summaryOf(id)?.permissionMode, 'plan');
  assert.ok(f.events.some(e => e.event.kind === 'mode' && e.event.mode === 'plan'));
  f.sessions.stop(id);
  await nextTick();
  await f.sessions.setMode(id, 'acceptEdits');
  f.sessions.send(id, 'resume-mode', 'again');
  await waitFor(() => f.fake.options.length === 2);
  assert.equal(f.fake.options[1]!.permissionMode, 'acceptEdits');
});

for (const original of ['auto', 'bypassPermissions'] as const) test(`plan implementation returns from ${original}`, async t => {
  const f = fixture(t);
  const id = await f.sessions.create({ clientMsgId: 'plan', cwd: f.cwd, model: 'test', effort: null, text: 'ping', permissionMode: original });
  await waitFor(() => f.fake.options.length === 1);
  await f.sessions.setMode(id, 'plan');
  const callback = f.fake.options[0]!.canUseTool as CanUseTool;
  const answer = callback('ExitPlanMode', { plan: '# Plan\nImplement it' }, { signal: new AbortController().signal });
  const pending = f.permissions.pending(id)[0]!;
  assert.ok(f.events.some(e => e.event.kind === 'permission' && e.event.requestKind === 'plan' && e.event.input === '# Plan\nImplement it'));
  assert.equal(await f.sessions.decide(id, pending.id, 'allow'), true);
  assert.equal((await answer).behavior, 'allow');
  assert.equal(f.fake.spies.setPermissionMode.at(-1), original === 'bypassPermissions' ? 'bypassPermissions' : 'acceptEdits');
});

test("mode and plan approval failures stay visible and leave the permission pending", async t => {
  const f = fixture(t);
  const id = await f.create();
  await waitFor(() => f.fake.options.length === 1);
  f.fake.spies.modeError = new Error('mode rejected');
  await assert.rejects(f.sessions.setMode(id, 'plan'), /mode rejected/);
  assert.equal(f.sessions.summaryOf(id)?.permissionMode, 'auto');
  f.fake.spies.modeError = null;
  await f.sessions.setMode(id, 'plan');
  const callback = f.fake.options[0]!.canUseTool as CanUseTool;
  const answer = callback('ExitPlanMode', { plan: 'Work' }, { signal: new AbortController().signal });
  const pending = f.permissions.pending(id)[0]!;
  f.fake.spies.modeError = new Error('mode rejected');
  await assert.rejects(Promise.resolve(f.sessions.decide(id, pending.id, 'allow')), /mode rejected/);
  assert.equal(f.permissions.get(pending.id)?.state, 'pending');
  assert.equal(f.sessions.summaryOf(id)?.permissionMode, 'plan');
  await f.sessions.decide(id, pending.id, 'deny', 'Revise the plan');
  assert.deepEqual(await answer, { behavior: 'deny', message: 'Revise the plan' });
});

test("AskUserQuestion passes answers keyed by question text in updatedInput", async t => {
  const f = fixture(t);
  const id = await f.create();
  await waitFor(() => f.fake.options.length === 1);
  const callback = f.fake.options[0]!.canUseTool as CanUseTool;
  const input = { questions: [{ question: 'Which?', header: 'Choice', multiSelect: true, options: [{ label: 'A', description: 'first' }, { label: 'B', description: 'second' }] }] };
  const answer = callback('AskUserQuestion', input, { signal: new AbortController().signal });
  const pending = f.permissions.pending(id)[0]!;
  assert.throws(() => f.sessions.decide(id, pending.id, 'allow'), /Answer every question/);
  const answers = { 'Which?': 'A, B, custom' };
  assert.equal(await f.sessions.decide(id, pending.id, 'allow', undefined, answers), true);
  assert.deepEqual(await answer, { behavior: 'allow', updatedInput: { ...input, answers } });
});

test("a new SDK message denies pending approvals before delivering the message", async t => {
  const f = fixture(t, { permission: true });
  const id = await f.create();
  await waitFor(() => f.permissions.pending(id).length === 1);
  f.sessions.send(id, 'supersede', 'new instructions');
  await waitFor(() => f.fake.users.length === 2);
  assert.deepEqual(f.fake.answers[0], { behavior: 'deny', message: 'superseded by a new message from the user' });
  assert.equal(f.fake.users[1]!.message.content, 'new instructions');
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = performance.now() + 2000;
  while (!predicate()) {
    assert.ok(performance.now() < deadline, "Timed out waiting for scripted query");
    await delay(5);
  }
  await nextTick();
}

test("SDK user, assistant and tool-result image blocks retain chunked blob references", async t => {
  const image = { type: "image", source: { type: "base64", media_type: "image/png", data: Buffer.from("sdk image").toString("base64") } };
  const f = fixture(t, { images: true, toolOutput: [image] });
  const id = await f.create();
  await waitFor(() => f.sessions.list()[0]?.state === "idle");
  const events = f.sessions.log(id).readAfter(0).events.filter(e => e.images?.length);
  assert.deepEqual(events.map(e => e.kind).sort(), ["assistant", "tool_result", "user"]);
  for (const event of events) assert.equal(f.sessions.log(id).blob(event.images![0]!.blob!), image.source.data);
});

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

test("desktop handoff waits for idle, holds new input, persists once and names the SDK session", async t => {
  const calls: { sessionId: string; title: string; cwd: string }[] = [];
  let finish: (() => void) | undefined;
  const logs: string[] = [];
  const f = fixture(t, { permission: true }, {
    handoff: async request => { calls.push(request); await new Promise<void>(resolve => { finish = resolve; }); return "opened"; },
    log: line => logs.push(line),
  });
  const id = await f.create();
  await waitFor(() => f.permissions.pending(id).length === 1);
  assert.equal(calls.length, 0);
  f.sessions.decide(id, f.permissions.pending(id)[0]!.id, "allow");
  await waitFor(() => calls.length === 1);
  assert.deepEqual(calls[0], { sessionId: "sdk-1", title: "ping", cwd: f.cwd });
  assert.equal(f.fake.options[0]?.title, "ping");
  f.sessions.send(id, "during-handoff", "again");
  await nextTick();
  assert.equal(f.fake.users.length, 1);
  finish!();
  await waitFor(() => f.permissions.pending(id).length === 1);
  f.sessions.decide(id, f.permissions.pending(id)[0]!.id, "allow");
  await waitFor(() => f.sessions.summaryOf(id)?.state === "idle");
  assert.equal(f.fake.users.length, 2);
  assert.equal(calls.length, 1);
  assert.match(logs[0]!, /opened/);
  f.sessions.shutdown();
  const recovered = new Sessions({ dir: f.dir, router, permissions: f.permissions, queryFn: f.fake.queryFn,
    handoff: async request => { calls.push(request); return "opened"; }, onEvent: () => {}, onSessions: () => {} });
  f.instances.push(recovered);
  recovered.send(id, "after-handoff-restart", "continue");
  await waitFor(() => f.permissions.pending(id).length === 1);
  recovered.decide(id, f.permissions.pending(id)[0]!.id, "allow");
  await waitFor(() => recovered.summaryOf(id)?.state === "idle");
  assert.equal(calls.length, 1);
});

test("desktop handoff waits until already queued turns finish", async t => {
  const counts: number[] = [];
  const f = fixture(t, { permission: true }, { handoff: async () => { counts.push(f.fake.users.length); return "opened"; }, log: () => {} });
  const id = await f.create();
  await waitFor(() => f.permissions.pending(id).length === 1);
  f.sessions.send(id, "queued", "second turn");
  assert.equal(f.permissions.pending(id).length, 0);
  await waitFor(() => f.fake.users.length === 2 && f.permissions.pending(id).length === 1);
  assert.deepEqual(counts, []);
  f.sessions.decide(id, f.permissions.pending(id)[0]!.id, "allow");
  await waitFor(() => counts.length === 1);
  assert.deepEqual(counts, [2]);
});

test("desktop handoff failure is logged and never retried", async t => {
  let calls = 0;
  const logs: string[] = [];
  const f = fixture(t, {}, { handoff: async () => { calls++; throw new Error("timeout"); }, log: line => logs.push(line) });
  const id = await f.create();
  await waitFor(() => logs.length === 1);
  f.sessions.send(id, "retry-turn", "again");
  await waitFor(() => f.fake.users.length === 2 && f.sessions.summaryOf(id)?.state === "idle");
  assert.equal(calls, 1);
  assert.match(logs[0]!, /failed: timeout/);
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
