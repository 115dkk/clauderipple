import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DesktopSessions, processHasSession, transcriptEvents } from "../src/desktop.ts";
import { summarize, Sessions } from "../src/sessions.ts";
import { PermissionQueue } from "../src/permissions.ts";
import { FRAME_CAP } from "../src/protocol.ts";
import { reduce } from "../web/timeline.ts";

const id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const line = (value: unknown): string => JSON.stringify(value) + "\n";
const user = { type: "user", uuid: "u1", cwd: "/synthetic/project", timestamp: "2026-10-12T01:00:00Z", message: { content: "First prompt" } };
const assistant = { type: "assistant", uuid: "a1", message: { id: "m1", model: "test-model", content: [{ type: "text", text: "Answer" }, { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/synthetic/project/file.ts" } }] } };

function fixture(t: import("node:test").TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-test-"));
  const projects = path.join(root, "projects");
  const project = path.join(projects, "project");
  fs.mkdirSync(project, { recursive: true });
  const excluded = new Set<string>();
  let now = Date.now();
  const desktop = new DesktopSessions({ projects, summarize, excluded: () => excluded, now: () => now, processes: () => "" });
  t.after(() => { desktop.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, projects, project, desktop, excluded, advance: () => { now += 6000; } };
}

test("defensive transcript conversion preserves users, tools, failure and result", () => {
  const lines = [line(user), "not json", "null", line({ type: "unknown" }), line({ ...user, isSidechain: true }), line({ type: "assistant", message: { content: [null, 5, { type: "thinking", thinking: "not shown" }] } }), line(assistant), line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: [{ type: "text", text: "failed" }] }] } }), line({ type: "result", subtype: "success", duration_ms: 23, num_turns: 1 })];
  const bodies = lines.flatMap(l => transcriptEvents(l, user.cwd, summarize).bodies);
  assert.deepEqual(bodies.map(b => b.kind), ["user", "assistant", "tool_result", "result"]);
  const a = bodies[1];
  assert.equal(a?.kind === "assistant" && a.tools[0]?.summary, "file.ts");
  const result = bodies[2];
  assert.equal(result?.kind === "tool_result" && result.ok, false);
  assert.deepEqual(transcriptEvents(line({ type: "system", subtype: "turn_duration", durationMs: 99 }), "", summarize).bodies, [{ kind: "result", ok: true, ms: 99, turns: 1 }]);
  assert.equal(transcriptEvents(line({ ...user, isMeta: true }), "", summarize).bodies.length, 0);
});

test("desktop Agent and Task calls preserve prompts behind compact descriptions", () => {
  for (const name of ["Agent", "Task"]) {
    const prompt = "First paragraph\nSecond line\n\n1. First step\n2. Second step";
    const parsed = transcriptEvents(line({ ...assistant, message: { ...assistant.message, content: [{ type: "tool_use", id: "worker", name, input: { description: "Review timeline", model: "sol", prompt } }] } }), user.cwd, summarize);
    const event = parsed.bodies[0];
    assert.equal(event?.kind, "assistant");
    if (event?.kind !== "assistant") throw new Error("missing assistant");
    assert.equal(event.text, "");
    assert.equal(event.tools[0]?.summary, "Review timeline · sol");
    assert.equal(event.tools[0]?.input, prompt);
    const result = transcriptEvents(line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "worker", content: prompt }] } }), user.cwd, summarize);
    const view = reduce([...parsed.bodies, ...result.bodies].map((b, i) => ({ ...b, seq: i + 1, at: 0 })));
    assert.equal(view.items.length, 1);
    assert.equal(view.items[0]?.type === "assistant" && view.items[0].tools[0]?.result?.text, prompt);
    const notification = transcriptEvents(line({ type: "user", message: { content: `<task-notification>\n<tool-use-id>worker</tool-use-id>\n<status>completed</status>\n<result>${prompt}</result>\n</task-notification>` } }), user.cwd, summarize);
    assert.deepEqual(notification.bodies, [{ kind: "tool_result", toolUseId: "worker", ok: true, text: prompt }]);
    const completed = reduce([...parsed.bodies, ...notification.bodies].map((b, i) => ({ ...b, seq: i + 1, at: 0 })));
    assert.equal(completed.items.length, 1);
    assert.equal(completed.items[0]?.type === "assistant" && completed.items[0].tools[0]?.result?.text, prompt);
  }
});

