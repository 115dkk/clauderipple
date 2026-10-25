// The real App at its own boundaries: a fake WebSocket (what actually goes out), the browser storage
// it writes to (including the writes it refuses), and the public methods its buttons call. Nothing
// here re-implements the app's decisions, and nothing reaches into its internals.
import test from "node:test";
import assert from "node:assert/strict";
import { createSend, loadOutbox, outboxKey, tokenFingerprint, writeOutbox } from "../web/outbox.ts";
import type { OutboxEntry } from "../web/outbox.ts";
import type { QuestionDraft } from "../web/question-answers.ts";

const ORIGIN = "https://phone.example";
const TOKEN = "token-for-the-tests-0123456789";

/** localStorage as a browser gives it, able to refuse writes outright or after a count. */
class Storage {
  failWrites = false;
  failAfter: number | null = null;
  writes = 0;
  private map = new Map<string, string>();
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  setItem(key: string, value: string): void {
    if (this.failWrites || (this.failAfter !== null && this.writes >= this.failAfter)) {
      const error = new Error("full");
      error.name = "QuotaExceededError";
      throw error;
    }
    this.writes++;
    this.map.set(key, value);
  }
  keys(): string[] { return [...this.map.keys()]; }
  /** The stored queue as the app would read it after a reload. */
  stored(key: string): OutboxEntry[] {
    const load = loadOutbox(this, key);
    return load.status === "ok" || load.status === "partial" ? load.entries : [];
  }
}

/** The one socket the app opens; `frames` are the JSON text it actually sent. */
class Socket {
  static latest: Socket | null = null;
  static respond: ((op: Record<string, unknown>) => unknown | Promise<unknown>) | null = null;
  readyState = 0;
  frames: string[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) { this.url = url; Socket.latest = this; }
  send(data: string): void {
    this.frames.push(data);
    // Answer the host's request/response calls the app makes on connect, so their timers are cleared
    // and the test process is not held open by them (only the model list has a known answer here).
    const msg = JSON.parse(data) as { t?: string; reqId?: string; op?: Record<string, unknown> };
    if ((msg.t === "req" || msg.t === "decide") && msg.reqId) {
      const reqId = msg.reqId;
      const op = msg.t === "decide" ? { ...msg, op: "decide" } : msg.op ?? {};
      void Promise.resolve().then(() => Socket.respond ? Socket.respond(op) : msg.op?.op === "models" ? [] : null).then(
        answer => this.deliver({ t: "res", reqId, ok: true, data: answer }),
        error => this.deliver({ t: "res", reqId, ok: false, error: String(error) }),
      );
    }
  }
  open(): void { this.readyState = 1; this.onopen?.(); }
  deliver(msg: unknown): void { this.onmessage?.({ data: JSON.stringify(msg) }); }
  close(): void { this.readyState = 3; this.onclose?.(); }
}

interface Element {
  dataset: Record<string, string>;
  innerHTML: string;
  value: string;
  hidden: boolean;
  scrollTop: number;
}

