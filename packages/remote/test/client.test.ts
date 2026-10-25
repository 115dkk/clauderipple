// The phone's link and timeline, run in Node with a fake socket and a fake clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { backoff, Link, PROBE_MS, READY_MS } from "../web/conn.ts";
import type { SocketLike } from "../web/conn.ts";
import { dictionaries } from "../web/i18n.ts";
import { markdown } from "../web/md.ts";
import { pushAvailability } from "../web/pushstate.ts";
import { mergeEvents, reduce } from "../web/timeline.ts";
import { BACKOFF_CAP_MS, PING_MS, STALE_MS } from "../src/protocol.ts";
import type { EventBody, SessionEvent } from "../src/protocol.ts";

test("quoted paragraphs, line breaks, lists and code keep their structure", () => {
  assert.equal(markdown("> First line\n> Second line\n>\n> 1. First\n>    continuation\n> 2. Second\n>\n> ```\n> a\n> b\n> ```"),
    '<blockquote><p>First line<br>Second line</p><ol><li>First<br>continuation</li><li>Second</li></ol><pre class="md-code"><code>a\nb</code></pre></blockquote>');
  assert.equal(markdown("one\ntwo\n\n- alpha\n- beta"), '<p>one<br>two</p><ul><li>alpha</li><li>beta</li></ul>');
  assert.equal(markdown("<script>bad</script>"), '<p>&lt;script&gt;bad&lt;/script&gt;</p>');
});

class Clock {
  now = 0;
  private timers: { at: number; fn: () => void; id: number }[] = [];
  private next = 1;
  set = (fn: () => void, ms: number): number => { const id = this.next++; this.timers.push({ at: this.now + ms, fn, id }); return id; };
  clear = (id: unknown): void => { this.timers = this.timers.filter((t) => t.id !== id); };
  count = (): number => this.timers.length;
  /** Callbacks already queued when a timer is cleared still run in a browser; hand them out to fire late. */
  take = (): (() => void)[] => { const fns = this.timers.map((t) => t.fn); this.timers = []; return fns; };
  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at);
      const t = this.timers[0];
      if (!t || t.at > end) break;
      this.timers.shift();
      this.now = Math.max(this.now, t.at); // a timer overdue after freeze() runs late, at "now"
      t.fn();
    }
    this.now = end;
  }
  /** The app was in the background for `ms`: the time passed but no timer ran. */
  freeze(ms: number): void { this.now += ms; }
}

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: string[] = [];
  closed = false;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  send(data: string): void { this.sent.push(data); }
  close(): void { if (this.closed) return; this.closed = true; this.onclose?.({}); }
  open(): void { this.readyState = 1; this.onopen?.({}); }
  recv(msg: unknown): void { this.onmessage?.({ data: JSON.stringify(msg) }); }
}

function setup(online = { value: true }) {
  const clock = new Clock();
  const sockets: FakeSocket[] = [];
  const link = new Link({
    url: "ws://h/ws", token: "tok", clientId: "c",
    makeSocket: () => { const s = new FakeSocket(); sockets.push(s); return s; },
    now: () => clock.now, setTimer: clock.set, clearTimer: clock.clear, isOnline: () => online.value,
  });
  let readies = 0;
  link.onReady = () => { readies++; };
  return { clock, sockets, link, readies: () => readies };
}

const ready = { t: "ready", host: { name: "m", version: "0", routerOk: true }, sessions: [] };

test("backoff is attempt × 1 s, capped at 30 s, never zero", () => {
  assert.equal(backoff(0), 1000);
  assert.equal(backoff(3), 3000);
  assert.equal(backoff(1000), BACKOFF_CAP_MS);
});

test("hello carries the token; ready opens the link", () => {
  const { sockets, link, readies } = setup();
  link.start();
  sockets[0]!.open();
  assert.deepEqual(JSON.parse(sockets[0]!.sent[0]!), { t: "hello", token: "tok", clientId: "c" });
  sockets[0]!.recv(ready);
  assert.equal(link.status.state, "open");
  assert.equal(readies(), 1);
});

