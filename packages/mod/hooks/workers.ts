import type { AaScore, Calibration, Domain, Effort, Level, ModelScore, RouterModel, Rule, Settings, TierTarget, WorkerAgent, WorkerCandidate, WorkerOption, WorkerVerdict } from '../types'
import { CLAUDE_WORKERS, DEFAULTS, DOMAINS, EFFORTS, LEVELS, candidateKey } from './settings'
import { MARKER, agentModel } from './worker'
import { t } from './i18n'
import type { Lang } from './i18n'
import { bounded, parseEffortVerdict, verdictObject } from './judge'

export const WORKER_JUDGE_SYSTEM = `Choose a domain, capability level and the cheapest effort that still does this delegated task well. Evaluate actual scope and risk, not prompt length.
Domains: design (visual taste, composition, brand), frontend (UI implementation), backend (APIs and server logic), infra (deployment and operations), data (queries and processing), test (verification), docs (writing), research (investigation), general (other or cross-domain).
Levels are independent of domain: light (chores, mechanical work, simple lookups), standard (designed implementation, ordinary research and review), deep (careful high-stakes reasoning, subtle bugs, architecture, security).
Effort choices are low, medium, high, xhigh, max; reserve the last two for exceptionally hard work. Return only JSON {"domain":"design|frontend|backend|infra|data|test|docs|research|general","level":"light|standard|deep","effort":"low|medium|high|xhigh|max","sure":0.0,"why":"brief reason"}. Confidence is zero to one; explain in the user's language in at most six words.`

