import type { Calibration, Domain, Effort, Level, Rule, Rung, Settings, SettingsChange, Step, TierTarget } from '../types/index.d.ts'

export const DOMAINS: readonly Domain[] = ['general', 'design', 'frontend', 'backend', 'infra', 'data', 'test', 'docs', 'research']
export const LEVELS: readonly Level[] = ['light', 'standard', 'deep']
export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']
/** The worker ladder, bottom to top (docs/specs/2026-10-11-worker-ladder.md). */
export const RUNGS: readonly Rung[] = ['light', 'standard', 'hard', 'plan']
/** The rung each judged level lands on before kind and confidence move it. */
export const LEVEL_RUNG: Readonly<Record<Level, Rung>> = { light: 'light', standard: 'standard', deep: 'hard' }
/** A rung's effort when nothing else says one: a stored rung without one, a migrated pin. */
export const RUNG_EFFORT: Readonly<Record<Rung, Effort>> = { light: 'low', standard: 'medium', hard: 'high', plan: 'high' }

const claude = (model: string, effort: Effort): Step => ({ target: { agent: 'general-purpose', model }, effort })

export const DEFAULTS: Settings = {
  effortAuto: true, judge: 'haiku', judgeModel: 'deepseek-v4.1-flash', jevSource: 'typesafe',
  bias: 0, floor: 'low', ceiling: 'max', agentAuto: 'auto',
  rules: {
    // The spec's "Claude + GPT" example; a rung whose worker is missing moves up and says so.
    general: { mode: 'ladder', rungs: {
      light: { target: { agent: 'deepseek-v4-1-flash' }, effort: 'max' }, standard: { target: { agent: 'gpt-6-1-sol' }, effort: 'medium' },
      hard: { target: { agent: 'gpt-6-astra' }, effort: 'high' }, plan: claude('opus', 'high'),
    } },
    // AA does not measure taste: design stays on Claude, Sonnet then Opus.
    design: { mode: 'ladder', rungs: { light: claude('sonnet', 'medium'), standard: claude('sonnet', 'high'), hard: claude('opus', 'high'), plan: claude('opus', 'high') } },
    frontend: { mode: 'inherit' }, backend: { mode: 'inherit' }, infra: { mode: 'inherit' }, data: { mode: 'inherit' },
    test: { mode: 'inherit' }, docs: { mode: 'inherit' }, research: { mode: 'inherit' },
  },
  providers: {}, preference: [], autoFloors: { light: 20, standard: 45, deep: 50 }, autoTieBand: 2,
  fallback: { agent: 'general-purpose', model: 'sonnet' },
  keepWarm: false, keepWarmHours: 2, keepWarmMinTokens: 30000,
  compactWith: 'haiku', handoffSkill: '', handoffAfter: 'continue', handoffButton: 'advised',
  swampAt: 50, swampAlert: false, layout: 'dashboard', appearance: 'auto', language: 'auto', hide: ['reason'], extras: [], setupDone: false,
}

/** Band chips that show only when switched on in Look. */
export const EXTRAS: readonly string[] = ['context', 'limits']

/**
 * Claude's own models as Auto candidates: the built-in general-purpose agent run on the model, its
 * AA scores those of the model's current id. The key is what an Auto allow-list stores.
 */
export const CLAUDE_WORKERS: readonly { name: string; model: string; provider: string; target: TierTarget }[] = [
  { name: 'general-purpose:haiku', model: 'claude-haiku-5-5', provider: 'anthropic', target: { agent: 'general-purpose', model: 'haiku' } },
  { name: 'general-purpose:sonnet', model: 'claude-sonnet-5-5', provider: 'anthropic', target: { agent: 'general-purpose', model: 'sonnet' } },
  { name: 'general-purpose:opus', model: 'claude-opus-5-5', provider: 'anthropic', target: { agent: 'general-purpose', model: 'opus' } },
]

/** The allow-list key of a target: the agent's name, or `general-purpose:<model>` for Claude's own. */
export function candidateKey(target: TierTarget): string {
  return target.model ? target.agent + ':' + target.model : target.agent
}

