// Native push is a metadata-only boundary: neither Expo nor Apple receives session text.
import path from "node:path";
import { readJson, writeFileAtomic } from "./fsutil.ts";
import type { EventBody } from "./protocol.ts";

export interface ExpoPayload {
  to: string;
  title: "Ripple Remote";
  body: string;
  data: { session: string };
  sound: "default";
  ttl: number;
}
export type ExpoSender = (payload: ExpoPayload) => Promise<"sent" | "gone">;
interface Stored { token: string; lang: "ko" | "en" }

export const validExpoToken = (token: string): boolean => /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/.test(token);

export function expoBody(event: EventBody, lang: "ko" | "en"): string | null {
  if (event.kind === "permission") return lang === "ko" ? "승인을 기다립니다" : "Waiting for approval";
  if (event.kind !== "result") return null;
  if (event.ok) return lang === "ko" ? "작업을 마쳤습니다" : "Work finished";
  return lang === "ko" ? "작업이 실패했습니다" : "Work failed";
}

/** Inject only external boundaries: HTTP and the wait for Expo's asynchronous receipts. */
export function expoSender(fetcher: typeof fetch = fetch, wait: () => Promise<void> = () => new Promise(resolve => { setTimeout(resolve, 15_000).unref(); })): ExpoSender {
  return async (payload) => {
    const response = await fetcher("https://exp.host/--/api/v2/push/send", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Expo push HTTP ${response.status}`);
    const json = await response.json() as { data?: { status?: string; id?: string; message?: string; details?: { error?: string } } };
    const ticket = json.data;
    if (ticket?.details?.error === "DeviceNotRegistered") return "gone";
    if (ticket?.status !== "ok" || !ticket.id) throw new Error(ticket?.message ?? "invalid Expo push ticket");
    // Receipt errors can arrive after an accepted ticket. Poll for up to 15 minutes without
    // blocking the session's append (main calls onEvent asynchronously).
    for (let attempt = 0; attempt < 60; attempt++) {
      await wait();
      const receiptResponse = await fetcher("https://exp.host/--/api/v2/push/getReceipts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [ticket.id] }), signal: AbortSignal.timeout(15_000),
      });
      if (!receiptResponse.ok) throw new Error(`Expo receipts HTTP ${receiptResponse.status}`);
      const receiptJson = await receiptResponse.json() as { data?: Record<string, { status?: string; message?: string; details?: { error?: string } }> };
      const receipt = receiptJson.data?.[ticket.id];
      if (!receipt) continue;
      if (receipt.details?.error === "DeviceNotRegistered") return "gone";
      if (receipt.status !== "ok") throw new Error(receipt.message ?? "Expo receipt failed");
      return "sent";
    }
    throw new Error("Expo receipt timed out");
  };
}

export class ExpoNotifier {
  private file: string;
  private tokens: Record<string, Stored>;
  private opts: { dir: string; send: ExpoSender; seenRecently: (session: string) => boolean; log: (line: string) => void };
  constructor(opts: { dir: string; send: ExpoSender; seenRecently: (session: string) => boolean; log: (line: string) => void }) {
    this.opts = opts;
    this.file = path.join(opts.dir, "expo-push.json");
    this.tokens = readJson<Record<string, Stored>>(this.file) ?? {};
  }
  devices(): string[] { return Object.keys(this.tokens); }
  subscribe(clientId: string, token: string, lang: "ko" | "en"): void {
    if (!clientId || typeof token !== "string" || !validExpoToken(token)) throw new Error("invalid Expo push token");
    this.tokens[clientId] = { token, lang: lang === "en" ? "en" : "ko" };
    this.save();
  }
  unsubscribe(clientId: string): void {
    if (!(clientId in this.tokens)) return;
    delete this.tokens[clientId];
    this.save();
  }
  async onEvent(session: string, event: EventBody): Promise<void> {
    if (this.opts.seenRecently(session)) return;
    await Promise.all(Object.entries(this.tokens).map(async ([id, stored]) => {
      const body = expoBody(event, stored.lang);
      if (!body) return;
      try {
        const result = await this.opts.send({ to: stored.token, title: "Ripple Remote", body, data: { session }, sound: "default", ttl: event.kind === "permission" ? 3600 : 86400 });
        if (result === "gone" && this.tokens[id]?.token === stored.token) this.unsubscribe(id);
      } catch (error) {
        this.opts.log(`expo push: send failed for device ${id.slice(0, 8)}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }));
  }
  private save(): void { writeFileAtomic(this.file, JSON.stringify(this.tokens, null, 1)); }
}
