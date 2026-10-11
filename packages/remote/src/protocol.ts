// Wire protocol between ripple-host and the phone client. Types and constants only, no
// imports: the host also serves this file to the browser (as /src/protocol.ts), so both ends
// read the same numbers.
//
// Every session has an append-only event log. An event's `seq` counts from 1 inside one
// `epoch`; a new epoch means the log was replaced (never happens in normal operation) and a
// client must drop what it holds for that session. A client that reconnects asks for
// everything after the last `seq` it has, so a re-attach is cheap and idempotent.

/** Largest WebSocket frame either side sends, in bytes of UTF-8 JSON (Paseo #2610: 8 MB killed the socket). */
export const FRAME_CAP = 256 * 1024;
/** A string field longer than this is moved out of the event into a blob fetched on demand. */
export const INLINE_CAP = 32 * 1024;
/** Client pings this often; either side calls the link stale after STALE_MS of silence. */
export const PING_MS = 10_000;
export const STALE_MS = 30_000;
/** Reconnect backoff is min(BACKOFF_CAP_MS, attempt × 1 s) and never stops. */
export const BACKOFF_CAP_MS = 30_000;

export type Effort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";

export type SessionState =
  | "starting" // query spawned, no answer yet
  | "running" // model or tool working
  | "waiting" // a permission request is open
  | "idle" // turn finished, ready for the next message
  | "stopped" // no live query (host restarted, or closed); the next message resumes it
  | "error"; // last turn ended in an error; the next message retries

/** A string moved out of an event (INLINE_CAP); the client fetches `/api/blob/<session>/<id>`. */
export interface BlobRef { blob: string; bytes: number; preview: string }
export type Text = string | BlobRef;

export interface ToolCall { id: string; name: string; /** one line a person reads: a command, a path */ summary: string; input?: Text }

export type EventBody =
  | { kind: "user"; text: string; clientMsgId: string }
  | { kind: "turn"; model: string; effort: Effort | null }
  /** Streamed text, coalesced by the host (~80 ms). Superseded by the `assistant` event with the same `msg`. */
  | { kind: "delta"; msg: string; text: string }
  | { kind: "assistant"; msg: string; model: string; text: Text; tools: ToolCall[] }
  | { kind: "tool_result"; toolUseId: string; ok: boolean; text: Text }
  /** A subagent ran; its own log is `sub` and loads only when asked (Paseo #5820). */
  | { kind: "subagent"; toolUseId: string; sub: string; description: string; model: string | null; status: "running" | "done" | "failed"; steps: number }
  | { kind: "permission"; id: string; tool: string; title: string; summary: string; input: Text; canAlways: boolean }
  | { kind: "permission_decided"; id: string; decision: "allow" | "allow_always" | "deny" | "expired"; reason?: string }
  | { kind: "result"; ok: boolean; error?: string; ms: number; turns: number }
  | { kind: "state"; state: SessionState; detail?: string }
  | { kind: "figures"; figures: Figures }
  | { kind: "notice"; code: NoticeCode; text?: string };

export type NoticeCode = "host_restarted" | "interrupted" | "api_retry" | "router_down" | "model_changed" | "resumed";

export type SessionEvent = EventBody & { seq: number; at: number };

/** The mod's figures, as the phone shows them under the header. Null means "not known", never zero. */
export interface Figures {
  effort: Effort | null;
  /** cache read / all input of this session's main-model requests, 0–100 */
  cachePct: number | null;
  /** last request's input / the model's window, 0–100 */
  contextPct: number | null;
  /** Claude subscription 5-hour window used, 0–100 */
  fiveHourPct: number | null;
  fiveHourResetAt: number | null;
  /** model → requests, for every model other than the session's own that served this session */
  workers: { model: string; provider: string; requests: number }[];
  at: number;
}

export interface SessionSummary {
  id: string;
  title: string;
  cwd: string;
  model: string;
  effort: Effort | null;
  state: SessionState;
  /** open permission requests */
  pending: number;
  createdAt: number;
  updatedAt: number;
  lastSeq: number;
  epoch: string;
}

export interface ModelOption { model: string; name: string; provider: string; efforts: Effort[]; usable: boolean }
export interface ProviderGroup { provider: string; label: string; usable: boolean; models: ModelOption[] }

export interface FolderEntry { path: string; name: string; lastUsed?: number; model?: string }

export interface HostInfo { name: string; version: string; routerOk: boolean; routerProblem?: string }

// ---- client → host --------------------------------------------------------------------

export type ClientMsg =
  | { t: "hello"; token: string; clientId: string }
  | { t: "ping"; n: number }
  /** `afterSeq` 0 or absent with no epoch: send the tail page. */
  | { t: "attach"; session: string; epoch?: string; afterSeq?: number }
  | { t: "detach"; session: string }
  | { t: "history"; session: string; beforeSeq: number; reqId: string }
  | { t: "create"; clientMsgId: string; cwd: string; model: string; effort: Effort | null; text: string }
  | { t: "send"; session: string; clientMsgId: string; text: string }
  | { t: "decide"; session: string; id: string; decision: "allow" | "allow_always" | "deny" }
  | { t: "interrupt"; session: string }
  | { t: "set_model"; session: string; model: string; effort: Effort | null }
  /** Request/response over the same socket, so a relay later forwards one stream and nothing else. */
  | { t: "req"; reqId: string; op: ReqOp };

export type ReqOp =
  | { op: "models" }
  | { op: "folders" }
  | { op: "browse"; path?: string; hidden?: boolean }
  | { op: "blob"; session: string; id: string; offset?: number }
  | { op: "sub"; session: string; sub: string; afterSeq?: number };

export interface BrowseResult { path: string; parent: string | null; home: string; entries: FolderEntry[]; truncated: boolean }
export interface BlobChunk { text: string; offset: number; next: number | null; bytes: number }
export interface SubPage { events: SessionEvent[]; more: boolean }

// ---- host → client --------------------------------------------------------------------

export type HostMsg =
  | { t: "ready"; host: HostInfo; sessions: SessionSummary[] }
  | { t: "pong"; n: number }
  | { t: "denied"; reason: "token" }
  /** Events after the client's seq. `more` means another frame follows at once. `tail` means older events exist before `events[0]`. */
  | { t: "events"; session: string; epoch: string; events: SessionEvent[]; more: boolean; tail?: { hasOlder: boolean } }
  | { t: "history"; session: string; reqId: string; events: SessionEvent[]; hasOlder: boolean }
  | { t: "sessions"; sessions: SessionSummary[] }
  | { t: "host"; host: HostInfo }
  | { t: "ack"; clientMsgId: string; session: string }
  | { t: "res"; reqId: string; ok: true; data: unknown }
  | { t: "res"; reqId: string; ok: false; error: string }
  | { t: "error"; code: string; message: string; clientMsgId?: string; session?: string };