test("a dropped link retries forever with capped backoff and recovers", () => {
  const { clock, sockets, link, readies } = setup();
  link.start();
  for (let i = 0; i < 60; i++) {
    sockets[sockets.length - 1]!.close();
    assert.equal(link.status.state, "waiting");
    const wait = link.status.nextAt! - clock.now;
    assert.ok(wait > 0 && wait <= BACKOFF_CAP_MS);
    clock.advance(wait);
  }
  assert.equal(sockets.length, 61, "one new socket per attempt, none skipped");
  assert.ok(link.status.downSince !== null);
  sockets[60]!.open();
  sockets[60]!.recv(ready);
  assert.equal(link.status.state, "open");
  assert.equal(link.status.attempt, 0);
  assert.equal(link.status.downSince, null);
  assert.equal(readies(), 1);
});

test("a half-open socket is dropped after the stale ping goes unanswered", () => {
  const { clock, sockets, link } = setup();
  link.start();
  sockets[0]!.open();
  sockets[0]!.recv(ready);
  clock.advance(PING_MS);
  assert.ok(sockets[0]!.sent.some((s) => JSON.parse(s).t === "ping"));
  clock.advance(STALE_MS - PING_MS);
  assert.equal(sockets[0]!.closed, false, "not stale at exactly 30 s");
  clock.advance(PING_MS);
  assert.equal(sockets[0]!.closed, false, "silence is probed before the socket is dropped");
  assert.equal(link.status.state, "open");
  clock.advance(PROBE_MS);
  assert.equal(sockets[0]!.closed, true);
  assert.equal(sockets.length, 2, "the unanswered probe starts a new attempt at once");
  assert.equal(link.status.state, "connecting");
});

test("a connect that never opens nor closes is abandoned after READY_MS and retried", () => {
  const { clock, sockets, link } = setup();
  link.start();
  clock.advance(READY_MS + 1);
  assert.equal(sockets[0]!.closed, true);
  assert.equal(link.status.state, "waiting");
  clock.advance(1000);
  assert.equal(sockets.length, 2);
});

test("pongs keep a quiet link alive", () => {
  const { clock, sockets, link } = setup();
  link.start();
  sockets[0]!.open();
  sockets[0]!.recv(ready);
  for (let i = 0; i < 10; i++) { clock.advance(PING_MS); sockets[0]!.recv({ t: "pong", n: i }); }
  assert.equal(sockets[0]!.closed, false);
  assert.equal(link.status.state, "open");
});

test("a socket that opens but never says ready is abandoned after READY_MS", () => {
  const { clock, sockets, link } = setup();
  link.start();
  sockets[0]!.open();
  clock.advance(READY_MS + 1);
  assert.equal(sockets[0]!.closed, true);
  assert.equal(link.status.state, "waiting");
});

test("a refused token stops retrying and says so", () => {
  const { clock, sockets, link } = setup();
  link.start();
  sockets[0]!.open();
  sockets[0]!.recv({ t: "denied", reason: "token" });
  assert.equal(link.status.state, "denied");
  clock.advance(10 * BACKOFF_CAP_MS);
  assert.equal(sockets.length, 1);
  link.nudge();
  assert.equal(sockets.length, 1);
});

test("offline waits without opening sockets, and nudge reconnects at once when back", () => {
  const online = { value: false };
  const { clock, sockets, link } = setup(online);
  link.start();
  assert.equal(link.status.state, "offline");
  clock.advance(5000);
  assert.equal(sockets.length, 0);
  online.value = true;
  link.nudge();
  assert.equal(sockets.length, 1);
  assert.equal(link.status.state, "connecting");
});

// 2026-10-25 audit: each retry while offline started another countdown tick without stopping the
// previous one. 60 s offline left 62 timers, stop() cleared only the newest pair and 61 kept
// running; a foreground return could then open a socket per stale chain.
test("an offline wait keeps exactly one retry timer and one countdown tick", () => {
  const online = { value: false };
  const { clock, link } = setup(online);
  link.start();
  assert.equal(clock.count(), 2, "one retry and one tick");
  clock.advance(60_000);
  assert.ok(link.status.attempt === 0, "offline attempts do not escalate");
  assert.equal(clock.count(), 2, "60 s of retries is still one retry and one tick");
});

