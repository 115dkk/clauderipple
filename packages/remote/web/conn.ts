// The link to the host. It never gives up: after a drop it waits min(30 s, attempt × 1 s) and
// tries again, forever, and at once when the phone comes back online or the app comes to the
// front. A half-open socket (the phone switched networks, the Mac went away without a FIN) is
// caught by the app-level ping, not by TCP; coming back to the front probes the open socket first
// (background age is not proof of death) and only 3 s without a pong drops it. Only a refused token
// stops it, because retrying a token the host rejects would just say "connecting" forever — which
// would be a lie.
import { BACKOFF_CAP_MS, PING_MS, READY_MS, STALE_MS } from "../src/protocol.ts";
import type { ClientFeature, ClientMsg, HostMsg } from "../src/protocol.ts";

/** A socket that opens but never says `ready` is as good as down (through the relay: the handshake counts too). */
export { READY_MS };

/** How long an open socket gets to answer the foreground probe before a new attempt starts. */
export const PROBE_MS = 3_000;

export type LinkState = "connecting" | "open" | "waiting" | "offline" | "denied";

export interface LinkStatus {
  state: LinkState;
  /** consecutive failed attempts since the last good connection */
  attempt: number;
  /** when the next attempt starts (state "waiting") */
  nextAt: number | null;
  /** last time a frame arrived from the host; null if never */
  lastRx: number | null;
  /** when the current outage began; null while open */
  downSince: number | null;
}

export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface LinkDeps {
  url: string;
  token: string;
  clientId: string;
  /** Explicit opt-in by a client that understands the feature's full response contract. */
  features?: ClientFeature[];
  makeSocket: (url: string) => SocketLike;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (id: unknown) => void;
  isOnline: () => boolean;
}

export function backoff(attempt: number): number {
  return Math.min(BACKOFF_CAP_MS, Math.max(1, attempt) * 1000);
}

export class Link {
  status: LinkStatus = { state: "connecting", attempt: 0, nextAt: null, lastRx: null, downSince: null };
  onMessage: (msg: HostMsg) => void = () => {};
  /** Called on every status change and once a second while waiting, so countdowns stay true. */
  onStatus: (s: LinkStatus) => void = () => {};
  /** Called after the host accepted the token: re-attach sessions, flush the outbox. */
  onReady: () => void = () => {};

  private deps: LinkDeps;
  private sock: SocketLike | null = null;
  private retryTimer: unknown = null;
  private tickTimer: unknown = null;
  private pingTimer: unknown = null;
  private readyTimer: unknown = null;
  private probeTimer: unknown = null;
  /** The `n` of the probe ping still waiting for its pong, if any. */
  private probeN: number | null = null;
  private pingN = 0;
  private stopped = false;
  /**
   * Bumped whenever the timers are dropped. A callback already queued when its timer was cleared
   * still runs (setTimeout cannot cancel what already fired), so it checks the epoch first: this is
   * what keeps a stop, a foreground return or a nudge from reviving an old retry or countdown.
   */
  private epoch = 0;

  constructor(deps: LinkDeps) { this.deps = deps; }

  start(): void { this.stopped = false; this.connect(); }

  stop(): void {
    this.stopped = true;
    this.clearAll();
    this.dropSocket(1000, "stop");
  }

  /** Network came back, app came to the front, or the user pressed "retry now". */
  nudge(): void {
    if (this.stopped || this.status.state === "denied") return;
    if (this.status.state === "open") { this.probe(); return; }
    this.connect();
  }

  /**
   * The app came back to the front. The time it spent in the background was the phone's, not the
   * computer's silence: counting it put "no answer for 4 minutes" on screen the moment someone
   * returned from another app (Discord, 2026-10-22). The count starts again from now.
   */
  foreground(): void {
    if (this.status.downSince !== null) this.status = { ...this.status, downSince: this.deps.now() };
    this.nudge();
  }

  send(msg: ClientMsg): boolean {
    if (this.status.state !== "open" || !this.sock) return false;
    try { this.sock.send(JSON.stringify(msg)); return true; } catch { return false; }
  }

  private set(patch: Partial<LinkStatus>): void {
    this.status = { ...this.status, ...patch };
    this.onStatus(this.status);
  }

  private clearAll(): void {
    this.epoch++;
    for (const id of [this.retryTimer, this.tickTimer, this.pingTimer, this.readyTimer, this.probeTimer]) if (id !== null) this.deps.clearTimer(id);
    this.retryTimer = this.tickTimer = this.pingTimer = this.readyTimer = this.probeTimer = null;
    this.probeN = null;
  }

  /** Forget the current socket before closing it, so its late close is not read as a live failure. */
  private dropSocket(code: number, reason: string): void {
    const sock = this.sock;
    if (!sock) return;
    this.sock = null;
    try { sock.close(code, reason); } catch { /* already gone */ }
  }

