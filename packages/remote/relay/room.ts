// One host's room on the relay: the host's control socket, and one pair of sockets per phone
// connection (the phone's, and the host's data socket for it). The room forwards frames between a
// pair untouched — they are end-to-end encrypted (src/e2ee.ts) — and never stores one.
//
// Pure logic over a small context, so it runs the same inside the Durable Object (worker.ts, where
// the context is the hibernation API: tags survive the object sleeping between frames) and in an
// in-process test with fake sockets.
import { RELAY_CLOSE, RELAY_FRAME_CAP } from "../src/protocol.ts";
import type { RelayMsg } from "../src/protocol.ts";

export interface Sock {
  send(data: string | ArrayBuffer | Uint8Array): void;
  close(code?: number, reason?: string): void;
}

export interface RoomCtx<S extends Sock> {
  accept(ws: S, tags: string[]): void;
  sockets(tag: string): S[];
  tags(ws: S): string[];
  get(key: string): Promise<string | undefined>;
  put(key: string, value: string): Promise<void>;
  newId(): string;
  sha256(text: string): Promise<string>;
}

const say = (ws: Sock, msg: RelayMsg): void => { try { ws.send(JSON.stringify(msg)); } catch { /* closing */ } };
const shut = (ws: Sock, code: number, reason: string): void => { try { ws.close(code, reason); } catch { /* already closed */ } };

export const CONN_RE = /^[\w-]{8,64}$/;

export function frameBytes(data: string | ArrayBuffer | Uint8Array): number {
  return typeof data === "string" ? new TextEncoder().encode(data).length : data.byteLength;
}

export class Room<S extends Sock> {
  private ctx: RoomCtx<S>;
  constructor(ctx: RoomCtx<S>) { this.ctx = ctx; }

  /**
   * The first host to connect registers this server id with its secret (stored as a hash); later
   * ones must match. Someone who knows the id but not the secret cannot take the room over.
   */
  async hostAllowed(secret: string | null): Promise<boolean> {
    if (!secret || secret.length < 32) return false;
    const hash = await this.ctx.sha256(secret);
    const known = await this.ctx.get("secret");
    if (known === undefined) { await this.ctx.put("secret", hash); return true; }
    return known === hash;
  }

  /** The host's control socket. A newer one replaces an older (a host that reconnected before the old socket timed out). */
  hostControl(ws: S): void {
    const old = this.ctx.sockets("host");
    this.ctx.accept(ws, ["host"]);
    for (const o of old) shut(o, RELAY_CLOSE.replaced, "replaced");
    say(ws, { relay: "hello" });
    // Phones that arrived while the host was away and still have no data socket.
    for (const c of this.ctx.sockets("client")) {
      const conn = this.connOf(c, "c:");
      if (conn && !this.ctx.sockets(`d:${conn}`).length) say(ws, { relay: "connect", conn });
    }
  }

  /** A phone. It waits for {"relay":"open"} before its handshake; with no host connected it is told so at once. */
  client(ws: S): void {
    const conn = this.ctx.newId();
    this.ctx.accept(ws, ["client", `c:${conn}`]);
    const host = this.ctx.sockets("host")[0];
    if (!host) { shut(ws, RELAY_CLOSE.hostOffline, "host offline"); return; }
    say(host, { relay: "connect", conn });
  }

  /** Whether a host data socket for this connection can be accepted (the phone is still there). */
  hasClient(conn: string): boolean {
    return CONN_RE.test(conn) && this.ctx.sockets(`c:${conn}`).length > 0;
  }

  hostData(ws: S, conn: string): void {
    const old = this.ctx.sockets(`d:${conn}`);
    this.ctx.accept(ws, ["data", `d:${conn}`]);
    for (const o of old) shut(o, RELAY_CLOSE.replaced, "replaced");
    const phone = this.ctx.sockets(`c:${conn}`)[0];
    if (!phone) { shut(ws, RELAY_CLOSE.peerGone, "phone gone"); return; }
    say(phone, { relay: "open" });
  }

  message(ws: S, data: string | ArrayBuffer): void {
    if (frameBytes(data) > RELAY_FRAME_CAP) { shut(ws, RELAY_CLOSE.tooBig, "frame over cap"); return; }
    const tags = this.ctx.tags(ws);
    if (tags.includes("host")) {
      // Only pings come this way; the Durable Object answers them without waking (auto-response).
      if (data === "ping") ws.send("pong");
      return;
    }
    const phone = this.connOf(ws, "c:");
    if (phone) { for (const d of this.ctx.sockets(`d:${phone}`)) d.send(data); return; }
    const host = this.connOf(ws, "d:");
    if (host) for (const c of this.ctx.sockets(`c:${host}`)) c.send(data);
  }

  /** One side of a pair went away: the other has nothing to talk to, so it closes too and reconnects. */
  closed(ws: S): void {
    const phone = this.connOf(ws, "c:");
    if (phone) for (const d of this.ctx.sockets(`d:${phone}`)) if (d !== ws) shut(d, 1000, "phone left");
    const host = this.connOf(ws, "d:");
    if (host) for (const c of this.ctx.sockets(`c:${host}`)) if (c !== ws) shut(c, RELAY_CLOSE.peerGone, "host left");
  }

  private connOf(ws: S, prefix: "c:" | "d:"): string | null {
    const tag = this.ctx.tags(ws).find((t) => t.startsWith(prefix));
    return tag ? tag.slice(2) : null;
  }
}