test("stop leaves no timers behind, and a callback already queued cannot revive them", () => {
  const online = { value: false };
  const { clock, sockets, link } = setup(online);
  link.start();
  clock.advance(10_000);
  const queued = clock.take();
  link.stop();
  assert.equal(clock.count(), 0);
  for (const fn of queued) fn();
  assert.equal(clock.count(), 0, "a stale retry or tick callback is ignored");
  clock.advance(2 * 60_000);
  assert.equal(clock.count(), 0);
  assert.equal(sockets.length, 0, "a stopped link opens nothing");
});

test("a retry queued before the app returns cannot open a second socket", () => {
  const online = { value: false };
  const { clock, sockets, link } = setup(online);
  link.start();
  clock.advance(1000); // the first offline retry ran; the next one is pending
  const queued = clock.take();
  online.value = true;
  link.foreground();
  assert.equal(sockets.length, 1, "one reconnect");
  for (const fn of queued) fn();
  assert.equal(sockets.length, 1, "the stale retry is not a second attempt");
  assert.equal(clock.count(), 1, "only the connect timeout remains; no stale tick re-arms");
});

test("foreground from a long offline wait reconnects once and opens on ready", () => {
  const online = { value: false };
  const { clock, sockets, link } = setup(online);
  link.start();
  clock.advance(30_000);
  online.value = true;
  link.foreground();
  assert.equal(sockets.length, 1);
  sockets[0]!.open();
  sockets[0]!.recv(ready);
  assert.equal(link.status.state, "open");
  assert.equal(link.status.attempt, 0);
  assert.equal(link.status.downSince, null);
  for (let i = 0; i < 6; i++) { clock.advance(PING_MS); sockets[0]!.recv({ t: "pong", n: i }); }
  assert.equal(sockets.length, 1, "a healthy minute opens no duplicate socket");
});

test("a nudge during a connect closes the abandoned socket instead of leaving two open", () => {
  const { sockets, link } = setup();
  link.start();
  assert.equal(sockets.length, 1);
  link.nudge();
  assert.equal(sockets.length, 2, "a fresh attempt");
  assert.equal(sockets[0]!.closed, true, "the first attempt is closed, not orphaned");
  assert.equal(sockets[1]!.closed, false);
  sockets[1]!.open();
  sockets[1]!.recv(ready);
  assert.equal(link.status.state, "open");
  assert.equal(link.status.attempt, 0);
});

test("a late close from an abandoned socket does not disturb the live attempt", () => {
  const { sockets, link } = setup();
  link.start();
  const old = sockets[0]!;
  link.nudge();
  sockets[1]!.open();
  sockets[1]!.recv(ready);
  old.close();
  assert.equal(link.status.state, "open");
  assert.equal(link.status.attempt, 0);
  assert.equal(sockets.length, 2);
});

test("a ready timeout already queued cannot forget the live connection's timer", () => {
  const { clock, sockets, link } = setup();
  link.start();
  const queued = clock.take(); // the first connect's timeout was already due when it was cleared
  link.nudge();
  assert.equal(sockets.length, 2);
  for (const fn of queued) fn();
  link.stop();
  assert.equal(clock.count(), 0, "stop still owns the live connect timeout");
  assert.equal(sockets[1]!.closed, true);
});

test("a ping that finds the link stale does not re-arm its own chain", () => {
  const { clock, sockets, link } = setup();
  link.start();
  sockets[0]!.open();
  sockets[0]!.recv(ready);
  clock.advance(STALE_MS + PING_MS); // t=40 s: silence is now probed, not dropped at once
  assert.equal(sockets[0]!.closed, false);
  clock.advance(PROBE_MS);
  assert.equal(sockets[0]!.closed, true);
  assert.equal(link.status.state, "connecting");
  assert.equal(clock.count(), 1, "only the connect timeout; no orphan ping chain");
  link.stop();
  assert.equal(clock.count(), 0);
});

