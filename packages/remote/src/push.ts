// Web push to the phone (RFC 8030 delivery, RFC 8291 payload encryption, RFC 8292 VAPID, via the
// `web-push` package). Three moments, and only when nobody is looking: a permission request is
// waiting, a turn finished, a turn failed. "Looking" means a connected phone reported the app
// visible in the last 30 s (the phone re-reports every 10 s while visible, so a frozen or
// backgrounded app stops counting within 30 s even if its socket lingers).
//
// The VAPID key pair is made once and kept under the host's config dir (0600); a new pair would
// orphan every subscription. Subscriptions are per device (the phone's clientId) and a push
// service answering 404/410 means the subscription is gone for good, so it is dropped.
import path from "node:path";
import webpush from "web-push";
import { readJson, writeFileAtomic } from "./fsutil.ts";
import type { EventBody, PushSubscriptionJSON, SessionSummary } from "./protocol.ts";

export const VISIBLE_MS = 30_000;

export interface Vapid { publicKey: string; privateKey: string; subject: string }

export function loadVapid(dir: string, subject: string): Vapid {
  const file = path.join(dir, "vapid.json");
  const stored = readJson<Partial<Vapid>>(file);
  if (stored && typeof stored.publicKey === "string" && typeof stored.privateKey === "string") {
    // The subject may change (the https address became known); the keys never do.
    return { publicKey: stored.publicKey, privateKey: stored.privateKey, subject };
  }
  const keys = webpush.generateVAPIDKeys();
  writeFileAtomic(file, JSON.stringify({ publicKey: keys.publicKey, privateKey: keys.privateKey }, null, 2) + "\n");
  return { ...keys, subject };
}

interface Stored { sub: PushSubscriptionJSON; lang: "ko" | "en"; at: number }

export type Sender = (sub: PushSubscriptionJSON, payload: string, opts: { urgency: "normal" | "high"; ttl: number; topic: string }) => Promise<void>;
/** What a failed send means for the subscription: 404 and 410 say it no longer exists (RFC 8030 §7.3, §8). */
export const isGone = (e: unknown): boolean => {
  const code = (e as { statusCode?: unknown })?.statusCode;
  return code === 404 || code === 410;
};

export function webPushSender(vapid: Vapid): Sender {
  return async (sub, payload, opts) => {
    await webpush.sendNotification(sub, payload, {
      vapidDetails: vapid,
      contentEncoding: "aes128gcm",
      urgency: opts.urgency,
      TTL: opts.ttl,
      topic: opts.topic,
      timeout: 15_000,
    });
  };
}

export interface PushPayload { title: string; body: string; session: string; tag: string }

const COPY = {
  ko: {
    permission: "허락이 필요해요",
    done: "작업을 마쳤어요",
    failed: "작업이 멈췄어요",
    failedBody: "{title} — {error}",
  },
  en: {
    permission: "Needs your OK",
    done: "Finished",
    failed: "Stopped with an error",
    failedBody: "{title} — {error}",
  },
} as const;

const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const folderOf = (cwd: string): string => path.basename(cwd) || cwd;

/** The push for an event, or null if this event is not one of the three moments. */
export function pushFor(event: EventBody, s: Pick<SessionSummary, "id" | "title" | "cwd">, lang: "ko" | "en"): PushPayload | null {
  const c = COPY[lang];
  const where = folderOf(s.cwd);
  if (event.kind === "permission") {
    return { title: `${c.permission} · ${where}`, body: clip(`${event.tool}: ${event.summary || event.title}`, 140), session: s.id, tag: `perm-${s.id}` };
  }
  if (event.kind === "result" && event.ok) {
    return { title: `${c.done} · ${where}`, body: clip(s.title, 140), session: s.id, tag: `turn-${s.id}` };
  }
  if (event.kind === "result" && !event.ok) {
    return { title: `${c.failed} · ${where}`, body: clip(c.failedBody.replace("{title}", clip(s.title, 60)).replace("{error}", event.error ?? ""), 140), session: s.id, tag: `turn-${s.id}` };
  }
  return null;
}

export interface NotifierOptions {
  dir: string;
  send: Sender;
  /** true while a phone reported the app visible in the last VISIBLE_MS */
  someoneLooking: () => boolean;
  summary: (session: string) => SessionSummary | undefined;
  log?: (line: string) => void;
}

export class Notifier {
  private opts: NotifierOptions;
  private file: string;
  private subs: Record<string, Stored>;

  constructor(opts: NotifierOptions) {
    this.opts = opts;
    this.file = path.join(opts.dir, "push.json");
    this.subs = readJson<Record<string, Stored>>(this.file) ?? {};
  }

  devices(): string[] { return Object.keys(this.subs); }

  subscribe(clientId: string, sub: PushSubscriptionJSON, lang: "ko" | "en", now = Date.now()): void {
    if (!clientId || typeof sub?.endpoint !== "string" || !/^https:\/\//.test(sub.endpoint) || typeof sub.keys?.p256dh !== "string" || typeof sub.keys?.auth !== "string") {
      throw new Error("invalid push subscription");
    }
    // One subscription per device; a device that re-subscribed replaces its old endpoint.
    this.subs[clientId] = { sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, lang: lang === "en" ? "en" : "ko", at: now };
    this.save();
  }

  unsubscribe(clientId: string): void {
    if (!(clientId in this.subs)) return;
    delete this.subs[clientId];
    this.save();
  }

  /** Called for every appended session event. Resolves when every send finished (tests wait on it). */
  async onEvent(session: string, event: EventBody): Promise<void> {
    if (event.kind !== "permission" && event.kind !== "result") return;
    if (!Object.keys(this.subs).length || this.opts.someoneLooking()) return;
    const s = this.opts.summary(session);
    if (!s) return;
    await Promise.all(Object.entries(this.subs).map(async ([clientId, stored]) => {
      const p = pushFor(event, s, stored.lang);
      if (!p) return;
      try {
        await this.opts.send(stored.sub, JSON.stringify(p), { urgency: event.kind === "permission" ? "high" : "normal", ttl: event.kind === "permission" ? 3600 : 86_400, topic: p.tag.replace(/[^\w-]/g, "").slice(0, 32) });
      } catch (e) {
        if (isGone(e)) {
          // Only drop it if it is still the subscription this send used, not one the phone just replaced.
          if (this.subs[clientId]?.sub.endpoint === stored.sub.endpoint) { delete this.subs[clientId]; this.save(); }
          this.opts.log?.(`push: subscription for device ${clientId.slice(0, 8)} is gone (${(e as { statusCode: number }).statusCode}); removed`);
        } else this.opts.log?.(`push: send failed for device ${clientId.slice(0, 8)}: ${(e as Error).message}`);
      }
    }));
  }

  private save(): void {
    writeFileAtomic(this.file, JSON.stringify(this.subs, null, 1));
  }
}
