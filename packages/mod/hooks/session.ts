import type { SessionContextUsage, SessionRateLimit } from 'claude-code'
import type { CacheMemo, Hot } from '../types'

export function hottest(rateLimits: readonly SessionRateLimit[]): Hot | null {
  const eligible = rateLimits.filter(limit => ['five_hour', 'seven_day'].includes(limit.kind) && limit.percentUsed >= 80)
  const limit = eligible.reduce<SessionRateLimit | undefined>((hot, next) => !hot || next.percentUsed > hot.percentUsed ? next : hot, undefined)
  return limit ? { kind: limit.kind, percent: limit.percentUsed, ...(limit.resetsAt ? { resetsAt: limit.resetsAt } : {}) } : null
}

const WINDOW_KIND: Record<number, string> = { 300: 'five_hour', 10080: 'seven_day' }
/** A router snapshot older than this is not shown as the plan's figure. */
export const CLAUDE_USAGE_STALE_MS = 15 * 60_000

/**
 * The plan windows of the Claude login this session's requests pass through, from the router's
 * GET /api/status (`claude.accounts[id=current].quota`, packages/router/src/admin.ts
 * claudeAccountUsage): for when the host leaves `rateLimits` empty though the requests carry them
 * (measured 2026-10-14: the router passes the `anthropic-ratelimit-unified-*` headers through).
 * Percent as the router reports it; a stale or unknown snapshot gives nothing.
 */
export function claudeLimitsFrom(status: unknown, now: number): SessionRateLimit[] {
  const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
  const accounts = object(object(status).claude).accounts
  const current = Array.isArray(accounts) ? accounts.map(object).find(a => a.id === 'current') : undefined
  const quota = object(current?.quota)
  if (typeof quota.at !== 'number' || now - quota.at > CLAUDE_USAGE_STALE_MS) return []
  const limits = object(quota.rate_limits)
  return [limits.primary, limits.secondary].map(object).flatMap(w => {
    const kind = typeof w.window_minutes === 'number' ? WINDOW_KIND[w.window_minutes] : undefined
    if (!kind || typeof w.used_percent !== 'number' || !Number.isFinite(w.used_percent)) return []
    const reset = typeof w.reset_at === 'number' ? w.reset_at * (w.reset_at < 1e12 ? 1000 : 1) : NaN
    return [{ kind, percentUsed: Math.round(w.used_percent * 10) / 10, ...(Number.isFinite(reset) ? { resetsAt: new Date(reset).toISOString() } : {}) }]
  })
}

/**
 * The reset is read in the person's own clock: `offsetMinutes` is `Date#getTimezoneOffset` (minutes
 * behind UTC), passed in so tests do not depend on the machine's zone.
 */
export function limitLabel(hot: Hot, now: number, offsetMinutes = new Date(now).getTimezoneOffset()): string {
  const label = `${hot.kind === 'five_hour' ? '5h' : 'weekly'} ${Math.round(hot.percent)}%`
  const reset = hot.resetsAt ? Date.parse(hot.resetsAt) : NaN
  if (!Number.isFinite(reset)) return label
  const date = new Date(reset - offsetMinutes * 60000)
  const time = `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getUTCDay()]
  return `${label} · resets ${reset - now < 20 * 3600000 ? time : `${day} ${time}`}`
}

export function saveUntil(hot: Hot | null, now: number): number {
  const reset = hot?.resetsAt ? Date.parse(hot.resetsAt) : NaN
  return Number.isFinite(reset) && reset > now ? reset : now + 5 * 3600000
}

/** The context percent when it is at or past `swampAt`, else null. */
export function swamped(context: SessionContextUsage | null, swampAt: number): number | null {
  if (!context || context.tokens === undefined) return null
  const percent = context.percent ?? (context.window > 0 ? context.tokens / context.window * 100 : undefined)
  return percent !== undefined && percent >= swampAt ? percent : null
}

export function coldAlert(memo: CacheMemo | null, contextTokens: number, now: number, hidden: boolean): boolean {
  return !hidden && memo !== null && memo.expiresAt <= now && contextTokens >= 150000
}

/**
 * Keep-warm held the cache while the person was away: at least one ping read cache tokens and the
 * memo says the cache is still warm. Once it has expired the cold card is the truth, never this.
 */
export function keptAlert(kept: { pings: number; tokens: number } | null, memo: CacheMemo | null, now: number): boolean {
  return kept !== null && kept.pings > 0 && memo !== null && memo.expiresAt > now
}

export function hotAlert(hot: Hot | null, hidden: number | null): boolean {
  return hot !== null && hot.percent >= 80 && (hidden === null || hot.percent >= hidden + 10)
}

/**
 * The heavy-context band shows once per crossing: seen (or put off) at `hidden` percent, it waits
 * until the context grows SWAMP_STEP points more. A hidden value over 100 is a token count kept by
 * an older mod and is ignored.
 */
export const SWAMP_STEP = 15
export function swampAlert(percent: number | null, hidden: number | null): boolean {
  return percent !== null && (hidden === null || hidden > 100 || percent >= hidden + SWAMP_STEP)
}

/** Rendering consumes eligibility, keeping dismissal and idle decisions outside drawing code. */
export function bandPriority(state: {
  panel?: 'settings' | 'compact' | 'clear' | 'handoff' | 'setup' | null
  judgeDown?: boolean; hot?: boolean; result?: boolean; cold?: boolean; swamp?: boolean; kept?: boolean
}): 'settings' | 'compact' | 'clear' | 'handoff' | 'setup' | 'judgeDown' | 'hot' | 'result' | 'cold' | 'swamp' | 'kept' | 'dashboard' {
  if (state.panel) return state.panel
  for (const band of ['judgeDown', 'hot', 'result', 'cold', 'swamp', 'kept'] as const) if (state[band]) return band
  return 'dashboard'
}
