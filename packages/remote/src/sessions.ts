// Sessions are the host's. Each one is a Claude Code process driven through the Agent SDK in
// a folder and on a model the phone chose, sent through the router like any CLI (ARCHITECTURE
// §1: HTTPS_PROXY + NODE_EXTRA_CA_CERTS — not ANTHROPIC_BASE_URL, which the router's proxy port
// answers 405; measured 2026-10-11, docs/specs/2026-10-11-ripple-remote-ux.md). Everything a
// phone may need later goes into the session's event log before it goes to any socket.
import { randomUUID } from "node:crypto";
import path from "node:path";
import { EventLog } from "./eventlog.ts";
import { DesktopSessions } from "./desktop.ts";
import { isDirectory } from "./folders.ts";
import { readJson, writeFileAtomic } from "./fsutil.ts";
import type { Decision, PermissionQueue } from "./permissions.ts";
import type { Effort, EventBody, Figures, SessionEvent, SessionState, SessionSummary, ToolCall } from "./protocol.ts";
import type { RouterClient } from "./router.ts";

// ---- the slice of the Agent SDK this file relies on (typed loosely so tests can fake it) ----

export interface SdkUserMessage { type: "user"; message: { role: "user"; content: string }; parent_tool_use_id: null; session_id: string; origin?: { kind: "human" } }
export interface SdkQuery extends AsyncIterable<Record<string, unknown>> {
  interrupt(): Promise<unknown>;
  setModel(model?: string): Promise<void>;
  close(): void;
}
export type PermissionAnswer =
  | { behavior: "allow"; updatedInput?: Record<string, unknown>; updatedPermissions?: unknown[] }
  | { behavior: "deny"; message: string; interrupt?: boolean };
export type CanUseTool = (tool: string, input: Record<string, unknown>, opts: { signal: AbortSignal; suggestions?: unknown[]; title?: string; decisionReason?: string; toolUseID?: string }) => Promise<PermissionAnswer>;
export type QueryFn = (params: { prompt: AsyncIterable<SdkUserMessage>; options: Record<string, unknown> }) => SdkQuery;

interface SessionRecord {
  id: string;
  sdkSessionId: string | null;
  cwd: string;
  model: string;
  effort: Effort | null;
  title: string;
  createdAt: number;
  updatedAt: number;
  state: SessionState;
  createdBy: string;
  contextWindow: number | null;
}

interface Live {
  query: SdkQuery;
  input: Inbox;
  abort: AbortController;
  /** Text deltas waiting to be written (coalesced, ~80 ms). */
  buffer: { msg: string; text: string } | null;
  flushTimer: ReturnType<typeof setTimeout> | null;
  /** Content blocks of the API message being streamed, merged across the SDK's per-block messages. */
  current: { msg: string; text: string; tools: ToolCall[]; model: string } | null;
  /** Task/Agent tool ids → their subagent while it runs */
  subs: Map<string, { description: string; model: string | null; steps: number }>;
  turnStart: number;
  restartAfterTurn: boolean;
  retried: boolean;
  interrupted: boolean;
}

export interface SessionsOptions {
  dir: string;
  router: Pick<RouterClient, "status" | "figures">;
  permissions: PermissionQueue;
  queryFn: QueryFn;
  claudePath?: string;
  onEvent: (session: string, event: SessionEvent) => void;
  onSessions: () => void;
  now?: () => number;
  coalesceMs?: number;
  /** Enabled by main; tests can use an isolated synthetic projects directory. */
  desktopProjects?: string;
  desktopProcesses?: () => string;
}

/** An async iterable the SDK reads user messages from; a session's query lives as long as it. */
class Inbox implements AsyncIterable<SdkUserMessage> {
  private queue: SdkUserMessage[] = [];
  private waiting: ((r: IteratorResult<SdkUserMessage>) => void) | null = null;
  private done = false;
  push(m: SdkUserMessage): void {
    if (this.done) return;
    if (this.waiting) { const w = this.waiting; this.waiting = null; w({ value: m, done: false }); } else this.queue.push(m);
  }
  close(): void {
    this.done = true;
    if (this.waiting) { const w = this.waiting; this.waiting = null; w({ value: undefined, done: true }); }
  }
  [Symbol.asyncIterator](): AsyncIterator<SdkUserMessage> {
    return {
      next: () => {
        const m = this.queue.shift();
        if (m) return Promise.resolve({ value: m, done: false });
        if (this.done) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => { this.waiting = resolve; });
      },
    };
  }
}