test("a status callback that stops the link cannot leave the countdown re-armed", () => {
  const online = { value: false };
  const { clock, link } = setup(online);
  let calls = 0;
  link.onStatus = () => { if (++calls === 2) link.stop(); };
  link.start(); // #1: offline
  clock.advance(1000); // the first tick calls onStatus #2, which stops the link
  assert.equal(link.status.state, "offline");
  assert.equal(clock.count(), 0);
});

test("a status callback that nudges does not leave a second countdown chain", () => {
  const online = { value: false };
  const { clock, link } = setup(online);
  let calls = 0;
  link.onStatus = () => { if (++calls === 2) link.nudge(); };
  link.start();
  clock.advance(1000);
  assert.equal(clock.count(), 2, "one retry and one tick after the nudge");
});

test("a status callback that stops during a connect opens no socket and arms nothing", () => {
  const { clock, sockets, link } = setup();
  link.onStatus = () => { if (link.status.state === "connecting") link.stop(); };
  link.start();
  assert.equal(sockets.length, 0);
  assert.equal(clock.count(), 0);
});

test("a status callback that stops while offline arms no retry", () => {
  const online = { value: false };
  const { clock, link } = setup(online);
  link.onStatus = () => { if (link.status.state === "offline") link.stop(); };
  link.start();
  assert.equal(clock.count(), 0);
});

// Coming back to the front used to call ping(), whose 30 s stale rule discarded a socket that was
// merely old because the app had been in the background. Probe first: one ping, one pong, keep it.
const pingOf = (sock: FakeSocket): { t: string; n?: number } | undefined =>
  sock.sent.map((s) => JSON.parse(s) as { t: string; n?: number }).filter((m) => m.t === "ping").at(-1);

test("foreground probes a stale-looking open socket and keeps it when the pong answers", () => {
  const { clock, sockets, link } = setup();
  link.start();
  sockets[0]!.open();
  sockets[0]!.recv(ready);
  clock.freeze(6 * 60_000); // six minutes in the background: the time passed, no timer ran
  link.foreground();
  assert.equal(sockets[0]!.closed, false, "an open socket is probed, not discarded for looking stale");
  assert.equal(link.status.state, "open");
  const ping = pingOf(sockets[0]!)!;
  sockets[0]!.recv({ t: "pong", n: ping.n });
  clock.advance(PROBE_MS);
  assert.equal(sockets[0]!.closed, false, "the matching pong clears the probe");
  assert.equal(link.status.state, "open");
  assert.equal(sockets.length, 1);
});

test("a probe with no pong starts a new attempt at the 3 s deadline, not after a backoff", () => {
  const { clock, sockets, link } = setup();
  link.start();
  sockets[0]!.open();
  sockets[0]!.recv(ready);
  clock.freeze(60_000);
  link.foreground();
  assert.equal(link.status.state, "open");
  assert.equal(sockets[0]!.closed, false);
  clock.advance(PROBE_MS - 1);
  assert.equal(sockets.length, 1, "still probing just before the deadline");
  clock.advance(1);
  assert.equal(sockets[0]!.closed, true);
  assert.equal(sockets.length, 2, "a fresh attempt starts at the deadline");
  assert.equal(link.status.state, "connecting");
});

test("a pong for an older ping does not cancel the probe", () => {
  const { clock, sockets, link } = setup();
  link.start();
  sockets[0]!.open();
  sockets[0]!.recv(ready);
  clock.freeze(60_000);
  link.foreground();
  const ping = pingOf(sockets[0]!)!;
  sockets[0]!.recv({ t: "pong", n: (ping.n ?? 0) - 1 });
  clock.advance(PROBE_MS);
  assert.equal(sockets[0]!.closed, true, "the probe went unanswered");
  assert.equal(sockets.length, 2);
});

