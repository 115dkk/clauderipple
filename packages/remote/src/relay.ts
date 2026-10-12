// The host's side of the relay. One outbound control socket that never gives up — the same
// liveness numbers as the phone's link and Paseo's daemon (spec): ping every 10 s, stale after
// 30 s of silence, abandoned if not ready 8 s after it was created, backoff min(30 s, n × 1 s)
// forever. When the relay says a phone arrived, the host opens one data socket for it, answers the
// phone's handshake (e2ee.ts) and hands the decrypted channel to HostServer like any other phone.
// The relay sees ciphertext only; the pairing token is checked inside the channel, as on the
// direct path.
import { BACKOFF_CAP_MS, FRAME_CAP, PING_MS, READY_MS, RELAY_FRAME_CAP, STALE_MS } from "./protocol.ts";
import type { RelayMsg } from "./protocol.ts";
import path from "node:path";
import { fromB64u, hostAccept, toB64u } from "./e2ee.ts";
import type { Channel, KeyPair, Nacl } from "./e2ee.ts";
import { readJson, writeFileAtomic } from "./fsutil.ts";
import type { Peer } from "./server.ts";

/** The host's long-term X25519 key pair (its public half goes in the pairing link), made once, kept 0600. */
export function loadHostKey(dir: string, nacl: Nacl): KeyPair {
  const file = path.join(dir, "host-key.json");
  const stored = readJson<{ publicKey?: string; secretKey?: string }>(file);
  if (stored?.publicKey && stored.secretKey) {
    const kp = { publicKey: fromB64u(stored.publicKey), secretKey: fromB64u(stored.secretKey) };
    if (kp.publicKey.length === 32 && kp.secretKey.length === 32) return kp;
    throw new Error(`${file} is damaged; remove it to make a new key (every phone then pairs again)`);
  }
  const kp = nacl.box.keyPair();
  writeFileAtomic(file, JSON.stringify({ publicKey: toB64u(kp.publicKey), secretKey: toB64u(kp.secretKey) }, null, 2) + "\n");
  return kp;
}

/** What the host needs of a WebSocket client (the `ws` package's WebSocket fits). */
export interface WsLike {
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  on(event: "open", fn: () => void): unknown;
  on(event: "message", fn: (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => void): unknown;
  on(event: "close", fn: (code: number) => void): unknown;
  on(event: "error", fn: (e: Error) => void): unknown;
  on(event: "unexpected-response", fn: (req: unknown, res: { statusCode?: number }) => void): unknown;
}
const OPEN = 1;

export interface RelayDeps {
  /** the relay's origin, https:// (or http://localhost for `wrangler dev`) */
  relay: string;
  serverId: string;
  secret: string;
  hostKey: KeyPair;
  nacl: Nacl;
  makeSocket: (url: string, headers: Record<string, string>) => WsLike;
  onPeer: (peer: Peer) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
  log?: (line: string) => void;
}

export type RelayState = "connecting" | "open" | "waiting";

export function relayBackoff(attempt: number): number {
  return Math.min(BACKOFF_CAP_MS, Math.max(1, attempt) * 1000);
}

function wsOrigin(relay: string): string {
  const u = new URL(relay);
  return `${u.protocol === "https:" ? "wss:" : "ws:"}//${u.host}`;
}

const toBytes = (data: Buffer | ArrayBuffer | Buffer[]): Uint8Array =>
  Array.isArray(data) ? new Uint8Array(Buffer.concat(data)) : data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

/**
 * One phone through the relay, after the handshake: a Peer whose frames are sealed and opened
 * here. Anything that does not open — altered, replayed, out of order, or plaintext — ends it.
 */
export class SecurePeer implements Peer {
  readonly OPEN = OPEN;
  private ws: WsLike;
  private channel: Channel;
  private handlers: { message: ((data?: unknown) => void)[]; close: ((data?: unknown) => void)[]; error: ((data?: unknown) => void)[] } = { message: [], close: [], error: [] };
  private closed = false;

