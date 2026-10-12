// The four workers (docs/specs/2026-10-12-worker-tiers.md): which rung a verdict lands on, and the
// fill that gives every rung a model from the ticked, connected ones. Pure, with type-only imports,
// so the router fills settings with the same rule the mod uses.

import type { Billing, Effort, LadderChoice, Preset, PresetId, Rung, Step, TierTarget, WorkerVerdict } from '../types/index.d.ts'
import { CLAUDE_WORKERS, EFFORTS, LEVEL_RUNG, RUNGS, RUNG_EFFORT, candidateKey, isAllowed } from './settings.ts'

/** Below this the judge is unsure enough that a task takes the next rung. */
export const SURE_ENOUGH = 0.5

/**
 * Light, standard and deep land on Low, Medium and High, regardless of kind.
 * An unsure verdict moves up one rung (Low → Medium → High); High stays.
 * The Plan rung (Max worker) is selected explicitly, never by the judge.
 */
export function rungOf(verdict: Pick<WorkerVerdict, 'level' | 'kind' | 'sure'>): Rung {
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
 * The fill rule's wishes (a preset's, by name; only `claudeGpt` is used): each rung's in order: the first is what the preset names, the rest what stands in
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

/** Claude's own models as rung choices: always there, since the session itself runs on Claude. */
export function claudeChoices(efforts: readonly string[]): LadderChoice[] {
  const ladder = efforts.filter((e): e is Effort => EFFORTS.includes(e as Effort))
  return CLAUDE_WORKERS.map(w => ({ target: { ...w.target }, model: w.model, provider: w.provider, billing: 'subscription' as const, efforts: ladder }))
}

/**
 * A preset's rule applied to the connected, ticked models: each rung takes its first wish that is
 * there, at that wish's effort moved to the nearest the model takes. A rung that had to take a
 * later wish is listed in `substituted`.
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

// ---- Operating modes (docs/specs/2026-10-12-worker-tiers.md "Operating modes") -----------------

/** A model as a mode names it: by its provider, or by its key as `allow` stores it. */
type Named = { target: TierTarget; provider: string }

/** Whether a mode's targets name this model: its provider or its key. */
export function inTargets(targets: readonly string[], model: Named): boolean {
  return targets.includes(model.provider) || targets.includes(candidateKey(model.target))
}

/**
 * What a mode puts on each rung, in order: the fill rule's own wishes (the `claudeGpt` rule on Low,
 * Medium and High, the `gpt` rule's Astra-then-Opus on Max, the strongest of each family).
 */
const MODE_WANTS: Readonly<Record<Rung, readonly Want[]>> = {
  light: PRESETS.claudeGpt.light, standard: PRESETS.claudeGpt.standard, hard: PRESETS.claudeGpt.hard, plan: PRESETS.gpt.plan,
}

/**
 * When none of the wishes is among `pool`: the cheapest by measured cost on Low and Medium, the
 * dearest (the AA cost of a harder thinker) on High and Max; unmeasured models after measured ones.
 */
function byCost(rung: Rung, pool: readonly LadderChoice[]): LadderChoice | undefined {
  const top = rung === 'hard' || rung === 'plan'
  const measured = pool.filter(c => c.cost !== undefined).sort((a, b) => (top ? b.cost! - a.cost! : a.cost! - b.cost!) || a.model.localeCompare(b.model))
  return measured[0] ?? pool[0]
}

/**
 * The model a mode puts on a rung from `pool`, at the wish's effort, else the rung's own default
 * (low, medium, high, high: another model's effort means nothing to this one), as the model takes it.
 */
function modePick(rung: Rung, pool: readonly LadderChoice[]): Step | undefined {
  for (const want of MODE_WANTS[rung]) {
    const choice = want.pick(pool)
    if (choice) return { target: { ...choice.target }, effort: nearestEffort(want.effort, choice.efforts) }
  }
  const choice = byCost(rung, pool)
  return choice ? { target: { ...choice.target }, effort: nearestEffort(RUNG_EFFORT[rung], choice.efforts) } : undefined
}