/** The slice of the browser the app touches while rendering, plus the elements a test reads back. */
function install(storage: Storage): { sheet(): Element; body(): Element & { scrollTop: number } } {
  const elements = new Map<string, Element>();
  const el = (key: string): Element => {
    const found = elements.get(key);
    if (found) return found;
    const made = {
      dataset: {}, innerHTML: "", value: "", hidden: false,
      style: {}, children: [], parentElement: null, scrollTop: 0, scrollHeight: 0, clientHeight: 0,
      addEventListener: () => undefined, removeEventListener: () => undefined, append: () => undefined,
      remove: () => undefined, focus: () => undefined, setAttribute: () => undefined, replaceWith: () => undefined,
      insertBefore: () => undefined, removeChild: () => undefined, disconnect: () => undefined, observe: () => undefined,
      querySelector: () => null, querySelectorAll: () => [], getElementsByTagName: () => [],
    };
    elements.set(key, made);
    return made;
  };
  const define = (name: string, value: unknown): void => { Object.defineProperty(globalThis, name, { value, configurable: true, writable: true }); };
  define("localStorage", new Proxy(storage, {
    // Browser storage exposes stored keys as enumerable own properties, not the fixture's fields.
    ownKeys: () => storage.keys(),
    getOwnPropertyDescriptor: (_target, key) => typeof key === "string" && storage.getItem(key) !== null
      ? { configurable: true, enumerable: true, value: storage.getItem(key) } : undefined,
  }));
  define("WebSocket", Socket);
  define("document", {
    documentElement: { lang: "", dataset: {} as Record<string, string> },
    visibilityState: "visible",
    querySelector: (sel: string) => el(sel),
    querySelectorAll: () => [],
    getElementById: (id: string) => el(`#${id}`),
    createElement: (tag: string) => tag === "template" ? { innerHTML: "", content: { firstElementChild: el("template-child") } } : el(`<${tag}>`),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
  define("navigator", { languages: ["ko"], language: "ko", onLine: true });
  define("location", { hash: "", pathname: "/", search: "", origin: ORIGIN, protocol: "https:", host: "phone.example" });
  define("history", { replaceState: () => undefined, pushState: () => undefined });
  define("window", { addEventListener: () => undefined, isSecureContext: false, matchMedia: () => ({ matches: false }) });
  define("matchMedia", () => ({ matches: false }));
  define("requestAnimationFrame", (fn: () => void) => { fn(); return 0; });
  define("ResizeObserver", class { observe(): void {} disconnect(): void {} });
  // The app's own clocks are not under test and would hold the process open; Link's timers are
  // cleared by link.stop() at the end of each test.
  define("setInterval", () => 0);
  define("clearInterval", () => undefined);
  return { sheet: () => el("#sheet"), body: () => el("#worker-body") };
}

/** The app as its own public surface describes it. The import is untyped on purpose: app.ts is
 * browser code, type-checked by the web project, not by this Node test project. */
interface AppBoundary {
  start(): Promise<void>;
  go(screen: { name: "home" } | { name: "session"; id: string }): void;
  submit(text: string): boolean;
  act(name: string, el: { dataset: Record<string, string> }): Promise<void>;
  outbox: OutboxEntry[];
  ui: {
    draft: { cwd: string | null; model: string | null; effort: "high" | null };
    /** filled so the app does not ask the host for its model list (which leaves a request timer) */
    models: unknown[];
    expanded: Map<string, string | null>;
    questionDrafts: Map<string, QuestionDraft>;
    deciding: Set<string>;
    sheet: { kind: string; worker?: { sub: string; status: string }; expanded?: Map<string, string | null>; scroll?: number } | null;
  };
  link: { stop(): void } | null;
}
type AppCtor = new (status: unknown) => AppBoundary;
let AppClass: AppCtor | null = null;

interface Running {
  app: AppBoundary;
  socket: Socket;
  storage: Storage;
  sheet: () => Element;
  body: () => Element;
  key: string;
}

/** Start the app the way the browser does: token in storage, home screen, socket open, host ready. */
async function launch(storage: Storage, entries: OutboxEntry[] = []): Promise<Running> {
  const elements = install(storage);
  Socket.respond = null;
  const key = outboxKey({ kind: "direct", origin: ORIGIN, fingerprint: await tokenFingerprint(TOKEN) });
  if (entries.length) writeOutbox(storage, key, entries);
  storage.setItem("rr.token", JSON.stringify(TOKEN));
  if (AppClass === null) {
    // app.ts boots an App of its own as a side effect of being imported. Import it while the stored
    // token is blank, so that one shows the pairing screen and never opens a socket; then pair.
    storage.setItem("rr.token", JSON.stringify(""));
    const specifier = "../web/app.ts";
    const module: { App: AppCtor } = await import(specifier);
    AppClass = module.App;
    storage.setItem("rr.token", JSON.stringify(TOKEN));
  }
  const app = new AppClass({ state: "connecting", attempt: 0, nextAt: null, lastRx: null, downSince: null });
  app.ui.models = [{ provider: "test", label: "Test", usable: true, models: [{ model: "m", name: "M", provider: "test", efforts: ["high"], usable: true }] }];
  await app.start();
  const socket = Socket.latest;
  assert.ok(socket, "the app opened its socket");
  socket.open();
  socket.deliver({ t: "ready", host: { name: "Mac", version: "t", routerOk: true }, sessions: [] });
  return { app, socket, storage, sheet: elements.sheet, body: elements.body, key };
}

const parsed = (frames: readonly string[]): { t?: string; clientMsgId?: string }[] =>
  frames.map((frame) => JSON.parse(frame) as { t?: string; clientMsgId?: string });
const messageIds = (frames: readonly string[]): string[] =>
  parsed(frames).filter((m) => m.t === "send" || m.t === "create").map((m) => m.clientMsgId ?? "");

const entry = (over: Partial<OutboxEntry> = {}): OutboxEntry => ({
  clientMsgId: "a", text: "A 지시", at: 1_700_000_000_000, state: "pending", session: "s1", ...over,
});
const twoWaiting = (): OutboxEntry[] => [entry({ clientMsgId: "a" }), entry({ clientMsgId: "b", text: "B 지시", error: "no such session" })];

test("question drafts are isolated by session and epoch even when request IDs repeat", async () => {
  const running = await launch(new Storage());
  const events = [{ seq: 1, at: 1, kind: "permission", id: "same", tool: "AskUserQuestion", title: "", summary: "", input: "", canAlways: false, requestKind: "question", questions: [{ question: "Which?", header: "", multiSelect: false, options: [{ label: "A", description: "" }, { label: "B", description: "" }] }] }];
  const open = (session: string, epoch: string) => { running.app.go({ name: "session", id: session }); running.socket.deliver({ t: "events", session, epoch, events }); };
  try {
    open("a", "e1");
    await running.app.act("question-option", { dataset: { id: "same", index: "0", option: "0" } });
    open("b", "e1"); assert.equal(running.app.ui.questionDrafts.has("same"), false);
    await running.app.act("question-option", { dataset: { id: "same", index: "0", option: "1" } });
    running.app.go({ name: "session", id: "a" });
    assert.deepEqual(running.app.ui.questionDrafts.get("same")?.selected["Which?"], ["A"]);
    open("a", "e2"); assert.equal(running.app.ui.questionDrafts.has("same"), false);
    await running.app.act("deny", { dataset: { id: "same" } });
    const decision = running.socket.frames.map(frame => JSON.parse(frame) as { t: string; decision?: string; answers?: unknown }).find(frame => frame.t === "decide");
    assert.equal(decision?.decision, "deny"); assert.equal(decision?.answers, undefined, "denial does not invent answers for unanswered questions");
  } finally { running.app.link?.stop(); }
});

test("question navigation retains choices, refuses incomplete answers and preserves drafts after a refused submission", async () => {
  const running = await launch(new Storage());
  try {
    running.app.go({ name: "session", id: "s1" });
    const questions = [{ question: "First?", header: "First", multiSelect: false, options: [{ label: "A", description: "preview A" }] }, { question: "Second?", header: "Second", multiSelect: true, options: [{ label: "X", description: "preview X" }, { label: "Y", description: "preview Y" }] }];
    running.socket.deliver({ t: "events", session: "s1", epoch: "e", events: [{ seq: 1, at: 1, kind: "permission", id: "q", tool: "AskUserQuestion", title: "Questions", summary: "", input: "", canAlways: false, requestKind: "question", questions }] });
    const action = (name: string, index: string, option = "0") => running.app.act(name, { dataset: { id: "q", index, option } });
    const decisions = () => running.socket.frames.map(frame => JSON.parse(frame) as { t: string; answers?: Record<string, string> }).filter(frame => frame.t === "decide");
    await running.app.act("allow", { dataset: { id: "q" } }); assert.equal(decisions().length, 0);
    await action("question-option", "0");
    await action("question-jump", "1");
    await action("question-option", "1", "0"); await action("question-option", "1", "1");
    await action("question-jump", "0");
    assert.deepEqual(running.app.ui.questionDrafts.get("q")?.selected, { "First?": ["A"], "Second?": ["X", "Y"] });
    Socket.respond = op => { if (op.op === "decide") throw new Error("refused"); return null; };
    await running.app.act("allow", { dataset: { id: "q" } });
    assert.equal(running.app.ui.deciding.has("q"), false);
    assert.deepEqual(decisions()[0]?.answers, { "First?": "A", "Second?": "X, Y" });
    assert.deepEqual(running.app.ui.questionDrafts.get("q")?.selected["Second?"], ["X", "Y"]);
    Socket.respond = () => null;
    await Promise.all([running.app.act("allow", { dataset: { id: "q" } }), running.app.act("allow", { dataset: { id: "q" } })]);
    assert.equal(decisions().length, 2, "the retry sends once, even with a second click while awaiting confirmation");
    running.socket.deliver({ t: "events", session: "s1", epoch: "e", events: [{ seq: 2, at: 2, kind: "permission_decided", id: "q", decision: "allow" }] });
    await running.app.act("allow", { dataset: { id: "q" } });
    assert.equal(decisions().length, 2, "an old button cannot decide a completed request again");
  } finally { running.app.link?.stop(); }
});

test("a decided plan loads every blob chunk through the read-only detail path", async () => {
  const running = await launch(new Storage());
  const ops: Record<string, unknown>[] = [];
  try {
    running.app.go({ name: "session", id: "s1" });
    running.socket.deliver({ t: "events", session: "s1", epoch: "e", events: [{ seq: 1, at: 1, kind: "permission", id: "plan", tool: "ExitPlanMode", title: "Plan", summary: "", input: { blob: "plan-blob", bytes: 10, preview: "preview" }, canAlways: false, requestKind: "plan" }, { seq: 2, at: 2, kind: "permission_decided", id: "plan", decision: "allow" }] });
    Socket.respond = op => { ops.push(op); return op.offset === 0 ? { text: "First\n", next: 6 } : { text: "Last", next: null }; };
    const before = running.socket.frames.length;
    await running.app.act("tool", { dataset: { id: "plan" } });
    assert.equal(running.app.ui.expanded.get("plan"), "First\nLast");
    assert.deepEqual(ops.map(op => [op.op, op.offset]), [["blob", 0], ["blob", 6]]);
    assert.ok(parsed(running.socket.frames.slice(before)).every(frame => frame.t === "req"), "reviewing never sends another decision");
  } finally { running.app.link?.stop(); }
});

test("worker navigation loads every page and returns through parent frames with instructions, status and position intact", async () => {
  const running = await launch(new Storage());
  const event = (seq: number, body: Record<string, unknown>) => ({ seq, at: seq, ...body });
  const worker = (seq: number, name: string, status = "done") => event(seq, { kind: "subagent", toolUseId: name, sub: `sub-${name}`, description: name, model: "sol", status, steps: 1 });
  const call = (seq: number, name: string) => event(seq, { kind: "assistant", msg: name, model: "sol", text: "", tools: [{ id: name, name: "Agent", summary: name, input: JSON.stringify({ prompt: `${name} exact instruction\nsecond line` }) }] });
  const requests: Record<string, unknown>[] = [];
  Socket.respond = op => {
    requests.push(op);
    if (op.op !== "sub") return null;
    if (op.sub === "sub-parent") return op.afterSeq === 0
      ? { events: [call(1, "child"), worker(2, "child", "failed")], more: true }
      : { events: [event(3, { kind: "assistant", msg: "late", model: "sol", text: "Last page answer", tools: [] })], more: false };
    if (op.sub === "sub-child") return { events: [call(1, "grandchild"), worker(2, "grandchild")], more: false };
    return { events: [event(1, { kind: "assistant", msg: "final", model: "sol", text: "Grandchild answer", tools: [] })], more: false };
  };
  try {
    running.app.go({ name: "session", id: "s1" });
    running.socket.deliver({ t: "events", session: "s1", epoch: "e", events: [call(1, "parent"), worker(2, "parent")] });
    await running.app.act("sub", { dataset: { id: "sub-parent" } });
    assert.ok(running.sheet().innerHTML.includes("parent exact instruction\nsecond line"));
    assert.ok(running.sheet().innerHTML.includes("Last page answer"), "the last page is reachable");
    await running.app.act("tool-group", { dataset: { id: "gschild" } });
    const parent = running.app.ui.sheet;
    assert.ok(parent?.expanded?.has("gschild"));
    running.body().dataset.sub = "sub-parent";
    running.body().scrollTop = 237;
    await running.app.act("sub", { dataset: { id: "sub-child" } });
    assert.ok(running.sheet().innerHTML.includes("child exact instruction\nsecond line"));
    assert.equal(running.app.ui.sheet?.worker?.status, "failed");
    running.body().dataset.sub = "sub-child";
    running.body().scrollTop = 91;
    await running.app.act("sub", { dataset: { id: "sub-grandchild" } });
    assert.ok(running.sheet().innerHTML.includes("Grandchild answer"));
    await running.app.act("worker-back", { dataset: {} });
    assert.equal(running.app.ui.sheet?.worker?.sub, "sub-child");
    assert.equal(running.app.ui.sheet?.worker?.status, "failed");
    assert.equal(running.body().scrollTop, 91);
    await running.app.act("worker-back", { dataset: {} });
    assert.equal(running.app.ui.sheet, parent, "the same frame retains all its UI state");
    assert.equal(running.body().scrollTop, 237);
    assert.ok(parent?.expanded?.has("gschild"));
    assert.deepEqual(requests.filter(op => op.op === "sub").map(op => [op.sub, op.afterSeq]), [["sub-parent", 0], ["sub-parent", 2], ["sub-child", 0], ["sub-grandchild", 0]]);
    await running.app.act("close-sheet", { dataset: {} });
    assert.equal(running.app.ui.sheet, null);
  } finally { running.app.link?.stop(); }
});

test("a failed worker read offers retry; late results cannot reopen a closed worker or another session", async () => {
  const running = await launch(new Storage());
  try {
    running.app.go({ name: "session", id: "s1" });
    Socket.respond = () => { throw new Error("read failed"); };
    await running.app.act("sub", { dataset: { id: "sub-missing" } });
    assert.ok(running.sheet().innerHTML.includes("read failed"));
    assert.ok(running.sheet().innerHTML.includes('data-act="worker-retry"'));
    const pending = Promise.withResolvers<unknown>();
    Socket.respond = () => pending.promise;
    const retry = running.app.act("worker-retry", { dataset: {} });
    await running.app.act("close-sheet", { dataset: {} });
    running.app.go({ name: "session", id: "s2" });
    pending.resolve({ events: [], more: false });
    await retry;
    assert.equal(running.app.ui.sheet, null);
    assert.ok(!running.sheet().innerHTML.includes('id="worker-body"'));
  } finally { running.app.link?.stop(); }
});

test("a retry sends the message the person picked, and nothing else waiting beside it", async () => {
  const running = await launch(new Storage(), twoWaiting());
  try {
    running.app.go({ name: "session", id: "s1" });
    const before = running.socket.frames.length;
    await running.app.act("retry-send", { dataset: { id: "b" } });
    assert.deepEqual(messageIds(running.socket.frames.slice(before)), ["b"], "only B went out");
  } finally {
    running.app.link?.stop();
  }
});

test("while the queue cannot be stored, a retry sends nothing and keeps the words", async () => {
  const running = await launch(new Storage(), twoWaiting());
  try {
    running.app.go({ name: "session", id: "s1" });
    running.storage.failWrites = true;
    const before = running.socket.frames.length;
    await running.app.act("retry-send", { dataset: { id: "b" } });
    assert.deepEqual(running.socket.frames.slice(before), [], "nothing left the phone");
    assert.equal(running.app.outbox.find((o) => o.clientMsgId === "b")?.error, "no such session", "B keeps its words and its reason");
  } finally {
    running.app.link?.stop();
  }
});

test("a reconnect pass sends only the queued messages this browser is keeping", async () => {
  const running = await launch(new Storage(), [
    entry({ clientMsgId: "queued" }),
    entry({ clientMsgId: "recovered", delivery: "recovered" }),
    entry({ clientMsgId: "held", delivery: "held", hold: "unknown_outcome", state: "sending" }),
    entry({ clientMsgId: "refused", error: "no such session" }),
  ]);
  try {
    assert.deepEqual(messageIds(running.socket.frames), ["queued"], "the ready message sent only the queued one");
  } finally {
    running.app.link?.stop();
  }
});

test("a new message is stored before it is sent, and not sent at all when the write is refused", async () => {
  const running = await launch(new Storage());
  try {
    running.app.go({ name: "session", id: "s1" });
    const before = running.socket.frames.length;
    assert.equal(running.app.submit("새 지시"), true);
    const frames = running.socket.frames.slice(before);
    assert.equal(frames.length, 1, "one send frame");
    const id = messageIds(frames)[0];
    assert.equal(running.storage.stored(running.key).find((o) => o.clientMsgId === id)?.state, "sending", "written as an attempt before the frame went out");

    running.storage.failWrites = true;
    const counted = running.socket.frames.length;
    const queued = running.app.outbox.length;
    assert.equal(running.app.submit("저장 안 되는 지시"), false, "the words stay in the field instead");
    assert.equal(running.socket.frames.length, counted, "nothing was sent");
    assert.equal(running.app.outbox.length, queued, "and no phantom message was left in the queue");
  } finally {
    running.app.link?.stop();
  }
});

// The attempt reaches the disk before the frame does, so a reload never mistakes a sent message for
// one that was never sent — which is what would make an edited retry start a second session.
test("a sent message reads as attempted after a reload; one that never left reads as never sent", async () => {
  const running = await launch(new Storage());
  try {
    running.app.go({ name: "home" });
    running.app.ui.draft = { cwd: "/Users/me/code/app", model: "gpt-6.1-sol", effort: "high" };
    assert.equal(running.app.submit("세션 만들어 줘"), true);
    const created = running.app.outbox[0]!;
    const reloaded = running.storage.stored(running.key).find((o) => o.clientMsgId === created.clientMsgId);
    assert.equal(reloaded?.state, "sending", "the attempt is on disk before the create frame");
    // Reload, then the person tries to send edited words from that screen: nothing new is started.
    assert.deepEqual(createSend(reloaded, "고친 지시", () => "brand-new"), { kind: "held" });

    // The other side: the frame never leaves (the socket is gone), so its stored state goes back to
    // pending and an edited retry is a new message rather than a maybe-duplicate.
    running.app.go({ name: "session", id: "s1" });
    running.socket.close();
    await new Promise((resolve) => setImmediate(resolve));
    running.app.submit("보내지 못한 지시");
    const unsent = running.app.outbox.find((o) => o.text === "보내지 못한 지시");
    assert.equal(unsent?.state, "pending", "nothing left, so it is not marked as an attempt");
    assert.equal(running.storage.stored(running.key).find((o) => o.text === "보내지 못한 지시")?.state, "pending");
  } finally {
    running.app.link?.stop();
  }
});

test("a reconnect retries a failed queue write before automatically sending anything", async () => {
  const running = await launch(new Storage());
  try {
    running.socket.close();
    await new Promise(resolve => setImmediate(resolve));
    running.app.go({ name: "session", id: "s1" });
    running.storage.failAfter = running.storage.writes + 1; // queue saved, intent write refused
    assert.equal(running.app.submit("복구 후 전송할 지시"), true);
    assert.equal(messageIds(running.socket.frames).length, 0);
    running.storage.failAfter = null;
    await running.app.act("retry", { dataset: {} });
    const reconnected = Socket.latest;
    assert.ok(reconnected && reconnected !== running.socket, "the retry creates a fresh socket");
    reconnected.open();
    reconnected.deliver({ t: "ready", host: { name: "Mac", version: "t", routerOk: true }, sessions: [] });
    assert.equal(messageIds(reconnected.frames).length, 1, "restored storage must not strand the queue forever");
    assert.equal(running.storage.stored(running.key)[0]?.state, "sending");
  } finally { running.app.link?.stop(); }
});

test("taking a refused message back never loses it when the draft cannot be stored", async () => {
  const running = await launch(new Storage(), twoWaiting());
  try {
    running.app.go({ name: "session", id: "s1" });
    running.storage.failWrites = true;
    await running.app.act("edit-send", { dataset: { id: "b" } });
    assert.equal(running.storage.getItem("rr.typed.s:s1"), null, "the draft was not written");
    assert.ok(running.app.outbox.some((o) => o.clientMsgId === "b"), "so the message keeps its words in the queue");
    running.storage.failWrites = false;
    await running.app.act("edit-send", { dataset: { id: "b" } });
    assert.equal(running.storage.getItem("rr.typed.s:s1"), JSON.stringify("B 지시"), "the words are safely in the stored draft first");
    assert.ok(!running.app.outbox.some((o) => o.clientMsgId === "b"), "and only then does the entry hand them over");
  } finally {
    running.app.link?.stop();
  }
});

test("the open recovery sheet is redrawn when a retry takes its message", async () => {
  const held = entry({ clientMsgId: "h", text: "결과 미확인 지시", delivery: "held", hold: "unknown_outcome", state: "sending" });
  const running = await launch(new Storage(), [held]);
  try {
    running.app.go({ name: "home" });
    await running.app.act("recovery-open", { dataset: {} });
    assert.ok(running.sheet().innerHTML.includes("결과 미확인 지시"), "the sheet lists the held message");
    assert.ok(running.sheet().innerHTML.includes("요청 처리 결과를 확인할 수 없습니다."));
    await running.app.act("retry-send", { dataset: { id: "h" } });
    assert.ok(!running.sheet().innerHTML.includes("결과 미확인 지시"), "the row is gone once its retry was taken");
  } finally {
    running.app.link?.stop();
  }
});