test("duplicate foreground and nudge share one probe", () => {
  const { clock, sockets, link } = setup();
  link.start();
  sockets[0]!.open();
  sockets[0]!.recv(ready);
  link.foreground();
  link.foreground();
  link.nudge();
  const pings = sockets[0]!.sent.map((s) => JSON.parse(s) as { t: string }).filter((m) => m.t === "ping");
  assert.equal(pings.length, 1, "one probe ping, not one per event");
  sockets[0]!.recv({ t: "pong", n: pingOf(sockets[0]!)!.n });
  clock.advance(PROBE_MS);
  assert.equal(sockets.length, 1);
  assert.equal(link.status.state, "open");
});

test("a pong from a replaced socket does not affect the live attempt", () => {
  const { clock, sockets, link } = setup();
  link.start();
  sockets[0]!.open();
  sockets[0]!.recv(ready);
  link.foreground();
  assert.equal(sockets[0]!.closed, false);
  const n = pingOf(sockets[0]!)!.n;
  clock.advance(PROBE_MS);
  assert.equal(sockets.length, 2);
  assert.equal(link.status.state, "connecting");
  sockets[0]!.recv({ t: "pong", n });
  assert.equal(link.status.state, "connecting", "the old socket's answer is ignored");
  assert.equal(sockets[1]!.closed, false);
});

test("stop clears the probe timer too", () => {
  const { clock, sockets, link } = setup();
  link.start();
  sockets[0]!.open();
  sockets[0]!.recv(ready);
  clock.freeze(60_000);
  link.foreground();
  assert.equal(sockets[0]!.closed, false);
  assert.ok(clock.count() > 0);
  link.stop();
  assert.equal(clock.count(), 0);
  clock.advance(2 * PROBE_MS);
  assert.equal(clock.count(), 0);
  assert.equal(sockets.length, 1);
});

test("send() refuses while not open, so the outbox keeps the message", () => {
  const { sockets, link } = setup();
  link.start();
  assert.equal(link.send({ t: "ping", n: 1 }), false);
  sockets[0]!.open();
  sockets[0]!.recv(ready);
  assert.equal(link.send({ t: "ping", n: 1 }), true);
});

// ---- timeline ---------------------------------------------------------------------------------

const ev = (bodies: EventBody[]): SessionEvent[] => bodies.map((b, i) => ({ ...b, seq: i + 1, at: i } as SessionEvent));

test("streamed deltas become one message, replaced by the final assistant event", () => {
  const events = ev([
    { kind: "user", text: "hi", clientMsgId: "c1" },
    { kind: "state", state: "running" },
    { kind: "delta", msg: "m", text: "Hel" },
    { kind: "delta", msg: "m", text: "lo" },
  ]);
  let v = reduce(events);
  const a = v.items.find((i) => i.type === "assistant");
  assert.ok(a && a.type === "assistant" && a.text === "Hello" && a.streaming);
  v = reduce([...events, ...ev([{ kind: "assistant", msg: "m", model: "x", text: "Hello!", tools: [{ id: "t", name: "Bash", summary: "ls" }] }]).map((e) => ({ ...e, seq: 5 })),
    { kind: "tool_result", toolUseId: "t", ok: false, text: "nope", seq: 6, at: 6 } as SessionEvent]);
  const items = v.items.filter((i) => i.type === "assistant");
  assert.equal(items.length, 1);
  assert.ok(items[0]!.type === "assistant" && items[0]!.text === "Hello!" && items[0]!.tools[0]!.result?.ok === false);
});

