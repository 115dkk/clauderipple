// How much of each Antigravity (Cloud Code Assist) account's quota is left, for the dashboard and
// the status bar's limits row. One request per account, like ClaudeUsage (anthropic-usage.ts): the
// accounts store already refreshes the OAuth token, so this only reads.
//
// Measured 2026-10-15 against a live Antigravity subscription:
//   POST {prodApi}/v1internal:retrieveUserQuotaSummary
//   headers: authorization: Bearer <accessToken>, content-type: application/json, user-agent
//   body:    {"project": "<projectId>"}
//   answer:  {"groups":[{"displayName":"Gemini Models","buckets":[
//              {"bucketId":"gemini-weekly","displayName":"Weekly","window":"weekly",
//               "resetTime":"…","remainingFraction":0.98},
//              {"bucketId":"gemini-5h","displayName":"5h","window":"5h",…}]},
//            {"displayName":"Claude and GPT models","buckets":[
//              {"bucketId":"3p-weekly",…},{"bucketId":"3p-5h",…}]}]}
// `remainingFraction` is what is left (1 = untouched), so used = (1 - remainingFraction) * 100. The
// older `retrieveUserQuota` returns meaningless values and is deliberately not used.

import type { GoogleCredential } from "./accounts.ts";
import { GOOGLE_OAUTH, antigravityUserAgent, type FetchLike } from "./antigravity.ts";

/** The five-hour and weekly window lengths in minutes, for the limits row's `window_minutes`. */
const FIVE_HOURS = 5 * 60;
const WEEK = 7 * 24 * 60;

/** One quota bucket as the endpoint answers it. */
export type QuotaBucket = {
  bucketId: string;
  displayName: string;
  /** "5h" or "weekly", as the endpoint names it. */
  window: string;
  resetTime?: string;
  /** 0..1 of the quota left; 1 = untouched. */
  remainingFraction: number;
};

export type QuotaGroup = { displayName: string; buckets: QuotaBucket[] };

/**
 * Parse the `retrieveUserQuotaSummary` body into groups. A group or bucket missing the fields the
 * row reads is dropped rather than guessed; null when the body is not the shape at all (so the
 * caller keeps its last good answer instead of blanking).
 */
export function parseQuotaSummary(body: unknown): QuotaGroup[] | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const groups = (body as { groups?: unknown }).groups;
  if (!Array.isArray(groups)) return null;
  const out: QuotaGroup[] = [];
  for (const g of groups) {
    if (!g || typeof g !== "object" || Array.isArray(g)) continue;
    const group = g as { displayName?: unknown; buckets?: unknown };
    if (typeof group.displayName !== "string" || !group.displayName) continue;
    const buckets: QuotaBucket[] = [];
    if (Array.isArray(group.buckets)) {
      for (const b of group.buckets) {
        if (!b || typeof b !== "object" || Array.isArray(b)) continue;
        const bucket = b as { bucketId?: unknown; displayName?: unknown; window?: unknown; resetTime?: unknown; remainingFraction?: unknown };
        if (typeof bucket.remainingFraction !== "number" || !Number.isFinite(bucket.remainingFraction)) continue;
        if (typeof bucket.window !== "string" || !bucket.window) continue;
        buckets.push({
          bucketId: typeof bucket.bucketId === "string" ? bucket.bucketId : "",
          displayName: typeof bucket.displayName === "string" ? bucket.displayName : "",
          window: bucket.window,
          ...(typeof bucket.resetTime === "string" ? { resetTime: bucket.resetTime } : {}),
          remainingFraction: bucket.remainingFraction,
        });
      }
    }
    if (buckets.length) out.push({ displayName: group.displayName, buckets });
  }
  return out;
}

/** One window the `/api/limits` endpoint reads: the shape the mod's limits row instruments. */
export type GoogleWindow = {
  kind: "five_hour" | "seven_day" | "scoped" | "window";
  label?: string;
  used_percent: number;
  window_minutes?: number;
  /** epoch seconds */
  reset_at?: number;
};

/** The window length in minutes, from the endpoint's own name ("5h", "weekly"). */
function windowMinutes(window: string): number | undefined {
  if (window === "5h") return FIVE_HOURS;
  if (window === "weekly") return WEEK;
  return undefined;
}

const RANK: Record<string, number> = { five_hour: 0, seven_day: 1, scoped: 2, window: 3 };
/** Five-hour, then weekly, then the rest: the same order the row shows Claude's own windows in. */
function ordered(windows: GoogleWindow[]): GoogleWindow[] {
  return windows.map((w, i) => [w, i] as const).sort((a, b) => (RANK[a[0].kind]! - RANK[b[0].kind]!) || (a[1] - b[1])).map(([w]) => w);
}