test("listing uses bounded windows, own title, cwd and last model without importing", t => {
  const f = fixture(t);
  const file = path.join(f.project, `${id}.jsonl`);
  fs.writeFileSync(file, line(user) + line({ type: "unknown", padding: "x".repeat(600_000) }) + line(assistant) + line({ type: "custom-title", customTitle: "  Own title  " }) + "broken\n");
  const [s] = f.desktop.list();
  assert.equal(s?.title, "Own title");
  assert.equal(s?.cwd, user.cwd);
  assert.equal(s?.model, "test-model");
  assert.equal(s?.origin, "desktop");
  assert.equal(s?.readOnly, false);
  assert.equal(s?.lastSeq, 0);
  assert.equal(s?.epoch, "");
  const log = f.desktop.log(id);
  assert.deepEqual(log.tail().events.map(e => e.kind), ["user", "assistant"]);
  assert.equal(log.tail().events[0]?.at, Date.parse(user.timestamp));
  assert.equal(f.desktop.log(id), log);
  fs.appendFileSync(file, line({ ...user, uuid: "u2", message: { content: "Second prompt" } }));
  const updated = f.desktop.log(id);
  assert.notEqual(updated.epoch, log.epoch);
  assert.equal(updated.lastSeq, 3);
});

test("only recent top-level UUID files, no symlinks, host transcripts or traversal", t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.project, `${id}.jsonl`), line(user));
  fs.mkdirSync(path.join(f.project, "subagents"));
  fs.writeFileSync(path.join(f.project, "subagents", `${other}.jsonl`), line(user));
  fs.writeFileSync(path.join(f.project, "not-a-session.jsonl"), line(user));
  const old = path.join(f.project, `${other}.jsonl`);
  fs.writeFileSync(old, line(user));
  fs.utimesSync(old, new Date(0), new Date(0));
  const outside = path.join(f.root, "outside.jsonl");
  fs.writeFileSync(outside, line(user));
  fs.symlinkSync(outside, path.join(f.project, "cccccccc-cccc-cccc-cccc-cccccccccccc.jsonl"));
  fs.symlinkSync(f.project, path.join(f.projects, "linked-project"));
  assert.deepEqual(f.desktop.list().map(s => s.id), [id]);
  assert.equal(f.desktop.has("../../outside"), false);
  assert.throws(() => f.desktop.log("../../outside"), /no such session/);
  f.excluded.add(id);
  f.advance();
  assert.deepEqual(f.desktop.list(), []);
});

test("recent listing is sorted and capped at 50", t => {
  const f = fixture(t);
  for (let i = 0; i < 55; i++) {
    const file = path.join(f.project, `aaaaaaaa-aaaa-aaaa-aaaa-${String(i).padStart(12, "0")}.jsonl`);
    fs.writeFileSync(file, line(user));
    const at = new Date(Date.now() - i * 1000);
    fs.utimesSync(file, at, at);
  }
  const list = f.desktop.list();
  assert.equal(list.length, 50);
  assert.ok(list[0]!.updatedAt > list[49]!.updatedAt);
});