test("response streaming ends at a main-content boundary, not at the end of all turn activity", () => {
  const bodies: EventBody[] = [
    { kind: "state", state: "running" },
    { kind: "delta", msg: "text", text: "Reviewing." },
    // A separate tool-only SDK message must also settle the preceding text.
    { kind: "assistant", msg: "tools", model: "main", text: "", tools: [{ id: "agent", name: "Agent", summary: "Review" }] },
    { kind: "subagent", toolUseId: "agent", sub: "worker", description: "Review", model: null, status: "running", steps: 0 },
    { kind: "tool_result", toolUseId: "agent", ok: true, text: "Started in background" },
    { kind: "subagent", toolUseId: "agent", sub: "worker", description: "Review", model: null, status: "done", steps: 3 },
    { kind: "delta", msg: "answer", text: "Done." },
    { kind: "assistant", msg: "answer", model: "main", text: "Done.", tools: [] },
    { kind: "result", ok: true, ms: 500, turns: 1 },
  ];
  const expected = [["atext"], [], [], [], [], ["aanswer"], [], []];
  for (let end = 2; end <= bodies.length; end++) {
    const view = reduce(ev(bodies.slice(0, end)));
    assert.deepEqual(view.items.filter(item => (item.type === "assistant" || item.type === "thinking") && item.streaming).map(item => item.key), expected[end - 2]);
    assert.equal(view.state, "running", "main activity is not response streaming");
    assert.equal(view.items.find(item => item.key === "atext")?.type, "assistant", "completed prose is retained");
  }
});

test("replayed terminal boundaries never revive a prior delta when a later turn is running", () => {
  const boundaries: EventBody[] = [
    { kind: "state", state: "idle" }, { kind: "state", state: "stopped" },
    { kind: "state", state: "error" }, { kind: "state", state: "waiting" },
    { kind: "notice", code: "interrupted" }, { kind: "notice", code: "host_restarted" },
    { kind: "permission", id: "p", tool: "Bash", title: "", summary: "ls", input: "ls", canAlways: false },
    { kind: "user", clientMsgId: "next", text: "Continue" },
    { kind: "turn", model: "main", effort: null },
  ];
  for (const boundary of boundaries) {
    const events = ev([{ kind: "state", state: "running" }, { kind: "delta", msg: "old", text: "Retained" }, boundary, { kind: "state", state: "running" }]);
    const replayed = mergeEvents(events.slice(0, 2), events.slice(1));
    const old = reduce(replayed).items.find(item => item.key === "aold");
    assert.ok(old?.type === "assistant" && !old.streaming && old.text === "Retained", JSON.stringify(boundary));
  }
});

test("only the current main segment streams; unrelated worker updates do not stop it", () => {
  const bodies: EventBody[] = [
    { kind: "state", state: "running" },
    { kind: "assistant", msg: "old-message", model: "main", text: "", tools: [{ id: "old", name: "Agent", summary: "Background" }] },
    { kind: "thinking", msg: "m", block: 0, text: "Reason", delta: true },
    { kind: "delta", msg: "m", text: "Answer" },
    { kind: "subagent", toolUseId: "old", sub: "worker", description: "Background", model: null, status: "done", steps: 5 },
    { kind: "tool_result", toolUseId: "old", ok: true, text: "Background done" },
  ];
  const view = reduce(ev(bodies));
  assert.ok(view.items.some(item => item.type === "assistant" && item.streaming && item.text === "Answer"));
  assert.ok(view.items.some(item => item.type === "thinking" && !item.streaming && item.text === "Reason"));
  const next = reduce(ev([...bodies, { kind: "thinking", msg: "next", block: 0, text: "Next", delta: true }]));
  assert.deepEqual(next.items.filter(item => (item.type === "assistant" || item.type === "thinking") && item.streaming).map(item => item.key), ["hnext:0"]);
});

test("permissions: open until decided, then recorded with the decision", () => {
  const base = ev([{ kind: "permission", id: "p", tool: "Bash", title: "", summary: "ls", input: "ls", canAlways: false }]);
  assert.equal(reduce(base).open.length, 1);
  const decided = [...base, { kind: "permission_decided", id: "p", decision: "expired", reason: "host_restarted", seq: 2, at: 2 } as SessionEvent];
  const v = reduce(decided);
  assert.equal(v.open.length, 0);
  const p = v.items.find((i) => i.type === "permission");
  assert.ok(p && p.type === "permission" && p.decision === "expired" && p.reason === "host_restarted");
});