/** Routed models take their effort as `model@level`, which the router reads (ARCHITECTURE §3a); Claude models take the SDK's own option. */
export function modelArg(model: string, effort: Effort | null): { model: string; effort?: Effort } {
  if (model.startsWith("claude-")) return effort && ["low", "medium", "high", "xhigh", "max"].includes(effort) ? { model, effort } : { model };
  return { model: effort ? `${model}@${effort}` : model };
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const oneLine = (s: string, n = 200): string => { const l = s.split("\n").find((x) => x.trim()) ?? ""; return l.length > n ? l.slice(0, n - 1) + "…" : l; };

/** One line a person reads to know what a tool call does. */
export function summarize(tool: string, input: Record<string, unknown>, cwd: string): string {
  const rel = (p: string): string => (p && path.isAbsolute(p) && (p === cwd || p.startsWith(cwd + "/")) ? path.relative(cwd, p) || "." : p);
  switch (tool) {
    case "Bash": return oneLine(str(input.command));
    case "Read": case "Write": case "Edit": case "MultiEdit": return rel(str(input.file_path));
    case "NotebookEdit": return rel(str(input.notebook_path));
    case "Glob": return str(input.pattern);
    case "Grep": return `${str(input.pattern)}${input.path ? "  " + rel(str(input.path)) : ""}`;
    case "WebFetch": return str(input.url);
    case "WebSearch": return str(input.query);
    case "Task": case "Agent": return oneLine(str(input.description));
    case "TodoWrite": return Array.isArray(input.todos) ? `${input.todos.length}` : "";
    default: {
      const first = Object.values(input).find((v) => typeof v === "string") as string | undefined;
      return first ? oneLine(first) : oneLine(JSON.stringify(input), 120);
    }
  }
}

/** What the permission card shows in full: the command, the change, or the arguments. */
export function permissionDetail(tool: string, input: Record<string, unknown>, cwd: string): string {
  if (tool === "Bash") return str(input.command);
  if (tool === "Edit") return `${summarize(tool, input, cwd)}\n- ${str(input.old_string).split("\n").join("\n- ")}\n+ ${str(input.new_string).split("\n").join("\n+ ")}`;
  if (tool === "Write") return `${summarize(tool, input, cwd)}\n${str(input.content)}`;
  return JSON.stringify(input, null, 2);
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content === undefined ? "" : JSON.stringify(content);
  return content.map((b: { type?: string; text?: string }) => (b?.type === "text" ? b.text ?? "" : b?.type === "image" ? "[image]" : "")).join("\n");
}

export class Sessions {
  private opts: SessionsOptions;
  private records = new Map<string, SessionRecord>();
  private logs = new Map<string, EventLog>();
  private live = new Map<string, Live>();
  private figuresAt = new Map<string, number>();
  private lastFigures = new Map<string, string>();
  private creating = new Map<string, Promise<string>>();
  private file: string;
  private now: () => number;
  private desktop: DesktopSessions | null;
  private desktopModels = new Map<string, { model: string; effort: Effort | null }>();

  constructor(opts: SessionsOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
    this.file = path.join(opts.dir, "sessions.json");
    for (const r of readJson<SessionRecord[]>(this.file) ?? []) this.records.set(r.id, r);
    this.desktop = opts.desktopProjects === undefined ? null : new DesktopSessions({
      projects: opts.desktopProjects, now: this.now, summarize, ...(opts.desktopProcesses ? { processes: opts.desktopProcesses } : {}),
      excluded: () => new Set(Array.from(this.records.values()).flatMap(r => r.sdkSessionId ? [r.id, r.sdkSessionId] : [r.id])),
    });
  }

  /** After a host restart: no query survived, so say so in every session that was mid-turn, and close what it was asking. */
  recover(): void {
    for (const p of this.opts.permissions.expiredOnOpen) {
      if (this.records.has(p.session)) this.append(p.session, { kind: "permission_decided", id: p.id, decision: "expired", reason: "host_restarted" });
    }
    for (const r of this.records.values()) {
      if (r.state === "running" || r.state === "starting" || r.state === "waiting") {
        this.append(r.id, { kind: "notice", code: "host_restarted" });
        this.setState(r, "stopped");
      }
    }
  }

  list(): SessionSummary[] {
    const host = Array.from(this.records.values()).sort((a, b) => b.updatedAt - a.updatedAt).map((r) => this.summary(r));
    return [...host, ...(this.desktop?.list() ?? []).map(s => ({ ...s, ...this.desktopModels.get(s.id) }))];
  }

  pollDesktop(): void {
    if (this.desktop?.poll()) this.opts.onSessions();
  }

  has(id: string): boolean { return this.records.has(id) || (this.desktop?.has(id) ?? false); }

  private continueDesktop(id: string, clientMsgId: string): SessionRecord {
    if (!this.desktop) throw new Error("no such session");
    const { summary: s, open } = this.desktop.continuation(id);
    const log = this.desktop.importInto(id, path.join(this.opts.dir, "sessions", id), this.now);
    const r: SessionRecord = { id, sdkSessionId: id, cwd: s.cwd, model: s.model, effort: s.effort, title: s.title, createdAt: s.createdAt, updatedAt: this.now(), state: "stopped", createdBy: clientMsgId, contextWindow: null };
    Object.assign(r, this.desktopModels.get(id));
    this.desktopModels.delete(id);
    this.logs.set(id, log);
    this.records.set(id, r);
    this.save();
    this.append(id, { kind: "notice", code: open ? "desktop_open" : "desktop_resumed" });
    this.opts.onSessions();
    return r;
  }

  /** A turn is in progress somewhere (including one waiting on the phone for a permission). */
  busy(): boolean {
    for (const r of this.records.values()) if (r.state === "starting" || r.state === "running" || r.state === "waiting") return true;
    return false;
  }

  summaryOf(id: string): SessionSummary | undefined {
    const r = this.records.get(id);
    return r ? this.summary(r) : undefined;
  }

  private summary(r: SessionRecord): SessionSummary {
    const log = this.log(r.id);
    return { origin: "host", readOnly: false, id: r.id, title: r.title, cwd: r.cwd, model: r.model, effort: r.effort, state: r.state, pending: this.opts.permissions.pending(r.id).length, createdAt: r.createdAt, updatedAt: r.updatedAt, lastSeq: log.lastSeq, epoch: log.epoch };
  }

  log(id: string): EventLog {
    if (!this.records.has(id)) {
      if (this.desktop?.has(id)) return this.desktop.log(id);
      throw new Error("no such session");
    }
    let log = this.logs.get(id);
    if (!log) { log = EventLog.open({ dir: path.join(this.opts.dir, "sessions", id), now: this.now }); this.logs.set(id, log); }
    return log;
  }

  subLog(id: string, sub: string): EventLog | null {
    if (!/^sub-[\w-]{1,80}$/.test(sub) || !this.records.has(id)) return null;
    const key = `${id}/${sub}`;
    let log = this.logs.get(key);
    if (!log) { log = EventLog.open({ dir: path.join(this.opts.dir, "sessions", id, sub), now: this.now }); this.logs.set(key, log); }
    return log;
  }

  recentSources(): { path: string; lastUsed: number; model: string }[] {
    return Array.from(this.records.values()).map((r) => ({ path: r.cwd, lastUsed: r.updatedAt, model: r.model }));
  }

  private save(): void {
    writeFileAtomic(this.file, JSON.stringify(Array.from(this.records.values()), null, 1));
  }

  private append(id: string, body: EventBody): SessionEvent {
    const event = this.log(id).append(body);
    const r = this.records.get(id);
    if (r) r.updatedAt = this.now();
    this.opts.onEvent(id, event);
    return event;
  }

  private setState(r: SessionRecord, state: SessionState, detail?: string): void {
    if (r.state === state && !detail) return;
    r.state = state;
    this.append(r.id, { kind: "state", state, ...(detail ? { detail } : {}) });
    this.save();
    this.opts.onSessions();
  }

  // ---- what the phone asks for --------------------------------------------------------------

  /** Idempotent on clientMsgId: a phone that resends after a dropped ack gets the same session. */
  create(req: { clientMsgId: string; cwd: string; model: string; effort: Effort | null; text: string }): Promise<string> {
    for (const r of this.records.values()) if (r.createdBy === req.clientMsgId) return Promise.resolve(r.id);
    // A resend can arrive while the first create is still checking the folder; both get the one session.
    let pending = this.creating.get(req.clientMsgId);
    if (!pending) {
      pending = this.createNew(req).finally(() => this.creating.delete(req.clientMsgId));
      this.creating.set(req.clientMsgId, pending);
    }
    return pending;
  }

  private async createNew(req: { clientMsgId: string; cwd: string; model: string; effort: Effort | null; text: string }): Promise<string> {
    const cwd = path.resolve(req.cwd);
    if (!(await isDirectory(cwd))) throw new Error(`not a folder: ${cwd}`);
    const now = this.now();
    const r: SessionRecord = { id: randomUUID(), sdkSessionId: null, cwd, model: req.model, effort: req.effort, title: oneLine(req.text, 80), createdAt: now, updatedAt: now, state: "starting", createdBy: req.clientMsgId, contextWindow: null };
    this.records.set(r.id, r);
    this.save();
    this.append(r.id, { kind: "state", state: "starting" });
    this.send(r.id, req.clientMsgId, req.text);
    this.opts.onSessions();
    return r.id;
  }

  /** Idempotent on clientMsgId. Starts (or resumes) the query when none is live. */
  send(id: string, clientMsgId: string, text: string): string {
    const r = this.records.get(id) ?? this.continueDesktop(id, clientMsgId);
    id = r.id;
    if (this.seen(id, clientMsgId)) return id;
    this.append(id, { kind: "user", text, clientMsgId });
    let live = this.live.get(id);
    if (!live) live = this.start(r);
    // A message sent while a turn runs is queued by the CLI and starts no turn of its own yet.
    if (r.state !== "running" && r.state !== "waiting") {
      live.turnStart = this.now();
      this.append(id, { kind: "turn", model: r.model, effort: r.effort });
      this.setState(r, "running");
    }
    live.input.push({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null, session_id: r.sdkSessionId ?? "", origin: { kind: "human" } });
    return id;
  }

  private seen(id: string, clientMsgId: string): boolean {
    // The log is the record of what was received; scan from the end, where a resend's original is.
    const log = this.log(id);
    let before = log.lastSeq + 1;
    for (let pages = 0; pages < 8 && before > 1; pages++) {
      const page = log.before(before);
      for (const e of page.events) if (e.kind === "user" && e.clientMsgId === clientMsgId) return true;
      if (!page.hasOlder || !page.events.length) break;
      before = page.events[0]!.seq;
    }
    return false;
  }

  decide(id: string, permId: string, decision: "allow" | "allow_always" | "deny"): boolean {
    const p = this.opts.permissions.get(permId);
    if (!p || p.session !== id) return false;
    return this.opts.permissions.decide(permId, decision) !== null;
  }

  async interrupt(id: string): Promise<void> {
    const live = this.live.get(id);
    if (!live) return;
    // Open requests resolve as expired; their canUseTool continuation writes the event.
    this.opts.permissions.expireSession(id, "aborted");
    const r = this.records.get(id);
    // Only a running turn can be stopped; a flag set while idle would swallow the next real result.
    if (!r || (r.state !== "running" && r.state !== "waiting")) return;
    live.interrupted = true;
    await live.query.interrupt().catch(() => undefined);
    this.append(id, { kind: "notice", code: "interrupted" });
  }

  async setModel(id: string, model: string, effort: Effort | null): Promise<void> {
    if (!this.records.has(id) && this.desktop?.has(id)) {
      this.desktopModels.set(id, { model, effort });
      this.opts.onSessions();
      return;
    }
    const r = this.records.get(id);
    if (!r) throw new Error("no such session");
    const changedModel = r.model !== model;
    r.model = model;
    r.effort = effort;
    this.save();
    this.append(id, { kind: "notice", code: "model_changed", text: effort ? `${model} · ${effort}` : model });
    const live = this.live.get(id);
    if (!live) { this.opts.onSessions(); return; }
    // A routed model's effort rides on its id, so setModel covers both. A Claude model's effort is a
    // process option: the query is closed after this turn and the next message resumes it with the new one.
    if (changedModel || !model.startsWith("claude-")) await live.query.setModel(modelArg(model, effort).model).catch(() => { live.restartAfterTurn = true; });
    else live.restartAfterTurn = true;
    if (live.restartAfterTurn && (r.state === "idle" || r.state === "error")) this.stop(id);
    this.opts.onSessions();
  }

  stop(id: string): void {
    const live = this.live.get(id);
    if (!live) return;
    this.live.delete(id);
    live.input.close();
    live.abort.abort();
    try { live.query.close(); } catch { /* already ended */ }
  }

  shutdown(): void {
    for (const id of Array.from(this.live.keys())) this.stop(id);
    for (const log of this.logs.values()) log.close();
    this.desktop?.close();
  }

  // ---- the query ----------------------------------------------------------------------------

  private start(r: SessionRecord): Live {
    const abort = new AbortController();
    const input = new Inbox();
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    delete env.ANTHROPIC_BASE_URL;
    delete env.CLAUDECODE;
    const m = modelArg(r.model, r.effort);
    const options: Record<string, unknown> = {
      cwd: r.cwd,
      model: m.model,
      ...(m.effort ? { effort: m.effort } : {}),
      includePartialMessages: true,
      settingSources: ["user", "project", "local"],
      abortController: abort,
      env,
      canUseTool: this.canUseTool(r.id),
      stderr: (line: string) => { if (!line.includes("unrecognized_model")) process.stderr.write(`[session ${r.id.slice(0, 8)}] ${line}`); },
      ...(r.sdkSessionId ? { resume: r.sdkSessionId } : {}),
      ...(this.opts.claudePath ? { pathToClaudeCodeExecutable: this.opts.claudePath } : {}),
    };
    const live: Live = { query: null as unknown as SdkQuery, input, abort, buffer: null, flushTimer: null, current: null, subs: new Map(), turnStart: this.now(), restartAfterTurn: false, retried: false, interrupted: false };
    this.live.set(r.id, live);
    void this.opts.router.status().then((s) => {
      // The router's own word on where its proxy and CA are wins over whatever this process inherited.
      Object.assign(env, s.proxyEnv);
    }).finally(() => {
      if (this.live.get(r.id) !== live) return;
      live.query = this.opts.queryFn({ prompt: input, options });
      void this.consume(r, live);
    });
    return live;
  }

  private async consume(r: SessionRecord, live: Live): Promise<void> {
    let failure: string | null = null;
    try {
      for await (const msg of live.query) this.handle(r, live, msg);
    } catch (e) {
      if (!live.abort.signal.aborted) failure = (e as Error).message;
    }
    this.flush(r.id, live);
    if (this.live.get(r.id) === live) this.live.delete(r.id);
    this.opts.permissions.expireSession(r.id, "aborted");
    if (failure) {
      this.append(r.id, { kind: "result", ok: false, error: failure, ms: this.now() - live.turnStart, turns: 0 });
      this.setState(r, "error", failure.slice(0, 300));
    } else if (r.state !== "idle" && r.state !== "error") this.setState(r, "stopped");
  }

  private handle(r: SessionRecord, live: Live, msg: Record<string, unknown>): void {
    const parent = (msg.parent_tool_use_id as string | null | undefined) ?? null;
    switch (msg.type) {
      case "system": {
        if (msg.subtype === "init" && typeof msg.session_id === "string" && r.sdkSessionId !== msg.session_id) {
          r.sdkSessionId = msg.session_id;
          this.save();
          this.opts.onSessions();
        }
        if (msg.subtype === "api_retry" && !live.retried) { live.retried = true; this.append(r.id, { kind: "notice", code: "api_retry" }); }
        return;
      }
      case "stream_event": {
        if (parent) return;
        const ev = msg.event as { type?: string; message?: { id?: string }; delta?: { type?: string; text?: string } } | undefined;
        if (ev?.type === "message_start" && ev.message?.id) {
          this.flush(r.id, live);
          live.current = { msg: ev.message.id, text: "", tools: [], model: r.model };
        } else if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text && live.current) {
          if (!live.buffer) live.buffer = { msg: live.current.msg, text: "" };
          live.buffer.text += ev.delta.text;
          if (!live.flushTimer) live.flushTimer = setTimeout(() => this.flush(r.id, live), this.opts.coalesceMs ?? 80);
        }
        return;
      }
      case "assistant": {
        const message = msg.message as { id?: string; model?: string; content?: { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[] } | undefined;
        if (!message) return;
        if (parent) { this.subAssistant(r, live, parent, message); return; }
        this.flush(r.id, live);
        const id = message.id ?? randomUUID();
        if (!live.current || live.current.msg !== id) live.current = { msg: id, text: "", tools: [], model: message.model ?? r.model };
        const cur = live.current;
        for (const b of message.content ?? []) {
          if (b.type === "text" && b.text) cur.text += (cur.text ? "\n\n" : "") + b.text;
          if (b.type === "tool_use" && b.id && b.name) {
            const input = b.input ?? {};
            cur.tools.push({ id: b.id, name: b.name, summary: summarize(b.name, input, r.cwd), input: JSON.stringify(input, null, 2) });
            if (b.name === "Task" || b.name === "Agent") {
              const sub = { description: summarize(b.name, input, r.cwd), model: typeof input.model === "string" ? input.model : null, steps: 0 };
              live.subs.set(b.id, sub);
              this.append(r.id, { kind: "subagent", toolUseId: b.id, sub: `sub-${b.id}`, description: sub.description, model: sub.model, status: "running", steps: 0 });
            }
          }
        }
        if (message.model) cur.model = message.model;
        this.append(r.id, { kind: "assistant", msg: cur.msg, model: cur.model, text: cur.text, tools: cur.tools });
        return;
      }
      case "user": {
        const message = msg.message as { content?: unknown } | undefined;
        const blocks = Array.isArray(message?.content) ? (message!.content as { type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean }[]) : [];
        for (const b of blocks) {
          if (b.type !== "tool_result" || !b.tool_use_id) continue;
          const body: EventBody = { kind: "tool_result", toolUseId: b.tool_use_id, ok: !b.is_error, text: toolResultText(b.content) };
          if (parent) { this.subLog(r.id, `sub-${parent}`)?.append(body); continue; }
          this.append(r.id, body);
          const sub = live.subs.get(b.tool_use_id);
          if (sub) {
            live.subs.delete(b.tool_use_id);
            this.append(r.id, { kind: "subagent", toolUseId: b.tool_use_id, sub: `sub-${b.tool_use_id}`, description: sub.description, model: sub.model, status: b.is_error ? "failed" : "done", steps: sub.steps });
          }
        }
        return;
      }
      case "result": {
        this.flush(r.id, live);
        live.current = null;
        live.retried = false;
        if (live.interrupted) {
          // The person pressed Stop; the "interrupted" notice already says so. A failed-turn line would not be true.
          live.interrupted = false;
          this.setState(r, "idle");
          if (live.restartAfterTurn) this.stop(r.id);
          return;
        }
        const ok = msg.subtype === "success" && msg.is_error !== true;
        const usage = msg.modelUsage as Record<string, { contextWindow?: number }> | undefined;
        const win = usage ? Object.values(usage).map((u) => u.contextWindow ?? 0).find((w) => w > 0) : undefined;
        if (win) r.contextWindow = win;
        const error = ok ? undefined : String(msg.result ?? (Array.isArray(msg.errors) ? msg.errors.join("; ") : msg.subtype ?? "error")).slice(0, 500);
        this.append(r.id, { kind: "result", ok, ...(error ? { error } : {}), ms: typeof msg.duration_ms === "number" ? msg.duration_ms : this.now() - live.turnStart, turns: typeof msg.num_turns === "number" ? msg.num_turns : 0 });
        this.setState(r, ok ? "idle" : "error");
        void this.refreshFigures(r, true);
        if (live.restartAfterTurn) this.stop(r.id);
        return;
      }
      default:
        return;
    }
  }

  private subAssistant(r: SessionRecord, live: Live, parent: string, message: { id?: string; model?: string; content?: { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[] }): void {
    const log = this.subLog(r.id, `sub-${parent}`);
    if (!log) return;
    const text = (message.content ?? []).filter((b) => b.type === "text" && b.text).map((b) => b.text!).join("\n\n");
    const tools = (message.content ?? []).filter((b) => b.type === "tool_use" && b.id && b.name).map((b) => ({ id: b.id!, name: b.name!, summary: summarize(b.name!, b.input ?? {}, r.cwd) }));
    log.append({ kind: "assistant", msg: message.id ?? randomUUID(), model: message.model ?? "", text, tools });
    const sub = live.subs.get(parent);
    if (sub) { sub.steps++; if (message.model) sub.model = message.model; }
  }

  private flush(id: string, live: Live): void {
    if (live.flushTimer) { clearTimeout(live.flushTimer); live.flushTimer = null; }
    const b = live.buffer;
    live.buffer = null;
    if (b && b.text) this.append(id, { kind: "delta", msg: b.msg, text: b.text });
    const r = this.records.get(id);
    if (r && r.state === "running") void this.refreshFigures(r, false);
  }

  private canUseTool(id: string): CanUseTool {
    return async (tool, input, opts) => {
      const r = this.records.get(id)!;
      const live = this.live.get(id);
      if (live) this.flush(id, live);
      const { record, decision } = this.opts.permissions.request({ session: id, tool, title: opts.title ?? "", summary: summarize(tool, input, r.cwd), input }, opts.signal);
      this.append(id, { kind: "permission", id: record.id, tool, title: opts.title ?? "", summary: record.summary, input: permissionDetail(tool, input, r.cwd), canAlways: Array.isArray(opts.suggestions) && opts.suggestions.length > 0 });
      this.setState(r, "waiting");
      const answer: { decision: Decision; reason?: string } = await decision;
      this.append(id, { kind: "permission_decided", id: record.id, decision: answer.decision, ...(answer.reason ? { reason: answer.reason } : {}) });
      if (this.live.has(id) && this.opts.permissions.pending(id).length === 0) this.setState(r, "running");
      else this.opts.onSessions();
      if (answer.decision === "allow") return { behavior: "allow", updatedInput: input };
      if (answer.decision === "allow_always") return { behavior: "allow", updatedInput: input, ...(opts.suggestions ? { updatedPermissions: opts.suggestions } : {}) };
      if (answer.decision === "deny") return { behavior: "deny", message: "The user denied this from their phone." };
      return { behavior: "deny", message: "This permission request expired before anyone answered.", interrupt: true };
    };
  }

  /** The mod's figures as events in the same log, so a phone that reconnects sees what it missed. Throttled to one read per 15 s while a turn runs. */
  private async refreshFigures(r: SessionRecord, force: boolean): Promise<void> {
    if (!r.sdkSessionId) return;
    const last = this.figuresAt.get(r.id) ?? 0;
    if (!force && this.now() - last < 15_000) return;
    this.figuresAt.set(r.id, this.now());
    let figures: Figures;
    try { figures = await this.opts.router.figures(r.sdkSessionId, r.model, r.contextWindow); } catch { return; }
    const { at: _at, ...rest } = figures;
    const key = JSON.stringify(rest);
    if (this.lastFigures.get(r.id) === key) return;
    this.lastFigures.set(r.id, key);
    this.append(r.id, { kind: "figures", figures });
  }
}
