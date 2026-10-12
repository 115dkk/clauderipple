// Operating modes in the session (docs/specs/2026-10-12-worker-tiers.md "Operating modes"): which
// mode is on, when it ends by itself, and the eager-delegation note. Pure; register.tsx wires them.
// The rungs a mode runs on are ladder.ts `modeRungs`, which the router can use as well.

import type { Mode, Settings, TierTarget } from '../types'
import { candidateKey } from './settings'

/** The mode that is on, if the settings name one that exists. */
export function activeModeOf(s: Pick<Settings, 'modes' | 'activeMode'>): Mode | undefined {
  return s.activeMode ? s.modes.find(m => m.id === s.activeMode) : undefined
}

/** One turning-on of a mode: the same mode turned off and on again is a new one. */
export function modeKey(s: Pick<Settings, 'activeMode' | 'activeSince'>): string | null {
  return s.activeMode ? `${s.activeMode}@${s.activeSince ?? 0}` : null
}

/** What the main chat reads beside the prompt while an eager mode is on. */
export function modeNote(name: string): string {
  return `ClaudeRipple mode ${name}: delegate everything except judgment and final review to ripple:low/medium/high/max.`
}

/**
 * The eager note for this prompt: sent on the first prompt after the mode turned on, and again on
 * the first after a compaction (which clears `noted`), never on the turns between.
 */
export function eagerNote(s: Pick<Settings, 'modes' | 'activeMode' | 'activeSince'>, noted: string | null): { note?: string; noted: string | null } {
  const mode = activeModeOf(s)
  const key = modeKey(s)
  if (!mode || mode.delegation !== 'eager') return { noted }
  return noted === key ? { noted } : { note: modeNote(mode.name), noted: key }
}

/**
 * The providers a mode's targets name: a model key stands for its provider (from `models`), any
 * other target is a provider's name.
 */
export function modeProviders(targets: readonly string[], models: readonly { target: TierTarget; provider: string }[]): string[] {
  return [...new Set(targets.map(name => models.find(m => candidateKey(m.target) === name)?.provider ?? name))]
}

/** One account's quota window: when it resets next, and how long it is when known. */
export type QuotaWindow = { at: number; windowMs?: number }

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/**
 * Each signed-in, unpaused ChatGPT account's longest window (weekly when there is one), from GET
 * /api/chatgpt-accounts: `quota.rate_limits.{primary,secondary}` with `reset_at` (epoch seconds,
 * or ms) or `reset_after_seconds` from the snapshot's `at`, and `window_minutes`
 * (packages/router/src/providers/chatgpt/index.ts rateLimitsFromHeaders/rateLimitsFromUsage).
 * An account whose reset is unknown is left out.
 */
export function quotaWindows(body: unknown): QuotaWindow[] {
  const accounts = record(body).accounts
  if (!Array.isArray(accounts)) return []
  return accounts.flatMap(value => {
    const account = record(value)
    if (account.state === 'paused' || account.state === 'needs-login') return []
    const quota = record(account.quota)
    const limits = record(quota.rate_limits)
    const secondary = record(limits.secondary)
    const window = Object.keys(secondary).length ? secondary : record(limits.primary)
    const resetAt = typeof window.reset_at === 'number' ? (window.reset_at > 1e12 ? window.reset_at : window.reset_at * 1000)
      : typeof window.reset_after_seconds === 'number' && typeof quota.at === 'number' ? quota.at + window.reset_after_seconds * 1000 : undefined
    if (resetAt === undefined || !Number.isFinite(resetAt)) return []
    const minutes = window.window_minutes
    return [{ at: resetAt, ...(typeof minutes === 'number' && minutes > 0 ? { windowMs: minutes * 60_000 } : {}) }]
  })
}

/**
 * Whether a mode's time is up. A time: once it has come. The quota reset: once every account's
 * window has reset since the mode turned on (`since`), read from its next reset and, when the
 * window's length is known, the reset that started it. Unknown resets never end a mode.
 */
export function modeOver(mode: Pick<Mode, 'until'>, since: number | undefined, now: number, windows: readonly QuotaWindow[] = []): boolean {
  if (typeof mode.until === 'number') return now >= mode.until
  if (mode.until !== 'reset' || since === undefined || !windows.length) return false
  const passed = (at: number) => at > since && at <= now
  return windows.every(w => passed(w.at) || (w.windowMs !== undefined && passed(w.at - w.windowMs)))
}
