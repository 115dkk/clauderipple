import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DesktopSessions, transcriptEvents } from "../src/desktop.ts";
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
  const desktop = new DesktopSessions({ projects, summarize, excluded: () => excluded, now: () => now });
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

test("listing uses bounded windows, own title, cwd and last model without importing", t => {
  const f = fixture(t);
  const file = path.join(f.project, `${id}.jsonl`);
  fs.writeFileSync(file, line(user) + line({ type: "unknown", padding: "x".repeat(600_000) }) + line(assistant) + line({ type: "custom-title", customTitle: "  Own title  " }) + "broken\n");
  const [s] = f.desktop.list();
  assert.equal(s?.title, "Own title");
  assert.equal(s?.cwd, user.cwd);
  assert.equal(s?.model, "test-model");
  assert.equal(s?.origin, "desktop");
  assert.equal(s?.readOnly, true);
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

test("session integration rejects every write and produces a readable timeline", async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.project, `${id}.jsonl`), line(user) + line(assistant));
  const sessions = new Sessions({ dir: f.root, desktopProjects: f.projects, permissions: PermissionQueue.open(path.join(f.root, "permissions.json")), router: { status: async () => ({ ok: true, proxyEnv: {} }), figures: async () => { throw new Error("unused"); } }, queryFn: () => { throw new Error("must never start SDK"); }, onEvent: () => {}, onSessions: () => {} });
  t.after(() => sessions.shutdown());
  assert.equal(sessions.has(id), true);
  assert.throws(() => sessions.send(id, "write", "no"), /read-only/);
  assert.throws(() => sessions.decide(id, "permission", "allow"), /read-only/);
  await assert.rejects(sessions.interrupt(id), /read-only/);
  await assert.rejects(sessions.setModel(id, "new", null), /read-only/);
  assert.throws(() => sessions.log("../../escape"), /no such session/);
  assert.equal(sessions.list()[0]?.origin, "desktop");
  assert.deepEqual(reduce(sessions.log(id).tail().events).items.map(item => item.type), ["user", "assistant"]);
});
