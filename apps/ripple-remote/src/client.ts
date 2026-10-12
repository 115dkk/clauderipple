import 'react-native-get-random-values';
import nacl from 'tweetnacl';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { AppState } from 'react-native';
import { Link, type LinkStatus } from '../../../packages/remote/web/conn.ts';
import { RelaySocket, relayClientUrl, type RelayPairing, type RawSocket } from '../../../packages/remote/web/secure.ts';
import { fromB64u, toB64u } from '../../../packages/remote/src/e2ee.ts';
import { PING_MS, type ClientMsg, type HostInfo, type HostMsg, type ReqOp, type SessionEvent, type SessionSummary } from '../../../packages/remote/src/protocol.ts';
import { type Outgoing } from '../../../packages/remote/web/timeline.ts';

interface Pairing extends RelayPairing { token: string; clientId: string }
interface Pending { message: Extract<ClientMsg, { t: 'send' | 'create' }>; at: number; error?: string }
export interface History { epoch: string; events: SessionEvent[]; hasOlder: boolean }
export interface Snapshot {
  loaded: boolean; paired: boolean; host: HostInfo | null; sessions: SessionSummary[];
  status: LinkStatus | null; histories: Record<string, History>; pending: Pending[]; error: string | null;
}
const initial: Snapshot = { loaded: false, paired: false, host: null, sessions: [], status: null, histories: {}, pending: [], error: null };
const id = (): string => toB64u(nacl.randomBytes(18));
const errorText = (e: unknown): string => e instanceof Error ? e.message : String(e);

export function parsePairing(text: string): Omit<Pairing, 'clientId'> {
  const url = new URL(text.trim());
  const params = new URLSearchParams(url.hash.slice(1));
  const token = params.get('pair'), server = params.get('server'), hpk = params.get('hpk');
  if (url.protocol !== 'https:' || url.username || url.password || !token || !server || !hpk || fromB64u(hpk).length !== 32) throw new Error('Relay pairing link required (#pair=…&server=…&hpk=…)');
  return { url: url.origin, token, server, hpk };
}

function nativeSocket(url: string): RawSocket {
  const ws = new WebSocket(url);
  const socket: RawSocket = {
    get binaryType() { return ws.binaryType; }, set binaryType(value: string) { ws.binaryType = value === 'arraybuffer' ? 'arraybuffer' : 'blob'; },
    get readyState() { return ws.readyState; },
    send: data => ws.send(data), close: (code, reason) => ws.close(code, reason),
    onopen: null, onmessage: null, onclose: null, onerror: null,
  };
  ws.onopen = event => socket.onopen?.(event);
  ws.onmessage = event => socket.onmessage?.({ data: event.data });
  ws.onclose = event => socket.onclose?.(event);
  ws.onerror = event => socket.onerror?.(event);
  return socket;
}