function object(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
}
function names(raw: unknown): string[] {
  return Array.isArray(raw) ? [...new Set(raw.filter((v): v is string => typeof v === 'string' && !!v.trim()).map(v => v.trim()))] : []
}
function target(raw: unknown, fallback?: TierTarget): TierTarget | undefined {
  const value = object(raw)
  const agent = typeof value.agent === 'string' && value.agent.trim() ? value.agent.trim() : fallback?.agent
  const model = typeof value.model === 'string' && value.model.trim() ? value.model.trim() : fallback?.model
  return agent ? { agent, ...(model ? { model } : {}) } : undefined
}
function calibration(value: Record<string, unknown>): Calibration {
  const out: Calibration = {}
  if ([-2, -1, 0, 1, 2].includes(Number(value.effortOffset)) && typeof value.effortOffset === 'number') out.effortOffset = value.effortOffset as NonNullable<Calibration['effortOffset']>
  for (const field of ['floor', 'ceiling'] as const) if (EFFORTS.includes(value[field] as Effort)) out[field] = value[field] as Effort
  return out
}
function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
function sameTarget(a: TierTarget | undefined, b: TierTarget | undefined): boolean {
  return !!a && !!b && a.agent === b.agent && a.model === b.model
}
/** An effort moved by calibration steps, then held between floor and ceiling (the floor wins). */
function calibrated(effort: Effort, cal: Calibration): Effort {
  const min = EFFORTS.indexOf(cal.floor ?? 'low')
  const max = Math.max(min, EFFORTS.indexOf(cal.ceiling ?? 'max'))
  const shifted = Math.max(0, Math.min(4, EFFORTS.indexOf(effort) + (cal.effortOffset ?? 0)))
  return EFFORTS[Math.max(min, Math.min(max, shifted))]!
}
/** One effort step up, max staying max. */
export function effortUp(effort: Effort): Effort {
  return EFFORTS[Math.min(4, EFFORTS.indexOf(effort) + 1)]!
}
function step(raw: unknown, rung: Rung): Step | undefined {
  const v = object(raw)
  const chosen = target(v.target)
  if (!chosen) return undefined
  const backup = target(v.backup)
  return { target: chosen, effort: EFFORTS.includes(v.effort as Effort) ? v.effort as Effort : RUNG_EFFORT[rung], ...(backup ? { backup } : {}) }
}
/** The effort a migrated rung starts at: the default ladder's when it runs the same model there. */
function migratedEffort(domain: Domain, rung: Rung, chosen: TierTarget): Effort {
  for (const source of [DEFAULTS.rules[domain], DEFAULTS.rules.general]) {
    const own = source.mode === 'ladder' ? source.rungs[rung] : undefined
    if (own && sameTarget(own.target, chosen)) return own.effort
  }
  return RUNG_EFFORT[rung]
}
/**
 * A pin stored before 2026-10-11 as a ladder: light/standard/deep become Light/Standard/Hard, a
 * missing level takes the nearest one above (as the pin climbed) or else below, each rung's effort
 * is its default calibrated as the pin was, and Plan is Hard's model one effort higher.
 */
export function ladderFromPin(targets: Partial<Record<Level, TierTarget>>, cal: Calibration, domain: Domain): Rule {
  const known = LEVELS.filter(level => targets[level])
  if (!known.length) return copy(DEFAULTS.rules[domain].mode === 'ladder' ? DEFAULTS.rules[domain] : DEFAULTS.rules.general)
  const rungs: Partial<Record<Rung, Step>> = {}
  LEVELS.forEach((level, at) => {
    const above = LEVELS.slice(at).find(l => targets[l])
    const chosen = targets[above ?? [...LEVELS.slice(0, at)].reverse().find(l => targets[l])!]!
    const rung = LEVEL_RUNG[level]
    rungs[rung] = { target: { ...chosen }, effort: calibrated(migratedEffort(domain, rung, chosen), cal) }
  })
  rungs.plan = { target: { ...rungs.hard!.target }, effort: effortUp(rungs.hard!.effort) }
  return { mode: 'ladder', rungs }
}
function rule(raw: unknown, fallback: Rule, domain: Domain): Rule {
  const v = object(raw)
  if (v.mode === 'inherit' && domain !== 'general') return { mode: 'inherit' }
  if (v.mode === 'auto') return { mode: 'auto', allow: names(v.allow), ...calibration(v) }
  if (v.mode === 'ladder') {
    const source = object(v.rungs)
    const rungs: Partial<Record<Rung, Step>> = {}
    for (const rung of RUNGS) { const parsed = step(source[rung], rung); if (parsed) rungs[rung] = parsed }
    return { mode: 'ladder', rungs }
  }
  if (v.mode === 'pin') {
    const source = object(v.targets)
    const targets: Partial<Record<Level, TierTarget>> = {}
    for (const level of LEVELS) { const parsed = target(source[level]); if (parsed) targets[level] = parsed }
    return ladderFromPin(targets, calibration(v), domain)
  }
  return copy(fallback)
}

type Worker = { name: string; provider: string }

/**
 * Auto's allow-list names worker agents. Settings saved before 2026-10-10 named providers there;
 * with the worker list known, a provider name becomes that provider's workers (names it does not
 * know are kept: a worker may be missing only for now).
 */