  constructor(ws: WsLike, channel: Channel) {
    this.ws = ws;
    this.channel = channel;
    ws.on("message", (data, isBinary) => {
      if (this.closed) return;
      const bytes = toBytes(data);
      if (!isBinary || bytes.length > RELAY_FRAME_CAP) { this.fail(4400, "bad frame"); return; }
      let text: string;
      try { text = channel.open(bytes); } catch { this.fail(4400, "bad frame"); return; }
      if (text.length > FRAME_CAP) { this.fail(1009, "frame over cap"); return; }
      for (const fn of this.handlers.message) fn(text);
    });
    ws.on("close", () => this.end());
    ws.on("error", (e) => { for (const fn of this.handlers.error) fn(e); });
  }

  get readyState(): number { return this.closed ? 3 : this.ws.readyState; }
  get bufferedAmount(): number { return this.ws.bufferedAmount; }

  send(text: string): void {
    if (this.closed) return;
    this.ws.send(this.channel.seal(text));
  }

  close(code = 1000, reason = ""): void { try { this.ws.close(code, reason); } catch { /* gone */ } this.end(); }
  terminate(): void { try { this.ws.terminate(); } catch { /* gone */ } this.end(); }

  on(event: "message" | "close" | "error", fn: (data?: unknown) => void): unknown {
    this.handlers[event].push(fn);
    return this;
  }

  private fail(code: number, reason: string): void { this.close(code, reason); }

  private end(): void {
    if (this.closed) return;
    this.closed = true;
    for (const fn of this.handlers.close) fn();
  }
}

export class RelayHost {
  state: RelayState = "connecting";
  attempt = 0;
  private deps: RelayDeps;
  private now: () => number;
  private setTimer: (fn: () => void, ms: number) => unknown;
  private clearTimer: (id: unknown) => void;
  private sock: WsLike | null = null;
  private lastRx = 0;
  private timers: { retry: unknown; ping: unknown; ready: unknown } = { retry: null, ping: null, ready: null };
  private stopped = false;
  private data = new Set<WsLike>();

  constructor(deps: RelayDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  }

  start(): void { this.stopped = false; this.connect(); }

  stop(): void {
    this.stopped = true;
    this.clearAll();
    try { this.sock?.close(1000, "stop"); } catch { /* gone */ }
    this.sock = null;
    for (const d of this.data) try { d.close(1001, "host stopping"); } catch { /* gone */ }
    this.data.clear();
  }

  private headers(): Record<string, string> { return { "x-ripple-host-secret": this.deps.secret }; }

  private clearAll(): void {
    for (const k of ["retry", "ping", "ready"] as const) if (this.timers[k] !== null) { this.clearTimer(this.timers[k]); this.timers[k] = null; }
  }