test("large timeline outputs are blobs and paged below the frame cap", t => {
  const f = fixture(t);
  let data = line(user);
  for (let i = 0; i < 20; i++) data += line({ ...assistant, uuid: `a${i}`, message: { ...assistant.message, content: [{ type: "text", text: "한".repeat(100_000) }, ...assistant.message.content.slice(1)] } });
  fs.writeFileSync(path.join(f.project, `${id}.jsonl`), data + line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "x".repeat(100_000) }] } }) + "{unfinished");
  const log = f.desktop.log(id);
  let count = 0;
  let before = log.lastSeq + 1;
  for (;;) {
    const page = log.before(before, 2000);
    assert.ok(Buffer.byteLength(JSON.stringify(page)) < FRAME_CAP);
    count += page.events.length;
    for (const e of page.events) if ((e.kind === "assistant" || e.kind === "tool_result") && typeof e.text !== "string") assert.ok(log.blob(e.text.blob)!.length >= 100_000);
    if (!page.hasOlder) break;
    before = page.events[0]!.seq;
  }
  assert.equal(count, 22);
});

test("open detection matches exact session flags in fake ps output", () => {
  for (const flag of [`--resume=${id}`, `--session-id ${id}`, `--session-id=${id}`, `--resume ${id}`]) {
    assert.equal(processHasSession(` PID COMMAND\n 42 /path with spaces/claude ${flag} --model test\n`, id), true);
  }
  for (const args of [`--resume=${other}`, `--resume=${id}x`, `--prompt ${id}`, `--other=${id}`, ""]) {
    assert.equal(processHasSession(`42 claude ${args}`, id), false);
  }
  assert.equal(processHasSession(`42 claude --resume=invalid`, "invalid"), false);
});

test("live desktop states use fake ps and bounded cached filesystem reads", t => {
  const f = fixture(t);
  let now = Date.now();
  let ps = `42 claude --resume=${id}`;
  let calls = 0;
  const desktop = new DesktopSessions({ projects: f.projects, summarize, excluded: () => f.excluded,
    now: () => now, processes: () => { calls++; return ps; } });
  t.after(() => desktop.close());
  const file = path.join(f.project, `${id}.jsonl`);
  const write = (records: unknown[], age = 20_000) => {
    fs.writeFileSync(file, records.map(line).join(""));
    fs.utimesSync(file, new Date(now - age), new Date(now - age));
    now += 3000;
  };
  const completed = { type: "assistant", message: { stop_reason: "end_turn", content: [{ type: "text", text: "done" }] } };
  write([user, completed], 0);
  assert.equal(desktop.list()[0]?.state, "running");
  assert.equal(calls, 1);
  const reads = t.mock.method(fs, "readSync");
  assert.equal(desktop.poll(), false);
  assert.equal(calls, 1);
  now += 8000;
  assert.equal(desktop.poll(), true);
  assert.equal(desktop.list()[0]?.state, "stopped");
  assert.equal(reads.mock.callCount(), 0, "unchanged transcripts are not read");
  for (const records of [[user], [user, assistant], [user, assistant, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } }],
    [user, { type: "assistant", message: { stop_reason: null, content: [{ type: "text", text: "partial" }] } }]]) {
    write([...records, { type: "cost-state" }, { type: "bridge-session" }]);
    desktop.poll();
    assert.equal(desktop.list()[0]?.state, "running");
  }
  for (const ending of [completed, { type: "system", subtype: "turn_duration" }, { type: "result", subtype: "success" },
    { type: "system", subtype: "stop_hook_summary", preventedContinuation: false },
    { type: "user", message: { content: "[Request interrupted by user]" } }]) {
    write([user, assistant, ending, { type: "custom-title", customTitle: "new title" }, { ...user, isSidechain: true }, { ...user, isMeta: true }]);
    desktop.poll();
    assert.equal(desktop.list()[0]?.state, "stopped");
    assert.equal(desktop.list()[0]?.title, "new title");
  }
  write([user], 0);
  ps = "";
  desktop.poll();
  assert.equal(desktop.list()[0]?.state, "stopped", "recent and unfinished is not working without an open process");
  ps = `42 claude --session-id ${id}`;
  now += 3000;
  assert.equal(desktop.poll(), true);
  assert.equal(desktop.list()[0]?.state, "running");
  fs.unlinkSync(file);
  now += 3000;
  assert.equal(desktop.poll(), true);
  assert.deepEqual(desktop.list(), []);
});

