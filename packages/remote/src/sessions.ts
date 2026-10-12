// Sessions are the host's. Each one is a Claude Code process driven through the Agent SDK in
// a folder and on a model the phone chose, sent through the router like any CLI (ARCHITECTURE
// §1: HTTPS_PROXY + NODE_EXTRA_CA_CERTS — not ANTHROPIC_BASE_URL, which the router's proxy port
// answers 405; measured 2026-10-11, docs/specs/2026-10-11-ripple-remote-ux.md). Everything a
// phone may need later goes into the session's event log before it goes to any socket.
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { EventLog } from "./eventlog.ts";
import { messageContent } from "./images.ts";
import type { ImagePart } from "./protocol.ts";
import { DesktopSessions, type DesktopProcess } from "./desktop.ts";
import { DesktopSidebar, PHONE_GROUP, type SidebarOptions } from "./sidebar.ts";
import { BridgeClient, DESKTOP_BLOCKED, object, type BridgeFrame } from "./bridge-client.ts";
import type { HandoffRunner } from "./handoff.ts";
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
  /** Missing on older host records; desktop continuations are explicitly excluded. */
  desktopHandoff?: "pending" | "attempted" | "excluded";
  desktopBridge?: boolean;
  transcriptOffset?: number;
}

interface Live {
  query: SdkQuery;
  input: Inbox;
  abort: AbortController;
  /** Text deltas waiting to be written (coalesced, ~80 ms). */
  buffer: { msg: string; text: string } | null;
  flushTimer: ReturnType<typeof setTimeout> | null;
  /** Content blocks of the API message being streamed, merged across the SDK's per-block messages. */
  current: { msg: string; text: string; images?: ImagePart[]; tools: ToolCall[]; model: string } | null;
  /** Task/Agent tool ids → their subagent while it runs */
  subs: Map<string, { description: string; model: string | null; steps: number }>;
  turnStart: number;
  restartAfterTurn: boolean;
  retried: boolean;
  interrupted: boolean;
  pendingTurns: number;
}