  private connect(): void {
    if (this.stopped) return;
    // One attempt at a time: a nudge or restart abandons the socket still connecting instead of
    // leaving it open beside the new one.
    this.dropSocket(1000, "retry");
    this.clearAll();
    const epoch = this.epoch;
    if (!this.deps.isOnline()) {
      this.set({ state: "offline", nextAt: null, downSince: this.status.downSince ?? this.deps.now() });
      // onStatus is the app's callback: it may have stopped or nudged the link just now.
      if (this.epoch !== epoch) return;
      this.schedule();
      return;
    }
    this.set({ state: "connecting", nextAt: null });
    if (this.epoch !== epoch) return;
    let sock: SocketLike;
    try { sock = this.deps.makeSocket(this.deps.url); } catch { this.fail(); return; }
    this.sock = sock;
    let authed = false;
    sock.onopen = () => {
      if (this.sock !== sock) return;
      this.status.lastRx = this.deps.now();
      sock.send(JSON.stringify({ t: "hello", token: this.deps.token, clientId: this.deps.clientId, ...(this.deps.features ? { features: this.deps.features } : {}) } satisfies ClientMsg));
      this.armPing();
    };
    // From creation, not from open: a connect that hangs (a dead address after a network switch)
    // may fire neither open nor close for minutes.
    this.readyTimer = this.deps.setTimer(() => {
      // Only this socket's own timeout may clear the reference first: a queued old one would forget
      // the live connect timeout, and stop() could then leave it running.
      if (this.sock !== sock) return;
      this.readyTimer = null;
      if (authed) return;
      this.sock = null;
      try { sock.close(4002, "no ready"); } catch { /* gone */ }
      this.fail();
    }, READY_MS);
    sock.onmessage = (ev) => {
      if (this.sock !== sock) return;
      this.status.lastRx = this.deps.now();
      let msg: HostMsg;
      try { msg = JSON.parse(String(ev.data)) as HostMsg; } catch { return; }
      if (msg.t === "pong") {
        // Only the answer to the probe still pending clears it; an older pong (or a later one after
        // the probe timed out) changes nothing.
        if (this.probeN !== null && msg.n === this.probeN) this.clearProbe();
        return;
      }
      if (msg.t === "denied") {
        this.clearAll();
        this.sock = null;
        sock.close(4001, "denied");
        this.set({ state: "denied", nextAt: null });
        return;
      }
      if (msg.t === "ready" && !authed) {
        authed = true;
        this.set({ state: "open", attempt: 0, nextAt: null, downSince: null });
        this.onReady();
      }
      this.onMessage(msg);
    };
    sock.onclose = () => { if (this.sock === sock) this.fail(); };
    sock.onerror = () => { /* onclose follows */ };
  }

  private fail(immediate = false): void {
    this.sock = null;
    this.clearAll();
    const epoch = this.epoch;
    if (this.stopped || this.status.state === "denied") return;
    this.set({ attempt: this.status.attempt + 1, downSince: this.status.downSince ?? this.deps.now() });
    if (this.epoch !== epoch) return;
    if (immediate) this.connect(); else this.schedule();
  }

  private schedule(): void {
    const epoch = this.epoch;
    const wait = backoff(this.status.attempt);
    const nextAt = this.deps.now() + wait;
    if (this.status.state !== "offline") {
      this.set({ state: "waiting", nextAt });
      if (this.epoch !== epoch) return;
    }
    this.retryTimer = this.deps.setTimer(() => {
      if (this.epoch !== epoch) return;
      this.retryTimer = null;
      this.connect();
    }, wait);
    const tick = (): void => {
      if (this.epoch !== epoch) return;
      this.onStatus(this.status);
      if (this.epoch !== epoch) return;
      this.tickTimer = this.deps.setTimer(tick, 1000);
    };
    this.tickTimer = this.deps.setTimer(tick, 1000);
  }

  private armPing(): void {
    const epoch = this.epoch;
    const loop = (): void => {
      if (this.epoch !== epoch) return;
      this.ping();
      if (this.epoch !== epoch) return;
      this.pingTimer = this.deps.setTimer(loop, PING_MS);
    };
    this.pingTimer = this.deps.setTimer(loop, PING_MS);
  }

  /**
   * The app came back to the front. Ask the open socket to answer now instead of trusting its age:
   * the time it spent in the background was the phone's, not the computer's silence. One probe at a
   * time, however often foreground/nudge repeats; a matching pong keeps the socket, and only
   * PROBE_MS without one drops it and starts a new attempt.
   */
  private probe(): void {
    const sock = this.sock;
    if (!sock || this.probeTimer !== null) return;
    const n = ++this.pingN;
    const epoch = this.epoch;
    this.probeN = n;
    this.probeTimer = this.deps.setTimer(() => {
      if (this.epoch !== epoch || this.probeN !== n) return;
      this.probeTimer = null;
      this.probeN = null;
      if (this.sock !== sock) return;
      this.sock = null;
      try { sock.close(4000, "probe timeout"); } catch { /* already gone */ }
      this.fail(true);
    }, PROBE_MS);
    try { sock.send(JSON.stringify({ t: "ping", n } satisfies ClientMsg)); } catch { /* close follows */ }
  }

  private clearProbe(): void {
    if (this.probeTimer !== null) this.deps.clearTimer(this.probeTimer);
    this.probeTimer = null;
    this.probeN = null;
  }

  private ping(): void {
    const sock = this.sock;
    if (!sock) return;
    const last = this.status.lastRx ?? 0;
    if (this.deps.now() - last > STALE_MS) {
      // Silence may be the phone's background, not the host's. Probe before dropping: a socket that
      // is actually alive answers and stays, and the probe's timeout does the dropping.
      this.probe();
      return;
    }
    try { sock.send(JSON.stringify({ t: "ping", n: ++this.pingN } satisfies ClientMsg)); } catch { /* close follows */ }
  }
}