/**
 * The endpoint's groups as windows the limits row reads. "Gemini Models" carries the plan's own
 * five-hour and weekly windows; every other group (the measured "Claude and GPT models") is a
 * third-party window, shown as a `scoped` "3P" with its length in `window_minutes`.
 */
export function googleWindowsFromGroups(groups: readonly QuotaGroup[]): GoogleWindow[] {
  const out: GoogleWindow[] = [];
  for (const group of groups) {
    const gemini = /gemini/i.test(group.displayName);
    for (const bucket of group.buckets) {
      const minutes = windowMinutes(bucket.window);
      const used = Math.round((1 - bucket.remainingFraction) * 1000) / 10;
      const at = bucket.resetTime ? Math.round(Date.parse(bucket.resetTime) / 1000) : NaN;
      const reset = Number.isFinite(at) ? { reset_at: at } : {};
      if (gemini) {
        const kind: GoogleWindow["kind"] = bucket.window === "5h" ? "five_hour" : bucket.window === "weekly" ? "seven_day" : "window";
        out.push({ kind, used_percent: used, ...(minutes !== undefined ? { window_minutes: minutes } : {}), ...reset });
      } else {
        out.push({ kind: "scoped", label: "3P", used_percent: used, ...(minutes !== undefined ? { window_minutes: minutes } : {}), ...reset });
      }
    }
  }
  return ordered(out);
}

type UsageSource = { credentials(): Promise<GoogleCredential[]> };
type UsageOptions = {
  fetch?: FetchLike;
  now?: () => number;
  ttlMs?: number;
  timeoutMs?: number;
  warn?: (message: string) => void;
};

/**
 * Per-account quota groups, fetched at most once per `ttlMs` per account. A failed lookup keeps the
 * last good groups rather than blanking them, and only the status code is logged.
 */
export class GoogleUsage {
  private readonly last = new Map<string, QuotaGroup[]>();
  private inFlight: Promise<Record<string, QuotaGroup[]>> | null = null;
  private fetchedAt = Number.NEGATIVE_INFINITY;
  private readonly source: UsageSource;
  private readonly opts: UsageOptions;

  constructor(source: UsageSource, opts: UsageOptions) {
    this.source = source;
    this.opts = opts;
  }

  /** Groups by account owner id, from the store's own account ids. */
  snapshot(): Promise<Record<string, QuotaGroup[]>> {
    const now = (this.opts.now ?? Date.now)();
    if (now - this.fetchedAt < (this.opts.ttlMs ?? 5 * 60_000)) return Promise.resolve(Object.fromEntries(this.last));
    this.inFlight ??= this.fetchAll().finally(() => {
      this.fetchedAt = (this.opts.now ?? Date.now)();
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async fetchAll(): Promise<Record<string, QuotaGroup[]>> {
    let credentials: GoogleCredential[];
    try {
      credentials = await this.source.credentials();
    } catch (e) {
      this.opts.warn?.(`google usage: no credentials: ${(e as Error).message}`);
      return Object.fromEntries(this.last);
    }
    await Promise.all(credentials.map(async (credential) => {
      const groups = await this.fetchOne(credential);
      if (groups) this.last.set(credential.ownerId, groups);
    }));
    // An account that was removed must not keep its old numbers on the screen.
    const owners = new Set(credentials.map((c) => c.ownerId));
    for (const owner of [...this.last.keys()]) if (!owners.has(owner)) this.last.delete(owner);
    return Object.fromEntries(this.last);
  }

  private async fetchOne(credential: GoogleCredential): Promise<QuotaGroup[] | null> {
    const owner = credential.ownerId.slice(0, 8);
    try {
      const res = await (this.opts.fetch ?? fetch)(`${GOOGLE_OAUTH.prodApi}/${GOOGLE_OAUTH.apiVersion}:retrieveUserQuotaSummary`, {
        method: "POST",
        headers: { authorization: `Bearer ${credential.accessToken}`, "content-type": "application/json", accept: "*/*", "user-agent": antigravityUserAgent() },
        body: JSON.stringify({ project: credential.projectId }),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 5000),
      });
      if (!res.ok) {
        // The status alone: the body of an auth failure is not worth the risk of echoing.
        this.opts.warn?.(`google usage ${owner}: HTTP ${res.status}`);
        return null;
      }
      return parseQuotaSummary(await res.json());
    } catch (e) {
      this.opts.warn?.(`google usage ${owner}: ${(e as Error).message}`);
      return null;
    }
  }
}