  private connect(): void {
    if (this.stopped) return;
    this.state = "connecting";
    let sock: WsLike;
    try { sock = this.deps.makeSocket(`${wsOrigin(this.deps.relay)}/ws/host?server=${encodeURIComponent(this.deps.serverId)}`, this.headers()); } catch (e) {
      this.deps.log?.(`relay: ${(e as Error).message}`);
      this.fail(null);
      return;
    }
    this.sock = sock;
    let ready = false;
    // From creation: a connect that hangs after a network change fires neither open nor close for minutes.
    this.timers.ready = this.setTimer(() => {
      this.timers.ready = null;
      if (!ready && this.sock === sock) { try { sock.terminate(); } catch { /* gone */ } this.fail(sock); }
    }, READY_MS);
    sock.on("open", () => { if (this.sock === sock) this.lastRx = this.now(); });
    sock.on("message", (data) => {
      if (this.sock !== sock) return;
      this.lastRx = this.now();
      const text = Buffer.isBuffer(data) ? data.toString("utf8") : Array.isArray(data) ? Buffer.concat(data).toString("utf8") : Buffer.from(data).toString("utf8");
      if (text === "pong") return;
      let msg: RelayMsg;
      try { msg = JSON.parse(text) as RelayMsg; } catch { return; }
      if (msg.relay === "hello" && !ready) {
        ready = true;
        if (this.timers.ready !== null) { this.clearTimer(this.timers.ready); this.timers.ready = null; }
        if (this.attempt > 0) this.deps.log?.(`relay: connected again after ${this.attempt} attempt(s)`);
        else this.deps.log?.(`relay: connected to ${this.deps.relay}`);
        this.state = "open";
        this.attempt = 0;
        this.armPing(sock);
      } else if (msg.relay === "connect" && typeof msg.conn === "string") this.openData(msg.conn);
    });
    sock.on("unexpected-response", (_req, res) => {
      // 403: another host already holds this server id with a different secret. Retrying is still right (it may be a stale room), but say so.
      this.deps.log?.(`relay: refused with HTTP ${res.statusCode ?? "?"}`);
      // With a listener here, `ws` leaves the handshake to us; end it so the close (and the retry) follow now.
      try { sock.terminate(); } catch { /* gone */ }
    });
    sock.on("close", () => { if (this.sock === sock) this.fail(sock); });
    sock.on("error", () => { /* close follows */ });
  }

  private fail(sock: WsLike | null): void {
    if (sock && this.sock !== sock) return;
    this.sock = null;
    this.clearAll();
    if (this.stopped) return;
    this.attempt++;
    this.state = "waiting";
    this.timers.retry = this.setTimer(() => { this.timers.retry = null; this.connect(); }, relayBackoff(this.attempt));
  }

  private armPing(sock: WsLike): void {
    const loop = (): void => {
      this.timers.ping = null;
      if (this.sock !== sock) return;
      if (this.now() - this.lastRx > STALE_MS) {
        // Half-open: no frame, not even a pong, for 30 s. Drop it ourselves rather than wait for TCP.
        try { sock.terminate(); } catch { /* gone */ }
        this.fail(sock);
        return;
      }
      if (sock.readyState === OPEN) try { sock.send("ping"); } catch { /* close follows */ }
      this.timers.ping = this.setTimer(loop, PING_MS);
    };
    this.timers.ping = this.setTimer(loop, PING_MS);
  }

  /** A phone is waiting in the room: open its data socket and answer its handshake. */
  private openData(conn: string): void {
    if (!/^[\w-]{8,64}$/.test(conn)) return;
    let ws: WsLike;
    try { ws = this.deps.makeSocket(`${wsOrigin(this.deps.relay)}/ws/host-data?server=${encodeURIComponent(this.deps.serverId)}&conn=${encodeURIComponent(conn)}`, this.headers()); } catch { return; }
    this.data.add(ws);
    let done = false;
    const timer = this.setTimer(() => { if (!done) try { ws.terminate(); } catch { /* gone */ } }, READY_MS * 2);
    const onHello = (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean): void => {
      if (done) return;
      done = true;
      this.clearTimer(timer);
      try {
        if (isBinary) throw new Error("handshake must be text");
        const bytes = toBytes(data);
        if (bytes.length > 4096) throw new Error("handshake too large");
        const { text, channel } = hostAccept(this.deps.nacl, this.deps.hostKey, new TextDecoder().decode(bytes));
        ws.send(text);
        this.deps.onPeer(new SecurePeer(ws, channel));
      } catch (e) {
        this.deps.log?.(`relay: phone handshake failed: ${(e as Error).message}`);
        try { ws.close(4400, "handshake"); } catch { /* gone */ }
      }
    };
    ws.on("message", onHello);
    ws.on("close", () => { this.data.delete(ws); this.clearTimer(timer); });
    ws.on("error", () => { /* close follows */ });
  }
}