for (const mode of ["resume", "process", "recent"] as const) test(`desktop continuation: ${mode}`, async t => {
  const f = fixture(t);
  const file = path.join(f.project, `${id}.jsonl`);
  fs.writeFileSync(file, line(user) + line(assistant));
  if (mode !== "recent") fs.utimesSync(file, new Date(Date.now() - 120_000), new Date(Date.now() - 120_000));
  const original = fs.readFileSync(file, "utf8");
  const options: Record<string, unknown>[] = [];
  let turns = 0;
  const sessions = new Sessions({ dir: f.root, desktopProjects: f.projects, desktopProcesses: () => mode === "process" ? `42 claude --resume=${id}` : "", permissions: PermissionQueue.open(path.join(f.root, "permissions.json")), router: { status: async () => ({ ok: true, proxyEnv: {} }), figures: async () => { throw new Error("unused"); } }, queryFn: params => {
    options.push(params.options);
    return {
      async *[Symbol.asyncIterator]() {
        yield { type: "system", subtype: "init", session_id: params.options.sessionId ?? params.options.resume ?? id };
        for await (const input of params.prompt) {
          turns++;
          yield { type: "assistant", message: { id: `reply-${turns}`, model: "test-model", content: [{ type: "text", text: input.message.content }] } };
          yield { type: "result", subtype: "success", num_turns: 1 };
        }
      }, interrupt: async () => {}, setModel: async () => {}, close: () => {},
    };
  }, onEvent: () => {}, onSessions: () => {} });
  t.after(async () => { for (const s of sessions.list()) sessions.stop(s.id); await new Promise(resolve => setImmediate(resolve)); sessions.shutdown(); });
  assert.equal(sessions.list()[0]?.origin, "desktop");
  assert.deepEqual(reduce(sessions.log(id).tail().events).items.map(item => item.type), ["user", "assistant"]);
  await sessions.setModel(id, "chosen-model", "high");
  const host = sessions.send(id, "first-phone", "continue");
  assert.equal(sessions.send(id, "first-phone", "continue"), host);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(options[0]?.resume, id);
  assert.equal(options[0]?.cwd, user.cwd);
  assert.equal(options[0]?.model, "chosen-model@high");
  assert.equal(options[0]?.forkSession, undefined);
  assert.equal(options[0]?.sessionId, undefined);
  assert.equal(host, id);
  assert.equal(turns, 1);
  assert.deepEqual(sessions.list().map(s => s.origin), ["host"]);
  const events = sessions.log(host).tail().events;
  assert.deepEqual(events.slice(0, 2).map(e => e.kind), ["user", "assistant"]);
  assert.equal(events[0]?.at, Date.parse(user.timestamp));
  assert.ok(events.some(e => e.kind === "notice" && e.code === (mode === "resume" ? "desktop_resumed" : "desktop_open")));
  assert.equal(fs.readFileSync(file, "utf8"), original);
  sessions.stop(host);
  await new Promise(resolve => setImmediate(resolve));
  sessions.send(host, "second-phone", "again");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(options[1]?.resume, host);
  assert.equal(options[1]?.forkSession, undefined);
  assert.throws(() => sessions.log("../../escape"), /no such session/);
  sessions.stop(host);
  await new Promise(resolve => setImmediate(resolve));
  const restored = new Sessions({ dir: f.root, desktopProjects: f.projects, desktopProcesses: () => "", permissions: PermissionQueue.open(path.join(f.root, "permissions.json")), router: { status: async () => ({ ok: true, proxyEnv: {} }), figures: async () => { throw new Error("unused"); } }, queryFn: () => { throw new Error("retry must not start SDK"); }, onEvent: () => {}, onSessions: () => {} });
  try {
    assert.equal(restored.send(id, "first-phone", "continue"), host);
    assert.deepEqual(restored.list().map(s => s.origin), ["host"]);
  } finally { restored.shutdown(); }
});
