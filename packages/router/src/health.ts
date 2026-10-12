// Self-healing: a long-lived process whose resolver or socket layer has gone bad
// stays bad (observed: 10h of ENOTFOUND, 11 remote-control workers lost). After N
// consecutive upstream *connect-level* failures with no success in between, exit
// with a distinctive code so the supervisor restarts a fresh process.

export type ProviderExhaustion = {
  reason: "insufficient_balance" | "billing_exhausted" | "quota_exhausted";
  at: number;
  until: number;
};

/** Only definite billing/quota exhaustion, never a bare rate limit or RESOURCE_EXHAUSTED.
 * 402 is already `exhausted` in pool.ts; Codex's usage_limit_reached is named in
 * providers/chatgpt/translate.ts. Other vendors share the explicit billing vocabulary.
 * Reasons are codes, not upstream prose (which can contain credentials).
 */
export function providerExhaustion(status: number, body = "", retryMs?: number, now = Date.now()): ProviderExhaustion | undefined {
  if (status !== 402 && status !== 429) return undefined;
  const balance = /\b(?:insufficient[_ -]+(?:balance|credits?|funds)|(?:balance|credits?)[_ -]+(?:insufficient|exhausted|depleted))\b/i.test(body);
  const billing = /\bbilling[_ -]+(?:hard[_ -]+)?(?:limit|exhausted|quota)|\b(?:exhausted|exceeded|insufficient)[_ -]+billing\b/i.test(body);
  const quota = /\b(?:insufficient_quota|usage_limit_reached|quota[_ -]+exhausted|exhausted[_ -]+quota)\b/i.test(body);
  if (status !== 402 && !balance && !billing && !quota) return undefined;
  const reason = balance ? "insufficient_balance" : billing || status === 402 ? "billing_exhausted" : "quota_exhausted";
  const wait = retryMs !== undefined && Number.isFinite(retryMs) && retryMs > 0 ? retryMs : 30 * 60_000;
  return { reason, at: now, until: now + wait };
}

/** Per router instance, advisory only: manual traffic can prove a topped-up provider healthy. */
export class ProviderHealth {
  private readonly exhausted = new Map<string, ProviderExhaustion>();

  observe(provider: string, status: number, exhaustion?: ProviderExhaustion): void {
    if (exhaustion) this.exhausted.set(provider, exhaustion);
    else if (status >= 200 && status < 300) this.exhausted.delete(provider);
  }

  snapshot(now = Date.now()): Record<string, ProviderExhaustion> {
    for (const [name, value] of this.exhausted) if (value.until <= now) this.exhausted.delete(name);
    return Object.fromEntries(this.exhausted);
  }
}

export const EXIT_UPSTREAM_UNREACHABLE = 75;

const CONNECT_ERRORS = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "EAI_FAIL",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENETDOWN",
]);

export function isConnectError(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "string" && CONNECT_ERRORS.has(code);
}

export class UpstreamHealth {
  private consecutive = 0;
  private tripped = false;
  private readonly limit: () => number;
  private readonly onTrip: (n: number) => void;

  constructor(limit: () => number, onTrip: (n: number) => void) {
    this.limit = limit;
    this.onTrip = onTrip;
  }

  success(): void {
    this.consecutive = 0;
  }

  failure(e: unknown): void {
    if (!isConnectError(e)) return;
    this.consecutive++;
    if (!this.tripped && this.consecutive >= this.limit()) {
      this.tripped = true;
      this.onTrip(this.consecutive);
    }
  }

  get consecutiveFailures(): number {
    return this.consecutive;
  }
}