export interface SessionsOptions {
  dir: string;
  router: Pick<RouterClient, "status" | "figures">;
  permissions: PermissionQueue;
  queryFn: QueryFn;
  claudePath?: string;
  handoff?: HandoffRunner;
  log?: (line: string) => void;
  onEvent: (session: string, event: SessionEvent) => void;
  onSessions: () => void;
  now?: () => number;
  coalesceMs?: number;
  /** Enabled by main; tests can use an isolated synthetic projects directory. */
  desktopProjects?: string;
  desktopSidebar?: SidebarOptions;
  desktopProcesses?: () => string;
  desktopRegistry?: () => Map<string, DesktopProcess>;
  bridgeClient?: BridgeClient;
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A stable v4-shaped UUID for a phone message id. */
function uuidFrom(text: string): string {
  const h = createHash("sha256").update(text).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16]!, 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export class Sessions {
  private opts: SessionsOptions;
  private records = new Map<string, SessionRecord>();
  private logs = new Map<string, EventLog>();
  private live = new Map<string, Live>();
  private figuresAt = new Map<string, number>();
  private lastFigures = new Map<string, string>();
  private creating = new Map<string, Promise<string>>();
  private handingOff = new Map<string, { messages: SdkUserMessage[] }>();
  private shuttingDown = false;
  private file: string;
  private now: () => number;
  private desktop: DesktopSessions | null;
  private sidebar: DesktopSidebar | null;
  private sidebarFingerprint = "";
  private desktopModels = new Map<string, { model: string; effort: Effort | null }>();
  private bridge: BridgeClient;
  private bridgeStates = new Map<string, { at: number; state?: SessionState; pending?: Promise<void> }>();

  /** The registry says busy (it counts background work) while the main turn itself is not running. */
  private background(process: DesktopProcess): boolean {
    const state = this.bridgeState(process);
    return (process.status === "busy" || process.status === "shell") && state !== "running" && state !== "waiting";
  }

  private bridgeState(process: DesktopProcess): SessionState {
    const cached = process.bridgeSessionId ? this.bridgeStates.get(process.bridgeSessionId)?.state : undefined;
    return cached ?? (process.status === "waiting" ? "waiting" : process.status === "idle" ? "idle" : "running");
  }

  private pollBridgeState(id: string): Promise<void> {
    const cached = this.bridgeStates.get(id);
    if (cached?.pending) return cached.pending;
    if (cached && this.now() - cached.at < 3000) return Promise.resolve();
    const entry: { at: number; state?: SessionState; pending?: Promise<void> } = { at: this.now(), ...(cached?.state ? { state: cached.state } : {}) };
    this.bridgeStates.set(id, entry);
    entry.pending = this.bridge.session(id).then(session => {
      entry.state = session.worker_status === "requires_action" ? "waiting" : session.worker_status;
    }).catch(error => {
      delete entry.state; // The registry is the fallback only on a failed read.
      (this.opts.log ?? console.error)(`[desktop state] ${error instanceof Error ? error.message : String(error)}`);
    }).finally(() => { delete entry.pending; this.opts.onSessions(); });
    return entry.pending;
  }
  private bridges = new Map<string, { bridgeId: string; abort: AbortController; failed: boolean; permissions: Map<string, { id: string; input: Record<string, unknown>; toolUseId: string }> }>();
  private bridgeSends = new Map<string, Promise<string>>();
  /** uuids of prompts sent over Remote Control, so their transcript echo is not shown twice. */
  private bridgeEchoes = new Set<string>();
  private bridgeDecisions = new Map<string, Promise<boolean>>();

  constructor(opts: SessionsOptions) {
    this.opts = opts;
    this.bridge = opts.bridgeClient ?? new BridgeClient();
    this.now = opts.now ?? Date.now;
    this.file = path.join(opts.dir, "sessions.json");
    for (const r of readJson<SessionRecord[]>(this.file) ?? []) this.records.set(r.id, r);
    this.sidebar = opts.desktopSidebar ? new DesktopSidebar({ ...opts.desktopSidebar, now: this.now,
      onError: error => (opts.log ?? console.error)(`[desktop sidebar] ${error instanceof Error ? error.message : String(error)}`),
    }) : null;
    this.desktop = opts.desktopProjects === undefined ? null : new DesktopSessions({
      ...(this.sidebar ? { sidebarIds: () => new Set(this.sidebar!.read().sessions.keys()) } : {}),
      projects: opts.desktopProjects, now: this.now, summarize, ...(opts.desktopProcesses ? { processes: opts.desktopProcesses } : {}),
      ...(opts.desktopRegistry ? { registry: opts.desktopRegistry } : {}),
      // Only transcripts the host is writing right now, or a phone session not yet handed to the
      // desktop app, are hidden; any other one may be open in the app and must stay reachable
      // (a record the host once resumed is rebased onto Remote Control from here).
      excluded: () => new Set(Array.from(this.records.values()).filter(r => !r.desktopBridge && (this.live.has(r.id) || r.desktopHandoff === "pending")).flatMap(r => r.sdkSessionId ? [r.id, r.sdkSessionId] : [r.id])),
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
    const hostCliIds = new Set([...this.records.values()].flatMap(r => r.sdkSessionId ? [r.sdkSessionId] : []));
    const sessions = [...host, ...(this.desktop?.list() ?? []).filter(s => !this.records.has(s.id) && !hostCliIds.has(s.id)).map(s => {
      const process = this.desktop?.liveProcess(s.id);
      return { ...s, ...this.desktopModels.get(s.id), ...(process?.bridgeSessionId ? { state: this.bridgeState(process), desktopBridge: true, background: this.background(process) } : {}) };
    })];
    return this.sidebar?.join(sessions, id => this.records.get(id)?.sdkSessionId ?? id) ?? sessions;
  }

  groups(): string[] | undefined {
    return this.sidebar ? [...this.sidebar.read().groups.map(g => g.name), PHONE_GROUP] : undefined;
  }

  async pollDesktop(): Promise<void> {
    if (this.desktop?.poll()) this.opts.onSessions();
    if (this.sidebar) {
      const fingerprint = JSON.stringify([this.groups(), this.list()]);
      if (fingerprint !== this.sidebarFingerprint) { this.sidebarFingerprint = fingerprint; this.opts.onSessions(); }
    }
    const ids = new Set(this.list().flatMap(s => {
      const process = this.desktop?.liveProcess(this.records.get(s.id)?.sdkSessionId ?? s.id);
      return process?.bridgeSessionId ? [process.bridgeSessionId] : [];
    }));
    const reads = [...ids].map(id => this.pollBridgeState(id));
    for (const id of this.bridgeStates.keys()) if (!ids.has(id)) this.bridgeStates.delete(id);
    for (const r of this.records.values()) {
      if (!this.desktop) continue;
      // A record the host once resumed, now open in the desktop app with Remote Control.
      if (!r.desktopBridge && !this.live.has(r.id) && r.sdkSessionId && this.desktop.has(r.sdkSessionId) && this.desktop.liveProcess(r.sdkSessionId)?.bridgeSessionId) {
        try { this.rebaseDesktop(r); } catch (error) { this.bridgeFailure(r.id, error); continue; }
      }
      if (!r.desktopBridge) continue;
      try {
        r.transcriptOffset = this.desktop.tail(r.sdkSessionId ?? r.id, r.transcriptOffset ?? 0, body => {
          if (body.kind !== "user" || !(this.seen(r.id, body.clientMsgId) || this.bridgeEchoes.has(body.clientMsgId))) this.append(r.id, body);
        }, data => this.log(r.id).image(data));
        this.save();
        const process = this.desktop.liveProcess(r.sdkSessionId ?? r.id);
        this.setState(r, process ? this.bridgeState(process) : "stopped");
        if (process?.bridgeSessionId) this.ensureBridge(r.id, process.bridgeSessionId);
        else this.closeBridge(r.id);
      } catch (error) { this.bridgeFailure(r.id, error); }
    }
    await Promise.all(reads);
    for (const r of this.records.values()) {
      if (!r.desktopBridge) continue;
      const process = this.desktop?.liveProcess(r.sdkSessionId ?? r.id);
      this.setState(r, process ? this.bridgeState(process) : "stopped");
    }
  }

  has(id: string): boolean { return this.records.has(id) || (this.desktop?.has(id) ?? false); }

  private continueDesktop(id: string, clientMsgId: string, bridgeMode = false): SessionRecord {
    if (!this.desktop) throw new Error("no such session");
    const { summary: s, open } = this.desktop.continuation(id);
    if (open && !bridgeMode) throw new Error(DESKTOP_BLOCKED);
    const log = this.desktop.importInto(id, path.join(this.opts.dir, "sessions", id), this.now);
    const r: SessionRecord = { id, sdkSessionId: id, cwd: s.cwd, model: s.model, effort: s.effort, title: s.title, createdAt: s.createdAt, updatedAt: this.now(), state: "stopped", createdBy: clientMsgId, contextWindow: null, desktopHandoff: "excluded" };
    if (bridgeMode) { r.desktopBridge = true; r.transcriptOffset = this.desktop.transcriptSize(id); }
    Object.assign(r, this.desktopModels.get(id));
    this.desktopModels.delete(id);
    this.logs.set(id, log);
    this.records.set(id, r);
    this.save();
    this.append(id, { kind: "notice", code: bridgeMode ? "desktop_bridge" : "desktop_resumed" });
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
    const process = r.desktopBridge ? this.desktop?.liveProcess(r.sdkSessionId ?? r.id) : undefined;
    const state = process ? this.bridgeState(process) : r.desktopBridge ? "stopped" : r.state;
    return { ...(r.desktopBridge ? { desktopBridge: true, tasks: this.desktop?.backgroundTasks(r.sdkSessionId ?? r.id) ?? 0, ...(process ? { background: this.background(process) } : {}) } : {}), origin: "host", readOnly: false, id: r.id, title: r.title, cwd: r.cwd, model: r.model, effort: r.effort, state, pending: this.opts.permissions.pending(r.id).length, createdAt: r.createdAt, updatedAt: r.updatedAt, lastSeq: log.lastSeq, epoch: log.epoch };
  }

  log(id: string): EventLog {
    if (!this.records.has(id)) {
      const process = this.desktop?.liveProcess(id);
      if (process?.bridgeSessionId && this.desktop?.has(id)) {
        this.continueDesktop(id, "", true);
        this.ensureBridge(id, process.bridgeSessionId);
        return this.logs.get(id)!;
      }
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
    const r: SessionRecord = { id: randomUUID(), sdkSessionId: null, cwd, model: req.model, effort: req.effort, title: oneLine(req.text, 80), createdAt: now, updatedAt: now, state: "starting", createdBy: req.clientMsgId, contextWindow: null, desktopHandoff: "pending" };
    this.records.set(r.id, r);
    this.save();
    this.append(r.id, { kind: "state", state: "starting" });
    this.send(r.id, req.clientMsgId, req.text);
    this.opts.onSessions();
    return r.id;
  }

  /** Idempotent on clientMsgId. Starts (or resumes) the query when none is live. */
  send(id: string, clientMsgId: string, text: string): string | Promise<string> {
    const existing = this.records.get(id);
    const desktopId = existing?.sdkSessionId ?? id;
    if (this.desktop && !this.live.has(id) && (existing?.sdkSessionId || this.desktop.has(id))) {
      const process = this.desktop.liveProcess(desktopId);
      if (process?.bridgeSessionId) {
        const key = `${id}/${clientMsgId}`;
        const pending = this.bridgeSends.get(key);
        if (pending) return pending;
        const sending = this.sendBridge(id, clientMsgId, text, process.bridgeSessionId).finally(() => this.bridgeSends.delete(key));
        this.bridgeSends.set(key, sending);
        return sending;
      }
      if (process || this.desktop.isOpen(desktopId)) throw new Error(DESKTOP_BLOCKED);
      if (existing?.desktopBridge) { this.closeBridge(id); existing.desktopBridge = false; this.save(); }
    }
    const r = this.records.get(id) ?? this.continueDesktop(id, clientMsgId);
    id = r.id;
    if (this.seen(id, clientMsgId)) return id;
    this.append(id, { kind: "user", text, clientMsgId });
    let live = this.live.get(id);
    const handoff = this.handingOff.get(id);
    if (!live && !handoff) live = this.start(r);
    // A message sent while a turn runs is queued by the CLI and starts no turn of its own yet.
    if (r.state !== "running" && r.state !== "waiting") {
      if (live) live.turnStart = this.now();
      this.append(id, { kind: "turn", model: r.model, effort: r.effort });
      this.setState(r, "running");
    }
    const message: SdkUserMessage = { type: "user", message: { role: "user", content: text }, parent_tool_use_id: null, session_id: r.sdkSessionId ?? "", origin: { kind: "human" } };
    if (handoff) handoff.messages.push(message);
    else if (live) { live.pendingTurns++; live.input.push(message); }
    return id;
  }

  private async sendBridge(id: string, clientMsgId: string, text: string, bridgeId: string): Promise<string> {
    const r = this.records.get(id) ?? this.continueDesktop(id, clientMsgId, true);
    if (!r.desktopBridge) this.rebaseDesktop(r);
    if (this.seen(id, clientMsgId)) return id;
    // The stream only carries permission prompts; sending does not depend on it.
    this.ensureBridge(id, bridgeId);
    // The API takes only a UUID; phones send short random ids. Derived, not random, so a retry of
    // the same message is the same event; the transcript echoes it under this uuid.
    const uuid = UUID_RE.test(clientMsgId) ? clientMsgId : uuidFrom(clientMsgId);
    this.bridgeEchoes.add(uuid);
    try { await this.bridge.send(bridgeId, uuid, text); }
    catch (error) { throw new Error(error instanceof Error ? error.message : DESKTOP_BLOCKED); }
    // The durable user event also deduplicates the desktop transcript's echo by uuid.
    this.append(id, { kind: "user", text, clientMsgId });
    // A turn the desktop app finished while no phone was polling left the record "running";
    // without a fresh state event the phone would time this turn from that old one.
    if (r.state === "running" || r.state === "waiting") this.setState(r, "idle");
    // Phones time a turn from its turn event; a desktop transcript's last turn has no result
    // event to end it, so without this one the clock would run from that earlier turn.
    this.append(id, { kind: "turn", model: r.model, effort: r.effort });
    this.setState(r, "running");
    return id;
  }

  /**
   * A record the host once drove (resume) becomes a Remote Control one: its log stops where the
   * host stopped, so it is rebuilt from the transcript instead of tailing from "now" and
   * skipping everything the desktop app said in between. The new epoch makes phones refetch.
   */
  private rebaseDesktop(r: SessionRecord): void {
    if (!this.desktop) return;
    const dir = path.join(this.opts.dir, "sessions", r.id);
    this.logs.get(r.id)?.close();
    this.logs.delete(r.id);
    fs.rmSync(dir, { recursive: true, force: true });
    this.logs.set(r.id, this.desktop.importInto(r.sdkSessionId ?? r.id, dir, this.now));
    r.desktopBridge = true;
    r.transcriptOffset = this.desktop.transcriptSize(r.sdkSessionId ?? r.id);
    this.save();
    this.opts.onSessions();
  }

  private ensureBridge(id: string, bridgeId: string) {
    const previous = this.bridges.get(id);
    // A failed stream is retried on the next poll or send rather than blocking the session for good.
    if (previous?.bridgeId === bridgeId && !previous.failed) return previous;
    this.closeBridge(id);
    const connection = { bridgeId, abort: new AbortController(), failed: false, permissions: new Map<string, { id: string; input: Record<string, unknown>; toolUseId: string }>() };
    this.bridges.set(id, connection);
    void this.bridge.stream(bridgeId, connection.abort.signal, frame => this.bridgeFrame(id, frame)).catch(error => {
      if (!connection.abort.signal.aborted) this.bridgeFailure(id, error);
    });
    return connection;
  }

  private closeBridge(id: string): void {
    const connection = this.bridges.get(id);
    if (!connection) return;
    connection.abort.abort();
    this.opts.permissions.expireSession(id, "aborted");
    this.bridges.delete(id);
  }

  private bridgeFailure(id: string, error: unknown): void {
    const connection = this.bridges.get(id);
    if (connection) { connection.failed = true; connection.abort.abort(); }
    this.opts.permissions.expireSession(id, "aborted");
    // Logged, not shown: a dropped permission stream reconnects on the next poll and says nothing new to the user.
    console.error(`remote control stream (${id}): ${error instanceof Error ? error.message : "failed"}`);
  }

  private bridgeFrame(id: string, frame: BridgeFrame): void {
    if (frame.event !== "client_event") return;
    const payload = object(frame.data.payload);
    const connection = this.bridges.get(id);
    if (!payload || !connection) return;
    // Responses from another client close a pending card during replay or live delivery.
    if (payload.type === "control_response") {
      const response = object(payload.response);
      if (typeof response?.request_id !== "string") return;
      const pending = connection.permissions.get(response.request_id);
      if (pending) this.opts.permissions.expire(pending.id, "cancelled");
      connection.permissions.delete(response.request_id);
      return;
    }
    // Only the server's worker channel may ask for authorization or withdraw a request.
    if (frame.data.source !== "worker" || typeof payload.request_id !== "string") return;
    const requestId = payload.request_id;
    if (payload.type === "control_cancel_request") {
      const pending = connection.permissions.get(requestId);
      if (pending) this.opts.permissions.expire(pending.id, "cancelled");
      connection.permissions.delete(requestId);
      return;
    }
    const request = object(payload.request);
    const input = object(request?.input);
    if (payload.type !== "control_request" || request?.subtype !== "can_use_tool" || typeof request.tool_name !== "string" || !input || typeof request.tool_use_id !== "string" || connection.permissions.has(requestId)) return;
    const r = this.records.get(id);
    if (!r) return;
    const { record, decision } = this.opts.permissions.request({ session: id, tool: request.tool_name, title: "", summary: summarize(request.tool_name, input, r.cwd), input }, connection.abort.signal);
    connection.permissions.set(requestId, { id: record.id, input, toolUseId: request.tool_use_id });
    this.append(id, { kind: "permission", id: record.id, tool: record.tool, title: "", summary: record.summary, input: permissionDetail(record.tool, input, r.cwd), canAlways: false });
    this.setState(r, "waiting");
    void decision.then(answer => {
      this.append(id, { kind: "permission_decided", id: record.id, decision: answer.decision, ...(answer.reason ? { reason: answer.reason } : {}) });
      if (answer.decision === "expired") connection.permissions.delete(requestId);
      this.opts.onSessions();
    });
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

  decide(id: string, permId: string, decision: "allow" | "allow_always" | "deny"): boolean | Promise<boolean> {
    const connection = this.bridges.get(id);
    const pending = connection && [...connection.permissions].find(([, value]) => value.id === permId);
    if (connection && pending) {
      const sending = this.bridgeDecisions.get(permId);
      if (sending) return sending;
      const answer = this.decideBridge(id, permId, decision, pending[0], pending[1]).finally(() => this.bridgeDecisions.delete(permId));
      this.bridgeDecisions.set(permId, answer);
      return answer;
    }
    const p = this.opts.permissions.get(permId);
    if (!p || p.session !== id) return false;
    return this.opts.permissions.decide(permId, decision) !== null;
  }

  private async decideBridge(id: string, permId: string, decision: "allow" | "allow_always" | "deny", requestId: string, pending: { input: Record<string, unknown>; toolUseId: string }): Promise<boolean> {
    const connection = this.bridges.get(id);
    if (!connection || connection.failed || this.opts.permissions.get(permId)?.state !== "pending") return false;
    if (decision === "allow_always") throw new Error("Remote Control supports allow once only.");
    try {
      await this.bridge.post(connection.bridgeId, { type: "control_response", uuid: randomUUID(), response: { subtype: "success", request_id: requestId, response: { behavior: decision, updatedInput: pending.input, toolUseID: pending.toolUseId, ...(decision === "deny" ? { message: "The user denied this from their phone." } : {}) } } });
    } catch (error) { this.bridgeFailure(id, error); throw error; }
    connection.permissions.delete(requestId);
    return this.opts.permissions.decide(permId, decision) !== null;
  }

  async interrupt(id: string): Promise<void> {
    const connection = this.bridges.get(id);
    if (connection) {
      if (connection.failed) throw new Error(DESKTOP_BLOCKED);
      try { await this.bridge.interrupt(connection.bridgeId); }
      catch (error) { this.bridgeFailure(id, error); throw error; }
      this.append(id, { kind: "notice", code: "interrupted" });
      return;
    }
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
    if (this.desktop?.isOpen(this.records.get(id)?.sdkSessionId ?? id)) throw new Error("열려 있는 세션의 모델은 Claude 앱에서 변경해 주십시오. / Change this live session's model in the Claude app.");
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
    this.shuttingDown = true;
    for (const id of Array.from(this.live.keys())) this.stop(id);
    for (const id of this.bridges.keys()) this.closeBridge(id);
    for (const log of this.logs.values()) log.close();
    this.desktop?.close();
  }

  // ---- the query ----------------------------------------------------------------------------

  private start(r: SessionRecord): Live {
    if (r.sdkSessionId && this.desktop?.isOpen(r.sdkSessionId)) throw new Error(DESKTOP_BLOCKED);
    const abort = new AbortController();
    const input = new Inbox();
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    delete env.ANTHROPIC_BASE_URL;
    delete env.CLAUDECODE;
    const m = modelArg(r.model, r.effort);
    const options: Record<string, unknown> = {
      cwd: r.cwd,
      ...(!r.sdkSessionId ? { title: r.title } : {}),
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
    const live: Live = { query: null as unknown as SdkQuery, input, abort, buffer: null, flushTimer: null, current: null, subs: new Map(), turnStart: this.now(), restartAfterTurn: false, retried: false, interrupted: false, pendingTurns: 0 };
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
        const converted = messageContent(message.content, data => this.log(r.id).image(data));
        if (converted.text) cur.text += (cur.text ? "\n\n" : "") + converted.text;
        cur.images = [...(cur.images ?? []), ...converted.images];
        for (const b of message.content ?? []) {
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
        this.append(r.id, { kind: "assistant", msg: cur.msg, model: cur.model, text: cur.text, images: cur.images, tools: cur.tools });
        return;
      }
      case "user": {
        const message = msg.message as { content?: unknown } | undefined;
        const blocks = Array.isArray(message?.content) ? (message!.content as { type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean }[]) : [];
        const converted = messageContent(message?.content, data => this.log(r.id).image(data));
        // SDK user echoes normally already have a phone event; retain image-bearing echoes only.
        if (converted.images.length) {
          const body: EventBody = { kind: "user", ...converted, clientMsgId: typeof msg.uuid === "string" ? msg.uuid : randomUUID() };
          if (parent) this.subLog(r.id, `sub-${parent}`)?.append(body);
          else this.append(r.id, body);
        }
        for (const b of blocks) {
          if (b.type !== "tool_result" || !b.tool_use_id) continue;
          const body: EventBody = { kind: "tool_result", toolUseId: b.tool_use_id, ok: !b.is_error, ...messageContent(b.content, data => this.log(r.id).image(data)) };
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
        live.pendingTurns = Math.max(0, live.pendingTurns - 1);
        this.flush(r.id, live);
        live.current = null;
        live.retried = false;
        if (live.interrupted) {
          // The person pressed Stop; the "interrupted" notice already says so. A failed-turn line would not be true.
          live.interrupted = false;
          this.setState(r, live.pendingTurns > 0 ? "running" : "idle");
          if (live.pendingTurns === 0) this.handoff(r);
          if (live.restartAfterTurn) this.stop(r.id);
          return;
        }
        const ok = msg.subtype === "success" && msg.is_error !== true;
        const usage = msg.modelUsage as Record<string, { contextWindow?: number }> | undefined;
        const win = usage ? Object.values(usage).map((u) => u.contextWindow ?? 0).find((w) => w > 0) : undefined;
        if (win) r.contextWindow = win;
        const error = ok ? undefined : String(msg.result ?? (Array.isArray(msg.errors) ? msg.errors.join("; ") : msg.subtype ?? "error")).slice(0, 500);
        this.append(r.id, { kind: "result", ok, ...(error ? { error } : {}), ms: typeof msg.duration_ms === "number" ? msg.duration_ms : this.now() - live.turnStart, turns: typeof msg.num_turns === "number" ? msg.num_turns : 0 });
        this.setState(r, live.pendingTurns > 0 ? "running" : ok ? "idle" : "error");
        if (live.pendingTurns === 0) this.handoff(r);
        void this.refreshFigures(r, true);
        if (live.restartAfterTurn) this.stop(r.id);
        return;
      }
      default:
        return;
    }
  }

  private handoff(r: SessionRecord): void {
    const runner = this.opts.handoff;
    if (!runner || !r.sdkSessionId || r.desktopHandoff !== "pending") return;
    r.desktopHandoff = "attempted";
    this.save();
    const transfer = { messages: [] as SdkUserMessage[] };
    this.handingOff.set(r.id, transfer);
    // Defer past result handling so the SDK can finish its result continuation first.
    void new Promise<void>(resolve => setImmediate(resolve)).then(async () => {
      if (this.shuttingDown) { this.handingOff.delete(r.id); return; }
      try {
        const result = await runner({ sessionId: r.sdkSessionId!, title: r.title, cwd: r.cwd });
        (this.opts.log ?? console.error)(`[desktop handoff ${r.id}] ${result}`);
      } catch (error) {
        (this.opts.log ?? console.error)(`[desktop handoff ${r.id}] failed: ${(error as Error).message}`);
      } finally {
        this.handingOff.delete(r.id);
        if (transfer.messages.length && !this.shuttingDown) {
          const writer = this.live.get(r.id) ?? this.start(r);
          writer.pendingTurns += transfer.messages.length;
          for (const message of transfer.messages) writer.input.push(message);
        }
      }
    });
  }

  private subAssistant(r: SessionRecord, live: Live, parent: string, message: { id?: string; model?: string; content?: { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[] }): void {
    const log = this.subLog(r.id, `sub-${parent}`);
    if (!log) return;
    const converted = messageContent(message.content, data => this.log(r.id).image(data));
    const tools = (message.content ?? []).filter((b) => b.type === "tool_use" && b.id && b.name).map((b) => ({ id: b.id!, name: b.name!, summary: summarize(b.name!, b.input ?? {}, r.cwd) }));
    log.append({ kind: "assistant", msg: message.id ?? randomUUID(), model: message.model ?? "", ...converted, tools });
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
