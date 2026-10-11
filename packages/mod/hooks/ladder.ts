// The worker ladder (docs/specs/2026-10-11-worker-ladder.md): which rung a verdict lands on, and
// the presets that fill the four rungs from what is connected. Pure, with type-only imports, so the
// router can compute the same presets for its dashboard.

import type { Billing, Effort, LadderChoice, Preset, PresetId, Rung, Step, WorkerVerdict } from '../types/index.d.ts'
import { CLAUDE_WORKERS, EFFORTS, LEVEL_RUNG, RUNGS } from './settings.ts'

/** Below this the judge is unsure enough that a task takes the next rung. */
export const SURE_ENOUGH = 0.5

/**
 * Light, standard and deep land on Light, Standard and Hard; a plan at standard or deep goes to
 * Plan. An unsure verdict moves up one rung (Light → Standard → Hard); Plan and Hard stay.
 */
export function rungOf(verdict: Pick<WorkerVerdict, 'level' | 'kind' | 'sure'>): Rung {
  if (verdict.kind === 'plan' && verdict.level !== 'light') return 'plan'
  const rung = LEVEL_RUNG[verdict.level]
  if (verdict.sure === undefined || !(verdict.sure < SURE_ENOUGH)) return rung
  return rung === 'light' ? 'standard' : rung === 'standard' ? 'hard' : rung
}

/** The rung above, none above Plan. */
export function rungAbove(rung: Rung): Rung | undefined {
  return RUNGS[RUNGS.indexOf(rung) + 1]
}

/**
 * The nearest effort a model takes, as the router clamps one (compat.ts clampEffort): ties go up,
 * an unknown ladder keeps the effort.
 */
export function nearestEffort(effort: Effort, ladder: readonly string[]): Effort {
  const known = ladder.filter((value): value is Effort => EFFORTS.includes(value as Effort))
  if (!known.length || known.includes(effort)) return effort
  const at = EFFORTS.indexOf(effort)
  return known.reduce((best, next) => {
    const d = Math.abs(EFFORTS.indexOf(next) - at)
    const bd = Math.abs(EFFORTS.indexOf(best) - at)
    return d < bd || (d === bd && EFFORTS.indexOf(next) > EFFORTS.indexOf(best)) ? next : best
  })
}

/** How a provider is paid for, from its configuration (type, auth, preset, address). */
export function billingOf(provider: { type?: string; auth?: string; preset?: string; url?: string }, model?: string): Billing {
  if (model && /(?::|-)free$/i.test(model)) return 'free'
  if (provider.type === 'chatgpt') return 'subscription'
  if (provider.type === 'anthropic') return provider.auth === 'api-key' ? 'payg' : 'subscription'
  if (provider.type === 'google') return provider.auth === 'antigravity' ? 'subscription' : 'payg'
  if (provider.preset === 'opencode-go') return 'subscription'
  if (provider.preset === 'ollama' || provider.preset === 'lmstudio') return 'free'
  // A named hosted service is paid for wherever it is reached through; only a hand-entered local server is free.
  if (provider.preset) return 'payg'
  if (provider.url) {
    try {
      const host = new URL(provider.url).hostname
      if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost')) return 'free'
    } catch { /* not an address: paid like any other API */ }
  }
  return 'payg'
}

/** A family's newest model: gpt-6.1-sol over gpt-6-sol. */
function newest(choices: readonly LadderChoice[], family: RegExp): LadderChoice | undefined {
  const version = (model: string): number[] => (/(\d+(?:[.-]\d+)*)/.exec(model)?.[1] ?? '0').split(/[.-]/).map(Number)
  const later = (a: number[], b: number[]): number => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (b[i] ?? 0) - (a[i] ?? 0); if (d) return d } return 0 }
  return choices.filter(c => family.test(c.model) && !c.target.model).sort((a, b) => later(version(a.model), version(b.model)) || a.model.localeCompare(b.model))[0]
}

/** The cheapest model paid by the token or free: free first, then by measured cost; unmeasured last. */
export function cheapest(choices: readonly LadderChoice[]): LadderChoice | undefined {
  const cost = (c: LadderChoice): number => c.billing === 'free' ? 0 : c.cost ?? Number.POSITIVE_INFINITY
  return choices.filter(c => (c.billing === 'payg' || c.billing === 'free') && !c.target.model)
    .sort((a, b) => cost(a) - cost(b) || a.model.localeCompare(b.model))[0]
}

