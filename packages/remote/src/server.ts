// One HTTP server: the PWA's files, and one WebSocket that carries everything else. Keeping all
// traffic on the socket is the relay seam: a relay later forwards this one stream (encrypted)
// and nothing about the app changes.
import fs from "node:fs";
import http from "node:http";
import module from "node:module";
import path from "node:path";
import { WebSocketServer } from "ws";
import { tokenMatches } from "./config.ts";
import { browse, recentFolders } from "./folders.ts";
import type { RecentSource } from "./folders.ts";
import { FRAME_CAP, PING_MS, STALE_MS } from "./protocol.ts";
import type { BlobChunk, ClientMsg, HostInfo, HostMsg, ProviderGroup, ReqOp } from "./protocol.ts";
import { VISIBLE_MS } from "./push.ts";
import type { Notifier } from "./push.ts";
import type { RouterClient } from "./router.ts";
import type { Sessions } from "./sessions.ts";

/** Stop writing to a client whose socket has this much queued; its pump resumes when it drains. */
const HIGH_WATER = 1024 * 1024;
/** A reconnecting client further behind than this many frames gets the tail instead of a replay. */
const CATCHUP_FRAMES = 4;
const BLOB_CHUNK_CHARS = 60_000;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".ts": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json",
};

export const CSP = "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'";
const require = module.createRequire(import.meta.url);
/** Published path → file, for what the PWA loads from outside web/. The relay's build serves the same paths. */
export const SHARED: Record<string, (pkgDir: string) => string> = {
  "src/protocol.ts": (pkg) => path.join(pkg, "src", "protocol.ts"),
  "src/e2ee.ts": (pkg) => path.join(pkg, "src", "e2ee.ts"),
  "vendor/nacl-fast.min.js": () => require.resolve("tweetnacl/nacl-fast.min.js"),
};

export interface ServerOptions {
  listen: string;
  port: number;
  token: string;
  webDir: string;
  sessions: Sessions;
  router: Pick<RouterClient, "models" | "status">;
  hostName: string;
  version: string;
  recentCli: () => Promise<RecentSource[]>;
  log?: (line: string) => void;
  push?: Pick<Notifier, "subscribe" | "unsubscribe"> & { publicKey: string };
  expoPush?: { subscribe(clientId: string, token: string, lang: "ko" | "en"): void; unsubscribe(clientId: string): void };
  now?: () => number;
}

/**
 * A phone connection: a `ws` socket on the direct path, or a decrypted channel through the relay
 * (relay.ts). Both carry the same JSON frames, so everything below is the same for either.
 */