/**
 * The rungs an active mode runs on, from the user's own (`rungs`, as filled) and the ticked models
 * that can run now (`choices`). Prefer: a rung whose model is not a target and that the targets can
 * serve takes the target's model (strongest on High and Max, cheapest on Low; `MODE_WANTS`); a rung
 * already on a target, or where the targets have nothing, stays. Avoid: a rung on a target is filled
 * the same way from the other models, and left to the session's model when none is left. `known`
 * names the provider of models that cannot run now (so they are still recognised as a target).
 * `changed` lists the rungs this moved.
 */
export function modeRungs(rungs: Partial<Record<Rung, Step>>, mode: { targets: readonly string[]; action: 'prefer' | 'avoid' }, choices: readonly LadderChoice[], known: readonly Named[] = []): { rungs: Partial<Record<Rung, Step>>; changed: Rung[] } {
  const named = (step: Step): boolean => {
    const key = candidateKey(step.target)
    const model = choices.find(c => candidateKey(c.target) === key) ?? known.find(c => candidateKey(c.target) === key)
    return model ? inTargets(mode.targets, model) : mode.targets.includes(key)
  }
  const targets = choices.filter(c => inTargets(mode.targets, c))
  const others = choices.filter(c => !inTargets(mode.targets, c))
  const out: Partial<Record<Rung, Step>> = {}
  const changed: Rung[] = []
  for (const rung of RUNGS) {
    const own = rungs[rung]
    let next = own
    if (mode.action === 'prefer' && targets.length && !(own && named(own))) next = modePick(rung, targets)
    if (mode.action === 'avoid' && own && named(own)) next = modePick(rung, others) ?? { target: { agent: 'general-purpose' }, effort: own.effort }
    if (next) out[rung] = next
    if (next !== own) changed.push(rung)
  }
  return { rungs: out, changed }
}

/** The choices a person ticked; an empty list ticks every one. */
export function tickedChoices(choices: readonly LadderChoice[], allow: readonly string[]): LadderChoice[] {
  return choices.filter(choice => isAllowed(candidateKey(choice.target), choice.provider, allow))
}

/** Whether a rung's model is ticked: the session model always is, since the session runs on it. */
function rungTicked(step: Step, allow: readonly string[], provider: string): boolean {
  return (step.target.agent === 'general-purpose' && !step.target.model) || isAllowed(candidateKey(step.target), provider, allow)
}

/** Whether any rung has no model or one that is not ticked: a cheap test before the choices are fetched. */
export function ladderNeedsFill(rungs: Partial<Record<Rung, Step>>, allow: readonly string[]): boolean {
  return RUNGS.some(rung => !rungs[rung] || !rungTicked(rungs[rung]!, allow, ''))
}

/**
 * The general ladder with every rung that has no model, or whose model is not ticked, filled by the
 * `claudeGpt` rule from the ticked, connected `choices`. A rung that has a ticked model is left as
 * it is (whether or not it can run now: the router says so when it cannot). `filled` names the
 * rungs this changed.
 */
export function fillLadder(rungs: Partial<Record<Rung, Step>>, allow: readonly string[], choices: readonly LadderChoice[]): { rungs: Record<Rung, Step>; filled: Rung[] } {
  const pick = preset('claudeGpt', tickedChoices(choices, allow))
  const out = {} as Record<Rung, Step>
  const filled: Rung[] = []
  for (const rung of RUNGS) {
    const own = rungs[rung]
    if (own && rungTicked(own, allow, choices.find(c => candidateKey(c.target) === candidateKey(own.target))?.provider ?? '')) { out[rung] = own; continue }
    out[rung] = pick.rungs[rung]
    filled.push(rung)
  }
  return { rungs: out, filled }
}
