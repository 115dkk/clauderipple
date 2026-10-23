// The Claude app closes a Code-tab turn with mcp__ccd_turn__wrap_up: a recap, one question, and
// whether the session is blocked until a person answers. These tests read that mark from a
// synthetic transcript, the way the host does (a tail window, never the whole file).
import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Sessions } from "../src/sessions.ts";
import { PermissionQueue } from "../src/permissions.ts";
import { BridgeClient } from "../src/bridge-client.ts";
import type { DesktopProcess } from "../src/desktop.ts";
import type { AlertBody } from "../src/protocol.ts";
import { firstSentence, wrapUpFields, WRAP_LIMITS } from "../src/wrap-up.ts";
import { bridgeFixture, bridgeId, line as bridgeLine } from "./bridge-fixture.ts";

const id = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const line = (value: unknown): string => JSON.stringify(value) + "\n";
const spoken = (uuid: string, content = "Do the thing") => ({ type: "user", uuid, cwd: "/synthetic/project", timestamp: "2026-10-12T01:00:00Z", message: { content } });
const answer = { type: "assistant", uuid: "a1", message: { id: "m1", model: "test-model", stop_reason: "end_turn", content: [{ type: "text", text: "Answer" }] } };
/** The Code tab's closing tool call, as the model writes it into the transcript. */
const wrapUp = (input: Record<string, unknown>, toolId = "toolu-wrap") => ({
  type: "assistant", uuid: `a-${toolId}`,
  message: { id: `m-${toolId}`, model: "test-model", stop_reason: "tool_use", content: [{ type: "tool_use", id: toolId, name: "mcp__ccd_turn__wrap_up", input }] },
});
const done = { type: "result", subtype: "success", is_error: false };

const idleBridge = (): BridgeClient => new BridgeClient({
  auth: () => ({ accessToken: "test", organizationUuid: "org", expiresAt: Date.now() + 60_000 }),
  fetch: async (url, options) => {
    if (String(url).includes("sort_order=")) return Response.json({ data: [] });
    if (!String(url).includes("/events/stream")) return Response.json({ worker_status: "idle" });
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      options?.signal?.addEventListener("abort", () => { try { controller.close(); } catch { /* already closed */ } }, { once: true });
    } }));
  },
});

/** A Mac session the host only reads: a transcript in a synthetic projects dir plus a registry entry. */
function fixture(t: TestContext, opts: { tail?: unknown[]; status?: DesktopProcess["status"] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wrap-up-"));
  const project = path.join(root, "projects", "project");
  fs.mkdirSync(project, { recursive: true });
  const file = path.join(project, `${id}.jsonl`);
  fs.writeFileSync(file, [spoken("u1"), answer, ...(opts.tail ?? [])].map(line).join(""));
  const registry = new Map<string, DesktopProcess>([[id, { sessionId: id, pid: 42, status: opts.status ?? "busy" }]]);
  const alerts: { session: string; body: AlertBody }[] = [];
  let now = Date.now();
  let sent = 0;
  const sessions = new Sessions({
    dir: path.join(root, "host"), now: () => now,
    desktopProjects: path.join(root, "projects"), desktopRegistry: () => registry, desktopProcesses: () => "",
    permissions: PermissionQueue.open(path.join(root, "permissions.json")), bridgeClient: idleBridge(),
    router: { status: async () => ({ ok: true, proxyEnv: {} }), figures: async () => { throw new Error("unused"); } },
    queryFn: () => { throw new Error("no SDK is spawned for a Mac session"); },
    log: () => {}, onEvent: () => {}, onSessions: () => { sent++; },
    onAlert: (session, body) => alerts.push({ session, body }),
    away: async () => true,
  });
  t.after(async () => {
    sessions.shutdown();
    await new Promise(resolve => setImmediate(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const listed = () => sessions.list().find(s => s.id === id)!;
  return {
    sessions, alerts, listed,
    write: (lines: unknown[]) => fs.appendFileSync(file, lines.map(line).join("")),
    setStatus: (status: DesktopProcess["status"]) => { registry.get(id)!.status = status; },
    advance: () => { now += 4000; },
    sent: () => sent,
    poll: async () => { await sessions.pollDesktop(); await new Promise(resolve => setImmediate(resolve)); },
  };
}

test("the status line is the recap's first sentence, and the list is sent only when it changes", async t => {
  const f = fixture(t, { tail: [wrapUp({ recap: "Found the leak. Fixed two files." }), done], status: "idle" });
  await f.poll();
  assert.equal(f.listed().status, "Found the leak.");
  const sent = f.sent();
  f.advance();
  await f.poll();
  f.advance();
  await f.poll();
  assert.equal(f.sent(), sent, "an unchanged status sends no list");
  f.write([spoken("u2"), wrapUp({ recap: "Tests pass. Merged." }, "toolu-wrap-2"), done]);
  f.advance();
  await f.poll();
  assert.equal(f.listed().status, "Tests pass.");
});

test("a bridged session's status is cleared by the person's next message", async t => {
  const f = bridgeFixture(t);
  f.registry.get(bridgeId)!.status = "busy";
  fs.appendFileSync(f.file, [
    bridgeLine(spoken("p1", "fix the leak")),
    bridgeLine(wrapUp({ recap: "Fixed it, tests pass. Pushed the branch.", ask: "Open the pull request?", blocked: true })),
    bridgeLine(done),
  ].join(""));
  f.sessions.log(bridgeId); // the phone opened it: the host now tails it as a bridged record
  await f.sessions.pollDesktop();
  f.registry.get(bridgeId)!.status = "idle"; f.status("idle");
  f.advance();
  await f.sessions.pollDesktop();
  assert.equal(f.sessions.summaryOf(bridgeId)!.status, "Fixed it, tests pass.");
  await f.sessions.send(bridgeId, "m2", "Yes, open it.");
  assert.equal(f.sessions.summaryOf(bridgeId)!.status, undefined, "a new turn is under way; its recap is not written yet");
});

test("the shared wrap_up rules cap at the app's own lengths and keep only reply buttons", () => {
  const fields = wrapUpFields({
    recap: "  Found   the leak.\nFixed two files.  ",
    ask: "x".repeat(150),
    blocked: "true",
    actions: [{ action: "commit" }, { label: "Run tests", message: "Run the tests." }, { label: "L".repeat(40) }, { label: "Third" }],
  });
  assert.equal(fields.recap, "Found the leak. Fixed two files.");
  assert.equal(fields.ask.length, WRAP_LIMITS.ask);
  assert.equal(fields.blocked, true);
  // A button without a message sends its label; an app-side button (commit) is not a reply.
  assert.deepEqual(fields.replies, [{ label: "Run tests", message: "Run the tests." }, { label: "L".repeat(WRAP_LIMITS.label), message: "L".repeat(WRAP_LIMITS.label) }]);
  assert.equal(wrapUpFields({}).blocked, false);
  assert.equal(firstSentence("Found the leak. Fixed two files.", 200), "Found the leak.");
  assert.equal(firstSentence("버그를 찾았습니다. 두 파일을 고쳤습니다.", 200), "버그를 찾았습니다.");
  assert.equal(firstSentence("no terminator here", 200), "no terminator here");
  assert.equal(firstSentence("y".repeat(400), 200).length, 200);
});
