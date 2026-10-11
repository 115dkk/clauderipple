import type { Calibration, Domain, Effort, Level, Rule, Settings, SettingsChange, TierTarget } from '../types/index.d.ts'

export const DOMAINS: readonly Domain[] = ['general', 'design', 'frontend', 'backend', 'infra', 'data', 'test', 'docs', 'research']
export const LEVELS: readonly Level[] = ['light', 'standard', 'deep']
export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

export const DEFAULTS: Settings = {
  effortAuto: true, judge: 'haiku', judgeModel: 'deepseek-v4.1-flash', jevSource: 'typesafe',
  bias: 0, floor: 'low', ceiling: 'max', agentAuto: 'auto',
  rules: {
    general: { mode: 'pin', targets: { light: { agent: 'deepseek-v4-1-flash' }, standard: { agent: 'gpt-6-1-sol' }, deep: { agent: 'gpt-6-astra' } } },
    design: { mode: 'pin', targets: { light: { agent: 'general-purpose', model: 'sonnet' }, standard: { agent: 'general-purpose', model: 'sonnet' }, deep: { agent: 'general-purpose', model: 'opus' } } },
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
function rule(raw: unknown, fallback: Rule, general = false): Rule {
  const v = object(raw)
  if (v.mode === 'inherit' && !general) return { mode: 'inherit' }
  if (v.mode === 'auto') return { mode: 'auto', allow: names(v.allow), ...calibration(v) }
  const source = v.mode === 'pin' ? object(v.targets) : fallback.mode === 'pin' ? fallback.targets : null
  if (!source) return fallback.mode === 'auto' ? { ...fallback, allow: [...fallback.allow] } : { mode: 'inherit' }
  const targets: Partial<Record<Level, TierTarget>> = {}
  for (const level of LEVELS) { const parsed = target(source[level]); if (parsed) targets[level] = parsed }
  return { mode: 'pin', targets, ...calibration(v.mode === 'pin' ? v : fallback) }
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
  const keys = ['mode', 'targets', 'allow', 'effortOffset', 'floor', 'ceiling', 'light', 'standard', 'deep', 'agent', 'model']
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

/**
 * Persisted settings may be old; migrate tiers once and never alias nested default data. With
 * `workers`, provider names in Auto allow-lists become those providers' workers.
 */
export function normalizeSettings(raw: unknown, workers?: readonly Worker[]): Settings {
  const value = object(raw)
  const rules = Object.fromEntries(DOMAINS.map(domain => [domain, rule(object(value.rules)[domain], DEFAULTS.rules[domain], domain === 'general')])) as Record<Domain, Rule>
  if (workers?.length) for (const domain of DOMAINS) { const r = rules[domain]; if (r.mode === 'auto' && r.allow.length) r.allow = migrateAllow(r.allow, workers) }
  const old = object(value.tiers)
  if (!Object.hasOwn(object(value.rules), 'general') && Object.keys(old).length) {
    const defaults = DEFAULTS.rules.general
    const targets = defaults.mode === 'pin' ? { ...defaults.targets } : {}
    for (const level of LEVELS) { const parsed = target(old[level]); if (parsed) targets[level] = parsed }
    rules.general = rule({ mode: 'pin', targets }, DEFAULTS.rules.general, true)
  }
  if (!Object.hasOwn(object(value.rules), 'design') && old.design) {
    const parsed = target(old.design)
    if (parsed) rules.design = rule({ mode: 'pin', targets: { light: parsed, standard: parsed, deep: parsed } }, DEFAULTS.rules.design)
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