type Want = { pick: (choices: readonly LadderChoice[]) => LadderChoice | undefined; effort: Effort }

const claudeModel = (alias: string) => (choices: readonly LadderChoice[]) => choices.find(c => c.target.agent === 'general-purpose' && c.target.model === alias)
const family = (pattern: RegExp) => (choices: readonly LadderChoice[]) => newest(choices, pattern)
const LUNA = family(/\bluna\b/i)
const SOL = family(/\bsol\b/i)
const ASTRA = family(/\bastra\b/i)
const HAIKU = claudeModel('haiku')
const SONNET = claudeModel('sonnet')
const OPUS = claudeModel('opus')

/**
 * Each preset rung's wishes in order: the first is what the preset names, the rest what stands in
 * when it is not connected (the nearest choice, a GPT model's Claude counterpart).
 */
const PRESETS: Readonly<Record<PresetId, Readonly<Record<Rung, readonly Want[]>>>> = {
  claude: {
    light: [{ pick: HAIKU, effort: 'low' }], standard: [{ pick: SONNET, effort: 'medium' }],
    hard: [{ pick: OPUS, effort: 'high' }], plan: [{ pick: OPUS, effort: 'high' }],
  },
  claudeGpt: {
    light: [{ pick: cheapest, effort: 'max' }, { pick: LUNA, effort: 'low' }, { pick: HAIKU, effort: 'low' }],
    standard: [{ pick: SOL, effort: 'medium' }, { pick: SONNET, effort: 'medium' }],
    hard: [{ pick: ASTRA, effort: 'high' }, { pick: OPUS, effort: 'high' }],
    plan: [{ pick: OPUS, effort: 'high' }],
  },
  gpt: {
    light: [{ pick: LUNA, effort: 'low' }, { pick: HAIKU, effort: 'low' }],
    standard: [{ pick: SOL, effort: 'medium' }, { pick: SONNET, effort: 'medium' }],
    hard: [{ pick: ASTRA, effort: 'high' }, { pick: OPUS, effort: 'high' }],
    plan: [{ pick: ASTRA, effort: 'xhigh' }, { pick: OPUS, effort: 'high' }],
  },
  cheap: {
    light: [{ pick: cheapest, effort: 'high' }, { pick: LUNA, effort: 'low' }, { pick: HAIKU, effort: 'low' }],
    standard: [{ pick: cheapest, effort: 'max' }, { pick: LUNA, effort: 'medium' }, { pick: HAIKU, effort: 'medium' }],
    hard: [{ pick: cheapest, effort: 'max' }, { pick: LUNA, effort: 'high' }, { pick: SONNET, effort: 'medium' }],
    plan: [{ pick: SONNET, effort: 'high' }],
  },
}
export const PRESET_IDS: readonly PresetId[] = ['claude', 'claudeGpt', 'gpt', 'cheap']

/** Claude's own models as rung choices: always there, since the session itself runs on Claude. */
export function claudeChoices(efforts: readonly string[]): LadderChoice[] {
  const ladder = efforts.filter((e): e is Effort => EFFORTS.includes(e as Effort))
  return CLAUDE_WORKERS.map(w => ({ target: { ...w.target }, model: w.model, provider: w.provider, billing: 'subscription' as const, efforts: ladder }))
}

/**
 * A preset filled from the connected, ticked models: each rung takes its first wish that is there,
 * at that wish's effort moved to the nearest the model takes. A rung that had to take a later
 * wish is listed in `substituted`, so the screens can mark it.
 */
export function preset(id: PresetId, choices: readonly LadderChoice[]): Preset {
  const rungs = {} as Record<Rung, Step>
  const substituted: Rung[] = []
  for (const rung of RUNGS) {
    const wants = PRESETS[id][rung]
    let filled = false
    for (const [at, want] of wants.entries()) {
      const choice = want.pick(choices)
      if (!choice) continue
      rungs[rung] = { target: { ...choice.target }, effort: nearestEffort(want.effort, choice.efforts) }
      if (at > 0) substituted.push(rung)
      filled = true
      break
    }
    // Claude is always there, so only a choice list without it lands here: the session model.
    if (!filled) { rungs[rung] = { target: { agent: 'general-purpose' }, effort: wants[0]!.effort }; substituted.push(rung) }
  }
  return { rungs, substituted }
}

export function presets(choices: readonly LadderChoice[]): Record<PresetId, Preset> {
  return Object.fromEntries(PRESET_IDS.map(id => [id, preset(id, choices)])) as Record<PresetId, Preset>
}