export interface Peer {
  readonly readyState: number;
  readonly OPEN: number;
  readonly bufferedAmount: number;
  send(text: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  on(event: "message" | "close" | "error", fn: (data?: unknown) => void): unknown;
}

interface Client {
  ws: Peer;
  authed: boolean;
  /** the phone's own id from hello: one push subscription per device */
  clientId: string;
  /** last time this client said the app is visible; 0 once it said hidden */
  visibleAt: number;
  lastRx: number;
  /** session → last seq sent to this client */
  attached: Map<string, number>;
  pumping: Set<string>;
}

export class HostServer {
  private opts: ServerOptions;
  private http: http.Server;
  private wss: WebSocketServer;
  private clients = new Set<Client>();
  private stripped = new Map<string, { mtime: number; body: string }>();
  private models: { at: number; data: ProviderGroup[] } | null = null;
  private hostInfo: HostInfo;
  private timers: ReturnType<typeof setInterval>[] = [];
  private sessionsTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: ServerOptions) {
    this.opts = opts;
    this.hostInfo = { name: opts.hostName, version: opts.version, routerOk: true };
    this.http = http.createServer((req, res) => this.serve(req, res));
    this.wss = new WebSocketServer({ noServer: true, maxPayload: FRAME_CAP });
    this.http.on("upgrade", (req, socket, head) => {
      if (new URL(req.url ?? "/", "http://x").pathname !== "/ws" || !this.sameOrigin(req)) { socket.destroy(); return; }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.connected(ws));
    });
  }

  /** A page on another origin in this machine's browser must not drive the socket, token or not. */
  private sameOrigin(req: http.IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (!origin) return true;
    try { return new URL(origin).host === req.headers.host; } catch { return false; }
  }

  /** True while a connected phone reported the app visible within VISIBLE_MS: then nobody needs a push. */
  someoneLooking(): boolean {
    const now = this.now();
    for (const c of this.clients) if (c.authed && c.visibleAt > 0 && now - c.visibleAt < VISIBLE_MS && c.ws.readyState === c.ws.OPEN) return true;
    return false;
  }

  private now(): number { return (this.opts.now ?? Date.now)(); }

  private pollDesktop(): void {
    if (!this.someoneLooking()) return;
    void this.opts.sessions.pollDesktop().catch(error => {
      this.opts.log?.(`desktop poll failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.http.once("error", reject);
      this.http.listen(this.opts.port, this.opts.listen, () => {
        this.http.off("error", reject);
        this.timers.push(setInterval(() => this.reapStale(), PING_MS));
        this.timers.push(setInterval(() => void this.checkRouter(), 15_000));
        this.timers.push(setInterval(() => this.pollDesktop(), 3000));
        void this.checkRouter();
        resolve();
      });
    });
  }

  close(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    if (this.sessionsTimer) clearTimeout(this.sessionsTimer);
    this.sessionsTimer = null;
    for (const c of this.clients) c.ws.terminate();
    return new Promise((resolve) => this.http.close(() => resolve()));
  }

  address(): { port: number } { return this.http.address() as { port: number }; }

  // ---- session events in, frames out ---------------------------------------------------------

  /** Called for every appended event: push it to every client attached to that session. */
  onEvent(session: string): void {
    for (const c of this.clients) if (c.authed && c.attached.has(session)) this.pump(c, session);
  }

  /** Session list changed (state, pending count, a new one). Coalesced; lists are small but frequent. */
  onSessions(): void {
    if (this.sessionsTimer) return;
    this.sessionsTimer = setTimeout(() => {
      this.sessionsTimer = null;
      const msg: HostMsg = { t: "sessions", sessions: this.opts.sessions.list() };
      for (const c of this.clients) if (c.authed) this.send(c, msg);
    }, 150);
  }

  private pump(c: Client, session: string): void {
    if (c.pumping.has(session)) return;
    c.pumping.add(session);
    try {
      const log = this.opts.sessions.log(session);
      for (;;) {
        const after = c.attached.get(session);
        if (after === undefined || after >= log.lastSeq) break;
        if (c.ws.bufferedAmount > HIGH_WATER) { setTimeout(() => this.pump(c, session), 200); break; }
        const page = log.readAfter(after);
        // Skipped (superseded) deltas can leave a page empty; the cursor still moves to the end.
        const last = page.events.length ? page.events[page.events.length - 1]!.seq : log.lastSeq;
        c.attached.set(session, page.more ? last : Math.max(last, log.lastSeq));
        if (page.events.length) this.send(c, { t: "events", session, epoch: log.epoch, events: page.events, more: page.more });
        if (!page.more) break;
      }
    } finally {
      c.pumping.delete(session);
    }
  }

  private attach(c: Client, session: string, epoch: string | undefined, afterSeq: number | undefined): void {
    if (!this.opts.sessions.has(session)) { this.send(c, { t: "error", code: "no_session", message: "no such session", session }); return; }
    const log = this.opts.sessions.log(session);
    if (epoch === log.epoch && afterSeq !== undefined && afterSeq > 0 && afterSeq <= log.lastSeq) {
      // Resume by seq, unless the gap is so large that replaying it would be slower than starting from the tail.
      let cursor = afterSeq;
      let frames = 0;
      for (; frames < CATCHUP_FRAMES; frames++) {
        const page = log.readAfter(cursor);
        if (!page.more) break;
        cursor = page.events.length ? page.events[page.events.length - 1]!.seq : log.lastSeq;
      }
      if (frames < CATCHUP_FRAMES) {
        c.attached.set(session, afterSeq);
        this.pump(c, session);
        return;
      }
    }
    const tail = log.tail();
    c.attached.set(session, log.lastSeq);
    this.send(c, { t: "events", session, epoch: log.epoch, events: tail.events, more: false, tail: { hasOlder: tail.hasOlder } });
  }

  // ---- sockets --------------------------------------------------------------------------------

  /** A phone connected, directly or through the relay; it must say hello with the token within 10 s. */
  connected(ws: Peer): void {
    const c: Client = { ws, authed: false, clientId: "", visibleAt: 0, lastRx: Date.now(), attached: new Map(), pumping: new Set() };
    this.clients.add(c);
    const helloTimer = setTimeout(() => { if (!c.authed) ws.close(4001, "hello"); }, 10_000);
    ws.on("message", (data) => {
      c.lastRx = Date.now();
      let msg: ClientMsg;
      try { msg = JSON.parse(String(data)) as ClientMsg; } catch { return; }
      void this.onClient(c, msg).catch((e: Error) => this.send(c, { t: "error", code: "internal", message: e.message }));
    });
    ws.on("close", () => { clearTimeout(helloTimer); this.clients.delete(c); });
    ws.on("error", () => { /* close follows */ });
  }

  private reapStale(): void {
    const now = Date.now();
    for (const c of this.clients) if (now - c.lastRx > STALE_MS) c.ws.terminate();
  }

  private send(c: Client, msg: HostMsg): void {
    if (c.ws.readyState !== c.ws.OPEN) return;
    const text = JSON.stringify(msg);
    if (Buffer.byteLength(text) > FRAME_CAP) {
      // The log caps events and pages, so this means a bug; say so rather than kill the socket (Paseo #2610).
      this.opts.log?.(`frame over cap dropped: ${msg.t} ${Buffer.byteLength(text)} bytes`);
      if (msg.t !== "error") this.send(c, { t: "error", code: "too_large", message: `${msg.t} frame over ${FRAME_CAP} bytes` });
      return;
    }
    c.ws.send(text);
  }

  private async onClient(c: Client, msg: ClientMsg): Promise<void> {
    if (msg.t === "ping") { this.send(c, { t: "pong", n: msg.n }); return; }
    if (!c.authed) {
      if (msg.t === "hello" && tokenMatches(this.opts.token, msg.token)) {
        c.authed = true;
        c.clientId = typeof msg.clientId === "string" ? msg.clientId.slice(0, 100) : "";
        this.send(c, { t: "ready", host: this.hostInfo, sessions: this.opts.sessions.list() });
      } else {
        this.send(c, { t: "denied", reason: "token" });
        c.ws.close(4003, "denied");
      }
      return;
    }
    const s = this.opts.sessions;
    switch (msg.t) {
      case "hello": return;
      case "attach": this.attach(c, msg.session, msg.epoch, msg.afterSeq); return;
      case "detach": c.attached.delete(msg.session); return;
      case "history": {
        if (!s.has(msg.session)) return;
        const page = s.log(msg.session).before(msg.beforeSeq);
        this.send(c, { t: "history", session: msg.session, reqId: msg.reqId, events: page.events, hasOlder: page.hasOlder });
        return;
      }
      case "create":
        try {
          const id = await s.create(msg);
          this.send(c, { t: "ack", clientMsgId: msg.clientMsgId, session: id });
        } catch (e) {
          this.send(c, { t: "error", code: "create", message: (e as Error).message, clientMsgId: msg.clientMsgId });
        }
        return;
      case "send":
        try {
          const desktop = s.list().some(session => session.id === msg.session && session.origin === "desktop");
          const id = await s.send(msg.session, msg.clientMsgId, msg.text);
          this.send(c, { t: "ack", clientMsgId: msg.clientMsgId, session: id });
          if (desktop && id === msg.session) this.attach(c, id, undefined, undefined);
        } catch (e) {
          this.send(c, { t: "error", code: "send", message: (e as Error).message, clientMsgId: msg.clientMsgId, session: msg.session });
        }
        return;
      case "decide":
        if (!await s.decide(msg.session, msg.id, msg.decision)) this.send(c, { t: "error", code: "stale_permission", message: "already answered or expired", session: msg.session });
        return;
      case "interrupt": await s.interrupt(msg.session); return;
      case "set_model": await s.setModel(msg.session, msg.model, msg.effort); return;
      case "presence": c.visibleAt = msg.visible === true ? this.now() : 0; return;
      case "req":
        try {
          this.send(c, { t: "res", reqId: msg.reqId, ok: true, data: await this.request(msg.op, c) });
        } catch (e) {
          this.send(c, { t: "res", reqId: msg.reqId, ok: false, error: (e as Error).message });
        }
        return;
    }
  }

  private async request(op: ReqOp, c: Client): Promise<unknown> {
    const s = this.opts.sessions;
    switch (op.op) {
      case "models": {
        if (!this.models || Date.now() - this.models.at > 30_000) this.models = { at: Date.now(), data: await this.opts.router.models() };
        return this.models.data;
      }
      case "folders": {
        const cli = await this.opts.recentCli().catch(() => []);
        return recentFolders([...s.recentSources(), ...cli]);
      }
      case "browse": return browse(op.path, op.hidden ?? false);
      case "blob": {
        if (!s.has(op.session)) throw new Error("no such session");
        const text = s.log(op.session).blob(op.id);
        if (text === null) throw new Error("no such blob");
        const offset = Math.max(0, op.offset ?? 0);
        const end = Math.min(text.length, offset + BLOB_CHUNK_CHARS);
        const chunk: BlobChunk = { text: text.slice(offset, end), offset, next: end < text.length ? end : null, bytes: Buffer.byteLength(text) };
        return chunk;
      }
      case "sub": {
        const log = s.subLog(op.session, op.sub);
        if (!log) throw new Error("no such subagent");
        return log.readAfter(op.afterSeq ?? 0);
      }
      case "expo_push_subscribe":
        if (!this.opts.expoPush) throw new Error("native push is off on this host");
        if (!c.clientId) throw new Error("no device id");
        this.opts.expoPush.subscribe(c.clientId, op.token, op.lang);
        return { ok: true };
      case "expo_push_unsubscribe":
        if (c.clientId) this.opts.expoPush?.unsubscribe(c.clientId);
        return { ok: true };
      case "push_key":
        if (!this.opts.push) throw new Error("push is off on this host");
        return { publicKey: this.opts.push.publicKey };
      case "push_subscribe":
        if (!this.opts.push) throw new Error("push is off on this host");
        if (!c.clientId) throw new Error("no device id");
        this.opts.push.subscribe(c.clientId, op.subscription, op.lang);
        return { ok: true };
      case "push_unsubscribe":
        if (c.clientId) this.opts.push?.unsubscribe(c.clientId);
        return { ok: true };
    }
  }

  private async checkRouter(): Promise<void> {
    const st = await this.opts.router.status();
    const next: HostInfo = { ...this.hostInfo, routerOk: st.ok, ...(st.problem ? { routerProblem: st.problem } : {}) };
    if (!st.problem) delete next.routerProblem;
    if (next.routerOk === this.hostInfo.routerOk && next.routerProblem === this.hostInfo.routerProblem) return;
    this.hostInfo = next;
    for (const c of this.clients) if (c.authed) this.send(c, { t: "host", host: next });
  }

  // ---- the PWA --------------------------------------------------------------------------------

  private serve(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/healthz") { res.writeHead(200, { "content-type": "application/json" }).end(`{"ok":true}`); return; }
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405).end(); return; }
    const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
    // Files from outside web/ the client loads: the shared protocol and encryption, and tweetnacl.
    const shared = SHARED[rel];
    const file = shared ? shared(path.dirname(this.opts.webDir)) : path.resolve(this.opts.webDir, rel);
    const ext = path.extname(file);
    if ((!shared && !file.startsWith(this.opts.webDir + path.sep)) || !TYPES[ext]) { res.writeHead(404).end(); return; }
    let stat: fs.Stats;
    try { stat = fs.statSync(file); } catch { res.writeHead(404).end(); return; }
    let body: string | Buffer;
    if (ext === ".ts") {
      const hit = this.stripped.get(file);
      if (hit && hit.mtime === stat.mtimeMs) body = hit.body;
      else {
        // The client is TypeScript like the rest of the product; Node strips the types, no build step.
        body = module.stripTypeScriptTypes(fs.readFileSync(file, "utf8"), { mode: "strip" });
        this.stripped.set(file, { mtime: stat.mtimeMs, body });
      }
    } else body = fs.readFileSync(file);
    res.writeHead(200, {
      "content-type": TYPES[ext]!,
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      ...(ext === ".html" ? { "content-security-policy": CSP } : {}),
    });
    res.end(req.method === "HEAD" ? undefined : body);
  }
}