export function workerJudgeInput(input: { description: string; prompt: string }): string {
  return `Task: ${input.description}\n\nInstructions:\n${input.prompt.slice(0, 3000)}`
}
export function parseWorkerVerdict(text: string): WorkerVerdict | undefined {
  const verdict = parseEffortVerdict(text)
  const raw = verdictObject(text)
  if (!verdict || !DOMAINS.includes(raw?.domain as Domain) || !LEVELS.includes(raw?.level as Level)) return undefined
  return { ...verdict, domain: raw!.domain as Domain, level: raw!.level as Level }
}
export function readMarker(prompt: string): { name: string; level?: string } | null {
  const marker = MARKER.exec(prompt)
  return marker ? { name: marker[1]!.toLowerCase(), ...(marker[2] ? { level: marker[2].toLowerCase() } : {}) } : null
}
export function agentProvider(agentFileText: string): string | undefined {
  const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(agentFileText)?.[1]
  const description = head && /^description:\s*(.*)$/m.exec(head)?.[1]
  return description ? /\bvia\s+([A-Za-z0-9_-]+)\./.exec(description)?.[1]?.toLowerCase() : undefined
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function list(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }
const baseModel = (model: string): string => model.replace(/@[^@]*$/, '')

/** Unknown availability is not exhaustion; known accounts must pass every quota window. */
export function chatgptUsable(status: unknown): boolean {
  const accounts = record(record(record(status).chatgpt).accounts).chatgpt
  if (!Array.isArray(accounts)) return true
  return accounts.some(value => {
    const account = record(value)
    if (account.state !== 'ready' || account.paused || account.needsReauth) return false
    const limits = record(record(account.quota).rate_limits)
    return ['primary', 'secondary'].every(name => {
      const window = record(limits[name])
      return typeof window.used_percent !== 'number' || window.used_percent < 100
    })
  })
}
/** Config is the router's catalogue, including native Anthropic declarations. Never retain headers. */
export function routerModelOptions(config: unknown): RouterModel[] {
  const out: RouterModel[] = []
  for (const [provider, value] of Object.entries(record(record(config).providers))) {
    for (const model of list(record(value).models)) {
      const id = record(model).id
      if (typeof id === 'string' && id) out.push({ value: id, label: `${id} · ${provider}`, provider })
    }
  }
  return out
}
export function zenJev(config: unknown): { authorization?: string; model: string } {
  const provider = record(record(record(config).providers)['opencode-zen'])
  const key = record(provider.headers).authorization
  const model = list(provider.models).map(m => record(m).id).find(id => typeof id === 'string' && id.toLowerCase().includes('jev'))
  return { ...(typeof key === 'string' && key.trim() ? { authorization: key } : {}), model: typeof model === 'string' ? model : 'jev-latest' }
}
/** Validate HTTP score data at the boundary; malformed entries are not selectable measurements. */
export function scoreModels(raw: unknown): ModelScore[] {
  return list(record(raw).models).flatMap(value => {
    const model = record(value)
    if (typeof model.model !== 'string' || typeof model.provider !== 'string') return []
    const variants = list(model.variants).flatMap(v => {
      const variant = record(v)
      if (variant.effort !== null && !EFFORTS.includes(variant.effort as Effort)) return []
      const valid = (n: unknown): n is number | null => n === null || typeof n === 'number' && Number.isFinite(n) && n >= 0
      if (!valid(variant.intelligence) || !valid(variant.costPerTask)) return []
      return [{ effort: variant.effort as Effort | null, intelligence: variant.intelligence, costPerTask: variant.costPerTask }]
    })
    return [{ model: model.model, provider: model.provider, variants }]
  })
}
/** Only generated, readable workers whose exact file model is routable can enter Auto. */
export function workerCandidates(files: ReadonlyMap<string, string>, models: readonly RouterModel[]): WorkerCandidate[] {
  return [...files].flatMap(([agent, file]) => {
    const model = baseModel(agentModel(file) ?? '')
    const provider = agentProvider(file)
    const route = models.find(m => m.value === model && (!provider || m.provider === provider))
    return route ? [{ target: { agent }, model, provider: route.provider }] : []
  })
}
export function resolvedRule(domain: Domain, settings: Settings): Exclude<Rule, { mode: 'inherit' }> {
  const selected = settings.rules[domain]
  const general = settings.rules.general
  return selected.mode !== 'inherit' ? selected : general.mode !== 'inherit' ? general : DEFAULTS.rules.general as Exclude<Rule, { mode: 'inherit' }>
}
export function calibratedEffort(effort: Effort, rule: Calibration): Effort {
  const shifted = EFFORTS[Math.max(0, Math.min(4, EFFORTS.indexOf(effort) + (rule.effortOffset ?? 0)))]!
  return bounded(shifted, rule.floor ?? 'low', rule.ceiling ?? 'max')
}
function rank(candidate: WorkerCandidate, settings: Settings): number {
  const at = settings.preference.findIndex(p => p === candidate.provider || p === candidate.model || p === candidate.target.agent)
  return at < 0 ? Number.MAX_SAFE_INTEGER : at
}
/**
 * Allow-lists name worker agents, and Claude's own models as `general-purpose:<model>`; provider
 * names from settings saved before 2026-10-10 still match.
 */
export function allowed(candidate: WorkerCandidate, allow: readonly string[]): boolean {
  return !allow.length || allow.includes(candidateKey(candidate.target)) || allow.includes(candidate.provider)
}
/** Claude's own models as candidates: general-purpose on each, scored as the model's AA id. */
export function claudeCandidates(): WorkerCandidate[] {
  return CLAUDE_WORKERS.map(w => ({ target: { ...w.target }, model: w.model, provider: w.provider }))
}
/** The router's workers and Claude's own models, as the Workers card lists them. */
export function withClaude(agents: readonly WorkerAgent[]): WorkerAgent[] {
  return [...agents, ...CLAUDE_WORKERS.map(w => ({ name: w.name, model: w.model, provider: w.provider }))]
}
/** The router's generated-worker list (GET /api/mod-options `agents`), validated at the boundary. */
export function workerAgents(raw: unknown): WorkerAgent[] {
  return list(record(raw).agents).flatMap(value => {
    const agent = record(value)
    return typeof agent.name === 'string' && agent.name && typeof agent.model === 'string' && agent.model && typeof agent.provider === 'string' && agent.provider
      ? [{ name: agent.name, model: agent.model, provider: agent.provider }] : []
  })
}
/**
 * The measured variant shown beside a worker: what Auto would use for standard work (the cheapest
 * variant at or above `floor`), else its strongest variant.
 */
export function shownVariant(score: ModelScore | undefined, floor: number): (AaScore & { effort: Effort | null }) | undefined {
  const measured = (score?.variants ?? []).flatMap(v => v.intelligence === null || v.costPerTask === null ? [] : [{ effort: v.effort, intelligence: v.intelligence, costPerTask: v.costPerTask }])
  const qualified = measured.filter(v => v.intelligence >= floor).sort((a, b) => a.costPerTask - b.costPerTask || b.intelligence - a.intelligence)
  return qualified[0] ?? measured.sort((a, b) => b.intelligence - a.intelligence || a.costPerTask - b.costPerTask)[0]
}
export function workerOptions(agents: readonly WorkerAgent[], scores: readonly ModelScore[], floor: number): WorkerOption[] {
  return agents.map(agent => {
    const aa = shownVariant(scores.find(s => s.model === agent.model && s.provider === agent.provider), floor)
    return aa ? { ...agent, aa } : { ...agent }
  })
}
export function candidateUsable(candidate: WorkerCandidate, settings: Settings, chatgpt: boolean): boolean {
  return settings.providers[candidate.provider] !== false && (candidate.provider !== 'chatgpt' || chatgpt)
}
function sameTarget(a: TierTarget, b: TierTarget): boolean { return a.agent === b.agent && a.model === b.model }
function candidateOf(target: TierTarget, candidates: readonly WorkerCandidate[]): WorkerCandidate | undefined {
  return candidates.find(c => sameTarget(c.target, target)) ?? (target.agent === 'general-purpose' ? { target, model: target.model ?? 'sonnet', provider: candidates.find(c => c.model === baseModel(target.model ?? 'sonnet'))?.provider ?? 'anthropic' } : undefined)
}
export type Resolution = { target?: TierTarget; effort: Effort; fallbackReason?: string; aa?: AaScore; runnerUp?: AaScore & { target: TierTarget; effort: Effort } }

/** Pinned level, higher levels for missing files, then preferred quota fallback and the configured fallback. */
function pin(level: Level, effort: Effort, rule: Extract<Rule, { mode: 'pin' }>, settings: Settings, candidates: readonly WorkerCandidate[], chatgpt: boolean, lang: Lang, allow: readonly string[] = []): Resolution {
  let reason: string | undefined
  const usable = (candidate: WorkerCandidate): boolean => candidateUsable(candidate, settings, chatgpt) && allowed(candidate, allow)
  const eligible = candidates.filter(usable)
  for (const next of LEVELS.slice(LEVELS.indexOf(level))) {
    const target = rule.targets[next]
    if (!target) continue
    const candidate = candidateOf(target, candidates)
    if (candidate && usable(candidate)) return { target: { ...target }, effort: calibratedEffort(effort, rule), ...(reason ? { fallbackReason: reason } : {}) }
    reason ??= !candidate ? t(lang, 'toasts.workerMissing', { name: target.agent }) : settings.providers[candidate.provider] === false ? t(lang, 'workers.disabled', { provider: candidate.provider }) : t(lang, 'toasts.providerQuota')
    // Quota/off is not a request to spend on a higher pinned tier. Preference wins fallback only.
    if (candidate) break
  }
  const preferred = eligible.filter(c => rank(c, settings) < Number.MAX_SAFE_INTEGER).sort((a, b) => rank(a, settings) - rank(b, settings))[0]
  const fallback = candidateOf(settings.fallback, candidates)
  const builtin = candidateOf({ agent: 'general-purpose', model: 'sonnet' }, candidates)!
  const selected = preferred ?? (fallback && usable(fallback) ? fallback : usable(builtin) ? builtin : eligible[0])
  return { target: selected ? { ...selected.target } : undefined, effort: calibratedEffort(effort, rule), fallbackReason: reason ?? t(lang, 'workers.none') }
}

/** Cheapest floor-qualified variant; near-tie preferences are measured against the cheapest anchor. */
export function resolveWorker(verdict: WorkerVerdict, settings: Settings, candidates: readonly WorkerCandidate[], scores: readonly ModelScore[], chatgpt: boolean, lang: Lang = 'en', pinnedCandidates: readonly WorkerCandidate[] = candidates): Resolution {
  const rule = resolvedRule(verdict.domain, settings)
  if (rule.mode === 'pin') return pin(verdict.level, verdict.effort, rule, settings, candidates, chatgpt, lang)
  const measured = candidates.filter(c => candidateUsable(c, settings, chatgpt) && allowed(c, rule.allow)).flatMap(candidate => {
    const score = scores.find(s => s.model === candidate.model && s.provider === candidate.provider)
    return (score?.variants ?? []).flatMap(variant => {
      const effort = variant.effort ?? calibratedEffort(verdict.effort, rule)
      if (variant.intelligence === null || variant.costPerTask === null) return []
      const min = EFFORTS.indexOf(rule.floor ?? 'low')
      const max = Math.max(min, EFFORTS.indexOf(rule.ceiling ?? 'max'))
      const index = EFFORTS.indexOf(effort)
      if (index < min || index > max) return []
      const adjusted = EFFORTS.indexOf(calibratedEffort(verdict.effort, rule))
      if ((rule.effortOffset ?? 0) > 0 && index < adjusted || (rule.effortOffset ?? 0) < 0 && index > adjusted) return []
      return [{ ...candidate, effort, intelligence: variant.intelligence, costPerTask: variant.costPerTask }]
    })
  })
  if (!measured.length) {
    const general = settings.rules.general.mode === 'pin' ? settings.rules.general : DEFAULTS.rules.general as Extract<Rule, { mode: 'pin' }>
    const result = pin(verdict.level, verdict.effort, general, settings, pinnedCandidates, chatgpt, lang, rule.allow)
    return { ...result, effort: calibratedEffort(verdict.effort, rule), fallbackReason: result.fallbackReason ?? t(lang, 'workers.noData') }
  }
  const qualified = measured.filter(c => c.intelligence >= settings.autoFloors[verdict.level])
  const byCost = (a: typeof measured[number], b: typeof measured[number]): number => a.costPerTask - b.costPerTask || b.intelligence - a.intelligence || a.model.localeCompare(b.model)
  if (!qualified.length) {
    measured.sort((a, b) => b.intelligence - a.intelligence || byCost(a, b))
    const best = measured[0]!
    const next = measured[1]
    return { target: best.target, effort: best.effort, aa: { intelligence: best.intelligence, costPerTask: best.costPerTask }, ...(next ? { runnerUp: { target: next.target, effort: next.effort, intelligence: next.intelligence, costPerTask: next.costPerTask } } : {}), fallbackReason: t(lang, 'workers.noFloor') }
  }
  qualified.sort(byCost)
  const cheapest = qualified[0]!
  const ties = qualified.filter(c => Math.abs(c.intelligence - cheapest.intelligence) <= settings.autoTieBand && c.costPerTask <= cheapest.costPerTask * 1.25).sort((a, b) => rank(a, settings) - rank(b, settings) || byCost(a, b))
  const best = ties[0]!
  const next = qualified.filter(c => c !== best).sort(byCost)[0]
  return { target: best.target, effort: best.effort, aa: { intelligence: best.intelligence, costPerTask: best.costPerTask }, ...(next ? { runnerUp: { target: next.target, effort: next.effort, intelligence: next.intelligence, costPerTask: next.costPerTask } } : {}) }
}
export function spawnModel(target: TierTarget, effort: Effort, fileModel?: string): string | undefined {
  return fileModel && target.agent !== 'general-purpose' ? `${baseModel(fileModel)}@${effort}` : target.model
}
export function takesOver(spawn: { subagentType: string; model?: string; fork: boolean }, settings: Settings): boolean {
  if (spawn.fork || settings.agentAuto === 'off') return false
  return ['ripple:auto', 'auto'].includes(spawn.subagentType) || (settings.agentAuto === 'all' && spawn.subagentType === 'general-purpose' && spawn.model === undefined)
}