class RemoteClient {
  snapshot: Snapshot = initial;
  private listeners = new Set<() => void>();
  private pairing: Pairing | null = null;
  private link: Link | null = null;
  private active: string | null = null;
  private requests = new Map<string, { resolve: (data: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private saves: Promise<void> = Promise.resolve();
  subscribe = (fn: () => void): (() => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  getSnapshot = (): Snapshot => this.snapshot;
  private update(patch: Partial<Snapshot>): void { this.snapshot = { ...this.snapshot, ...patch }; this.listeners.forEach(fn => fn()); }
  report(error: unknown): void { this.update({ error: errorText(error) }); }
  clearError(): void { this.update({ error: null }); }
  refresh(): void { this.update({}); }
  async initialize(): Promise<void> {
    try {
      const saved = await SecureStore.getItemAsync('pairing');
      if (saved) {
        this.pairing = JSON.parse(saved) as Pairing;
        const pending = await AsyncStorage.getItem('outbox');
        this.update({ pending: pending ? JSON.parse(pending) as Pending[] : [] });
        this.connect();
      }
    } catch (e) { this.report(e); }
    this.update({ loaded: true });
    AppState.addEventListener('change', state => { this.link?.send({ t: 'presence', visible: state === 'active' }); if (state === 'active') this.link?.nudge(); });
    setInterval(() => { if (AppState.currentState === 'active') this.link?.send({ t: 'presence', visible: true }); }, PING_MS);
  }
  async pair(text: string): Promise<void> {
    const parsed = parsePairing(text);
    if (this.pairing && (this.pairing.url !== parsed.url || this.pairing.server !== parsed.server || this.pairing.hpk !== parsed.hpk)) throw new Error('Unpair the current Mac before pairing another Mac');
    const pairing = { ...parsed, clientId: this.pairing?.clientId ?? id() };
    await SecureStore.setItemAsync('pairing', JSON.stringify(pairing));
    this.pairing = pairing;
    this.connect();
  }
  async unpair(): Promise<void> {
    // Refuse to silently leave a registered native token behind when offline.
    if (await SecureStore.getItemAsync('expoToken')) await this.request({ op: 'expo_push_unsubscribe' });
    await this.saves;
    await SecureStore.deleteItemAsync('pairing');
    await SecureStore.deleteItemAsync('expoToken');
    await AsyncStorage.removeItem('outbox');
    this.link?.stop(); this.link = null; this.pairing = null; this.active = null;
    this.update({ ...initial, loaded: true });
  }
  private connect(): void {
    this.link?.stop();
    const p = this.pairing;
    if (!p) return;
    const link = new Link({ url: relayClientUrl(p), token: p.token, clientId: p.clientId,
      makeSocket: url => new RelaySocket(nativeSocket(url), p, nacl), now: Date.now,
      setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: timer => clearTimeout(timer as ReturnType<typeof setTimeout>), isOnline: () => true });
    this.link = link;
    link.onStatus = status => this.update({ status: { ...status } });
    link.onMessage = msg => this.receive(msg);
    link.onReady = () => {
      link.send({ t: 'presence', visible: AppState.currentState === 'active' });
      if (this.active) this.attach(this.active);
      this.flush();
      void this.registerSavedToken().catch(e => this.report(e));
    };
    this.update({ paired: true, error: null });
    link.start();
  }
  retry(): void { this.link?.nudge(); }
  send(message: ClientMsg): void { if (!this.link?.send(message)) throw new Error('Mac is not connected'); }
  request(op: ReqOp): Promise<unknown> {
    const reqId = id();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.requests.delete(reqId); reject(new Error('Mac request timed out')); }, 15_000);
      this.requests.set(reqId, { resolve, reject, timer });
      if (!this.link?.send({ t: 'req', reqId, op })) { clearTimeout(timer); this.requests.delete(reqId); reject(new Error('Mac is not connected')); }
    });
  }
  async registerToken(token: string, lang: 'ko' | 'en'): Promise<void> {
    await this.request({ op: 'expo_push_subscribe', token, lang });
    await SecureStore.setItemAsync('expoToken', JSON.stringify({ token, lang }));
  }
  private async registerSavedToken(): Promise<void> {
    const saved = await SecureStore.getItemAsync('expoToken');
    if (!saved) return;
    const data = JSON.parse(saved) as { token: string; lang: 'ko' | 'en' };
    await this.request({ op: 'expo_push_subscribe', ...data });
  }
  open(session: string): void { if (this.active && this.active !== session) this.link?.send({ t: 'detach', session: this.active }); this.active = session; this.attach(session); }
  private attach(session: string): void {
    const h = this.snapshot.histories[session];
    this.link?.send({ t: 'attach', session, epoch: h?.epoch, afterSeq: h?.events.at(-1)?.seq });
  }
  older(session: string): void {
    const h = this.snapshot.histories[session];
    if (!h?.events.length) return;
    this.send({ t: 'history', session, beforeSeq: h.events[0]!.seq, reqId: id() });
  }
  outgoing(session: string): Outgoing[] { return this.snapshot.pending.filter(p => p.message.t === 'send' && p.message.session === session).map(p => ({ clientMsgId: p.message.clientMsgId, text: p.message.text, at: p.at, state: 'pending' })); }
  async queue(message: Omit<Extract<ClientMsg, { t: 'send' }>, 'clientMsgId'> | Omit<Extract<ClientMsg, { t: 'create' }>, 'clientMsgId'>): Promise<void> {
    const pending: Pending = { message: { ...message, clientMsgId: id() }, at: Date.now() };
    this.update({ pending: [...this.snapshot.pending, pending] });
    await this.persist();
    this.flush();
  }
  private persist(): Promise<void> {
    const data = JSON.stringify(this.snapshot.pending);
    this.saves = this.saves.catch(e => this.report(e)).then(() => AsyncStorage.setItem('outbox', data));
    return this.saves;
  }
  private flush(): void { for (const p of this.snapshot.pending) { if (p.error) continue; if (!this.link?.send(p.message)) break; } }
  async retryPending(clientMsgId: string): Promise<void> {
    this.update({ pending: this.snapshot.pending.map(p => p.message.clientMsgId === clientMsgId ? { message: p.message, at: p.at } : p) });
    await this.persist(); this.flush();
  }
  async discardPending(clientMsgId: string): Promise<void> {
    this.update({ pending: this.snapshot.pending.filter(p => p.message.clientMsgId !== clientMsgId) });
    await this.persist();
  }
  private merge(session: string, epoch: string, events: SessionEvent[], hasOlder: boolean, replace: boolean): void {
    const old = this.snapshot.histories[session];
    const merged = new Map<number, SessionEvent>();
    if (!replace && old?.epoch === epoch) old.events.forEach(e => merged.set(e.seq, e));
    events.forEach(e => merged.set(e.seq, e));
    this.update({ histories: { ...this.snapshot.histories, [session]: { epoch, events: [...merged.values()].sort((a, b) => a.seq - b.seq), hasOlder } } });
  }
  private receive(msg: HostMsg): void {
    switch (msg.t) {
      case 'ready': this.update({ host: msg.host, sessions: msg.sessions }); break;
      case 'sessions': this.update({ sessions: msg.sessions }); break;
      case 'host': this.update({ host: msg.host }); break;
      case 'events': this.merge(msg.session, msg.epoch, msg.events, msg.tail?.hasOlder ?? this.snapshot.histories[msg.session]?.hasOlder ?? false, !!msg.tail); break;
      case 'history': this.merge(msg.session, this.snapshot.histories[msg.session]?.epoch ?? '', msg.events, msg.hasOlder, false); break;
      case 'ack': {
        const pending = this.snapshot.pending.find(p => p.message.clientMsgId === msg.clientMsgId);
        this.update({ pending: this.snapshot.pending.filter(p => p.message.clientMsgId !== msg.clientMsgId) });
        void this.persist().catch(e => this.report(e));
        if (pending?.message.t === 'create') { this.open(msg.session); this.onCreated?.(msg.session); }
        break;
      }
      case 'res': {
        const req = this.requests.get(msg.reqId);
        if (!req) break;
        this.requests.delete(msg.reqId); clearTimeout(req.timer);
        if (msg.ok) req.resolve(msg.data); else req.reject(new Error(msg.error));
        break;
      }
      case 'error':
        if (msg.clientMsgId) {
          this.update({ pending: this.snapshot.pending.map(p => p.message.clientMsgId === msg.clientMsgId ? { ...p, error: msg.message } : p) });
          void this.persist().catch(e => this.report(e));
        }
        this.report(msg.message); break;
    }
  }
  onCreated: ((session: string) => void) | null = null;
}
export const remote = new RemoteClient();