export function migrateAllow(allow: readonly string[], workers: readonly Worker[]): string[] {
  const agents = new Set(workers.map(w => w.name))
  return [...new Set(allow.flatMap(entry => agents.has(entry) || !workers.some(w => w.provider === entry) ? [entry] : workers.filter(w => w.provider === entry).map(w => w.name)))]
}

/** The workers switched on by an allow-list; empty means every worker. */
export function allowedWorkers(allow: readonly string[], workers: readonly Worker[]): string[] {
  if (!allow.length) return workers.map(w => w.name)
  const on = new Set(migrateAllow(allow, workers))
  return workers.filter(w => on.has(w.name)).map(w => w.name)
}

/** Switches one worker; every worker on again is stored as [], and the last one cannot go off. */
export function toggleAllow(allow: readonly string[], name: string, workers: readonly Worker[]): string[] {
  const on = allowedWorkers(allow, workers)
  const next = on.includes(name) ? on.filter(n => n !== name) : workers.filter(w => w.name === name || on.includes(w.name)).map(w => w.name)
  if (!next.length) return [...allow]
  return next.length === workers.length ? [] : next
}

/** A provider's switch in Auto's candidate list: all its workers on, none, or some. */
export function providerAllowed(allow: readonly string[], provider: string, workers: readonly Worker[]): boolean | 'mixed' {
  const on = new Set(allowedWorkers(allow, workers))
  const mine = workers.filter(w => w.provider === provider)
  const count = mine.filter(w => on.has(w.name)).length
  return count === 0 ? false : count === mine.length ? true : 'mixed'
}

/**
 * Switches a provider's workers together: on when any of them is off, else off. Keys stay worker
 * keys; every worker on again is stored as [], and the last ones on cannot all go off.
 */
export function toggleProvider(allow: readonly string[], provider: string, workers: readonly Worker[]): string[] {
  const on = new Set(allowedWorkers(allow, workers))
  const mine = workers.filter(w => w.provider === provider).map(w => w.name)
  const turnOn = mine.some(name => !on.has(name))
  for (const name of mine) turnOn ? on.add(name) : on.delete(name)
  const next = workers.filter(w => on.has(w.name)).map(w => w.name)
  if (!next.length) return [...allow]
  return next.length === workers.length ? [] : next
}

/** Two rules that pick the same way: an exception equal to the main choice is no exception. */
export function sameRule(a: Rule, b: Rule): boolean {
  // A fixed key list orders every level alike; an allow-list is a set.
  const keys = ['mode', 'rungs', 'allow', 'effortOffset', 'floor', 'ceiling', ...RUNGS, 'target', 'effort', 'backup', 'agent', 'model']
  const canonical = (r: Rule): string => JSON.stringify(r.mode === 'auto' ? { ...r, allow: [...r.allow].sort() } : r, keys)
  return canonical(a) === canonical(b)
}

/** Exceptions that pick as the main choice does become inherit again: what Save stores. */
export function foldExceptions(settings: Settings): Settings {
  const main = settings.rules.general
  const rules = { ...settings.rules }
  for (const domain of DOMAINS) if (domain !== 'general' && rules[domain].mode !== 'inherit' && sameRule(rules[domain], main)) rules[domain] = { mode: 'inherit' }
  return { ...settings, rules }
}

/** The fields whose rule differs from the main choice. */
export function exceptionDomains(settings: Settings): Domain[] {
  return DOMAINS.filter(domain => domain !== 'general' && settings.rules[domain].mode !== 'inherit' && !sameRule(settings.rules[domain], settings.rules.general))
}

/** The general pin every install had before the ladder: what stored `tiers` filled in. */
const LEGACY_GENERAL: Readonly<Record<Level, TierTarget>> = { light: { agent: 'deepseek-v4-1-flash' }, standard: { agent: 'gpt-6-1-sol' }, deep: { agent: 'gpt-6-astra' } }

/**
 * Persisted settings may be old; migrate tiers and pins once and never alias nested default data.
 * With `workers`, provider names in Auto allow-lists become those providers' workers. Auto stays
 * Auto: nobody's routing changes silently.
 */