test("an unacknowledged message shows as queued until the host echoes it", () => {
  const events = ev([{ kind: "user", text: "a", clientMsgId: "c1" }]);
  const out = [{ clientMsgId: "c1", text: "a", at: 0, state: "sending" as const }, { clientMsgId: "c2", text: "b", at: 1, state: "pending" as const }];
  const users = reduce(events, out).items.filter((i) => i.type === "user");
  assert.equal(users.length, 2);
  assert.equal(users[0]!.type === "user" && users[0]!.queued, undefined);
  assert.equal(users[1]!.type === "user" && users[1]!.queued, "pending");
});

test("mergeEvents is idempotent over overlapping pages", () => {
  const all = ev(Array.from({ length: 10 }, (_, i): EventBody => ({ kind: "notice", code: "resumed", text: String(i) })));
  let held = mergeEvents([], all.slice(5));
  held = mergeEvents(held, all.slice(0, 7));
  held = mergeEvents(held, all.slice(3, 10));
  assert.deepEqual(held.map((e) => e.seq), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test("every Korean key has an English twin and the same placeholders", () => {
  const ko = dictionaries.ko;
  const en = dictionaries.en;
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ko).sort());
  const vars = (s: string): string[] => (s.match(/\{\w+\}/g) ?? []).sort();
  for (const k of Object.keys(ko) as (keyof typeof ko)[]) assert.deepEqual(vars(en[k]), vars(ko[k]), k);
});

test("notifications: what the phone can do decides the card — https first, then the iPhone Home Screen rule", () => {
  const base = { secure: true, hasServiceWorker: true, hasPush: true, ios: false, standalone: false, permission: "default" as const, subscribed: false };
  assert.equal(pushAvailability({ ...base, secure: false }), "insecure");
  assert.equal(pushAvailability({ ...base, ios: true, hasPush: false }), "install", "iOS Safari tab: add to Home Screen, not 'unsupported'");
  assert.equal(pushAvailability({ ...base, ios: true, standalone: true }), "off");
  assert.equal(pushAvailability({ ...base, hasPush: false }), "unsupported");
  assert.equal(pushAvailability({ ...base, permission: "denied" }), "denied");
  assert.equal(pushAvailability({ ...base, permission: "granted", subscribed: true }), "on");
  assert.equal(pushAvailability({ ...base, permission: "granted", subscribed: false }), "off", "granted but no subscription yet: offer the button");
});

test("a Mac session's working time runs from the person's last message, not from when the host saw it running", () => {
  // Measured 2026-10-13 on 클로드리플: the app said 50 min (from the 23:31 message), the phone 11 min (from the host's first poll).
  const events: SessionEvent[] = [
    { kind: "user", text: "first", clientMsgId: "a", seq: 1, at: 100 },
    { kind: "user", text: "second", clientMsgId: "b", seq: 2, at: 500 },
    { kind: "state", state: "running", seq: 3, at: 3000 },
    { kind: "state", state: "stopped", seq: 4, at: 4000 },
    { kind: "state", state: "running", seq: 5, at: 4100 },
  ];
  assert.equal(reduce(events).turnStartedAt, 500);
  const idle: SessionEvent[] = [...events, { kind: "state", state: "idle", seq: 6, at: 5000 }];
  assert.equal(reduce(idle).turnStartedAt, null);
  assert.equal(reduce([...idle, { kind: "state", state: "running", seq: 7, at: 6000 }]).turnStartedAt, 6000, "woken without a message: from when it started");
});

// Coming back from another app counted the time spent there as the computer's silence (Discord,
// 2026-10-22): the banner said "no answer for 4 minutes" the moment the app returned.
test("the time spent in the background does not count as the computer's silence", () => {
  const { clock, sockets, link } = setup();
  link.start();
  sockets[0]!.open();
  sockets[0]!.recv(ready);
  sockets[0]!.close();
  const lostAt = link.status.downSince!;
  clock.advance(4 * 60_000);
  link.foreground();
  assert.equal(link.status.downSince, lostAt + 4 * 60_000);
  sockets.at(-1)!.open();
  sockets.at(-1)!.recv(ready);
  assert.equal(link.status.downSince, null);
});