export function normalizeSettings(raw: unknown, workers?: readonly Worker[]): Settings {
  const value = object(raw)
  const rules = Object.fromEntries(DOMAINS.map(domain => [domain, rule(object(value.rules)[domain], DEFAULTS.rules[domain], domain)])) as Record<Domain, Rule>
  if (workers?.length) for (const domain of DOMAINS) { const r = rules[domain]; if (r.mode === 'auto' && r.allow.length) r.allow = migrateAllow(r.allow, workers) }
  const old = object(value.tiers)
  if (!Object.hasOwn(object(value.rules), 'general') && Object.keys(old).length) {
    const targets: Partial<Record<Level, TierTarget>> = copy(LEGACY_GENERAL)
    for (const level of LEVELS) { const parsed = target(old[level]); if (parsed) targets[level] = parsed }
    rules.general = ladderFromPin(targets, {}, 'general')
  }
  if (!Object.hasOwn(object(value.rules), 'design') && old.design) {
    const parsed = target(old.design)
    if (parsed) rules.design = ladderFromPin({ light: parsed, standard: parsed, deep: parsed }, {}, 'design')
  }
  const result: Settings = { ...DEFAULTS, rules, providers: {}, preference: names(value.preference), autoFloors: { ...DEFAULTS.autoFloors }, hide: [...DEFAULTS.hide], extras: [...DEFAULTS.extras], fallback: { ...DEFAULTS.fallback } }
  for (const [name, enabled] of Object.entries(object(value.providers))) if (typeof enabled === 'boolean') result.providers[name] = enabled
  for (const level of LEVELS) { const n = object(value.autoFloors)[level]; if (typeof n === 'number' && Number.isFinite(n) && n >= 0) result.autoFloors[level] = n }
  if (typeof value.autoTieBand === 'number' && Number.isFinite(value.autoTieBand) && value.autoTieBand >= 0) result.autoTieBand = value.autoTieBand
  for (const key of ['effortAuto', 'keepWarm', 'setupDone', 'swampAlert'] as const) if (typeof value[key] === 'boolean') result[key] = value[key]
  if (Array.isArray(value.extras)) result.extras = [...new Set(value.extras.filter((part): part is string => typeof part === 'string' && EXTRAS.includes(part)))]
  const choices = {
    judge: ['haiku', 'jev', 'model'], jevSource: ['typesafe', 'zen'], bias: [-2, -1, 0, 1, 2], floor: EFFORTS,
    ceiling: EFFORTS, agentAuto: ['off', 'auto', 'all'], keepWarmHours: [1, 2, 4, 8], compactWith: ['haiku', 'session'],
    handoffAfter: ['continue', 'confirm', 'copy'], handoffButton: ['advised', 'always'], layout: ['dashboard', 'minimal'],
    appearance: ['auto', 'dark', 'light'], language: ['auto', 'ko', 'en', 'zh', 'ja', 'es', 'pt'],
  } as const
  for (const key of Object.keys(choices) as (keyof typeof choices)[]) if ((choices[key] as readonly unknown[]).includes(value[key])) Object.assign(result, { [key]: value[key] })
  if (typeof value.judgeModel === 'string' && value.judgeModel.trim()) result.judgeModel = value.judgeModel.trim()
  if (typeof value.handoffSkill === 'string') result.handoffSkill = value.handoffSkill.trim().replace(/^\//, '')
  if (typeof value.keepWarmMinTokens === 'number' && Number.isFinite(value.keepWarmMinTokens) && value.keepWarmMinTokens >= 0) result.keepWarmMinTokens = value.keepWarmMinTokens
  if (typeof value.swampAt === 'number' && Number.isFinite(value.swampAt) && value.swampAt >= 0 && value.swampAt <= 100) result.swampAt = value.swampAt
  if (Array.isArray(value.hide)) result.hide = [...new Set(value.hide.filter((part): part is string => typeof part === 'string' && ['timer', 'reason', 'route', 'limits'].includes(part)))]
  result.fallback = target(value.fallback, DEFAULTS.fallback)!
  return result
}

/** Preserve unrelated remote edits, including sibling domains and provider switches. */
export function settingsChanges(before: Settings, after: Settings): SettingsChange[] {
  function diff(a: unknown, b: unknown, path: string[]): SettingsChange[] {
    if (JSON.stringify(a) === JSON.stringify(b)) return []
    if (b === undefined) return [{ path, remove: true }]
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      const left = object(a), right = object(b)
      // Changing a discriminated rule replaces it, rather than retaining the old mode's fields.
      if (left.mode === right.mode) return [...new Set([...Object.keys(left), ...Object.keys(right)])].flatMap(key => diff(left[key], right[key], [...path, key]))
    }
    return [{ path, value: b }]
  }
  return diff(before, after, [])
}

export function applySettingsChanges(base: Settings, changes: readonly SettingsChange[]): Settings {
  const result = object(normalizeSettings(base))
  for (const change of changes) {
    let parent = result
    for (const key of change.path.slice(0, -1)) {
      const child = object(parent[key])
      parent[key] = child
      parent = child
    }
    const key = change.path.at(-1)
    if (key === undefined) continue
    if (change.remove) delete parent[key]
    else parent[key] = change.value
  }
  return normalizeSettings(result)
}
