import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { DEFAULTS, normalizeSettings } from '../../packages/mod/hooks/settings.ts'
import type { ModelScore, WorkerCandidate, WorkerVerdict } from '../../packages/mod/types/index.d.ts'
registerHooks({ resolve(specifier, context, next) {
  const source = context.parentURL?.includes('/packages/mod/hooks/')
  return next(source && /^\.\.?\//.test(specifier) && !/\.[a-z]+$/.test(specifier) ? `${specifier}.ts` : specifier, context)
} })
const { WORKER_JUDGE_SYSTEM, workerJudgeInput, parseWorkerVerdict, readMarker, agentProvider, chatgptUsable,
  resolveWorker, resolvedRule, calibratedEffort, routerModelOptions, workerCandidates, zenJev, scoreModels, spawnModel, takesOver, claudeCandidates, allowed, withClaude } = await import('../../packages/mod/hooks/workers.ts')
const candidates: WorkerCandidate[] = [
  { target: { agent: 'deepseek-v4-1-flash' }, model: 'deepseek-v4.1-flash', provider: 'deepseek' },
  { target: { agent: 'gpt-6-1-sol' }, model: 'gpt-6.1-sol', provider: 'chatgpt' },
  { target: { agent: 'gpt-6-astra' }, model: 'gpt-6-astra', provider: 'chatgpt' },
  { target: { agent: 'claude-sonnet-5-5' }, model: 'claude-sonnet-5-5', provider: 'zen' },
]
const scores: ModelScore[] = candidates.map((c, i) => ({ model: c.model, provider: c.provider, variants: [{ effort: ['max', 'high', 'medium', 'high'][i] as 'max' | 'high' | 'medium', intelligence: [39.46, 50.24, 49.6, 46.8][i]!, costPerTask: [0.2652, 0.3191, 1.541, 0.884][i]! }] }))
const verdict: WorkerVerdict = { domain: 'backend', level: 'standard', effort: 'medium', why: 'implementation' }
const auto = normalizeSettings({ rules: { general: { mode: 'auto', allow: [] } } })
const pick = (s = DEFAULTS, v = verdict, data = scores, workers = candidates, usable = true) => resolveWorker(v, s, workers, data, usable)

test('judge separates domain and level, rejects mixed-tier legacy verdicts', () => {
  assert.match(WORKER_JUDGE_SYSTEM, /independent/)
  assert.equal(workerJudgeInput({ description: 'Review', prompt: 'x'.repeat(3000) + 'discard' }).includes('discard'), false)
  assert.match(WORKER_JUDGE_SYSTEM, /"kind":"plan\|do"/)
  assert.deepEqual(parseWorkerVerdict('```json\n{"domain":"design","level":"deep","effort":"high","sure":0.9,"why":"taste"}\n```'), { domain: 'design', level: 'deep', kind: 'do', effort: 'high', sure: 0.9, why: 'taste' })
  assert.equal(parseWorkerVerdict('{"domain":"backend","level":"deep","kind":"plan","effort":"high","sure":0.8,"why":"billing design"}')?.kind, 'plan')
  assert.equal(parseWorkerVerdict('{"domain":"backend","level":"deep","kind":"ponder","effort":"high"}')?.kind, 'do')
  for (const text of ['', '{}', '{"tier":"design","effort":"high"}', '{"domain":"bad","level":"light","effort":"low"}']) assert.equal(parseWorkerVerdict(text), undefined)
})
test('markers and frontmatter provider retain existing parsing semantics', () => {
  assert.deepEqual(readMarker('context\n[[ ripple : GPT-6.1-SOL @ HIGH ]]'), { name: 'gpt-6.1-sol', level: 'high' })
  assert.equal(agentProvider('---\ndescription: Executor via chatgpt.\n---\n'), 'chatgpt')
  assert.equal(agentProvider('description: via chatgpt.'), undefined)
})
test('account readiness and all windows decide availability; unknown is not exhaustion', () => {
  const status = (accounts: unknown[]) => ({ chatgpt: { accounts: { chatgpt: accounts } } })
  const ready = { state: 'ready', paused: false, needsReauth: false }
  assert.equal(chatgptUsable(status([ready])), true)
  assert.equal(chatgptUsable(status([])), false)
  for (const account of [{ ...ready, paused: true }, { ...ready, needsReauth: true }, { ...ready, quota: { rate_limits: { secondary: { used_percent: 100 } } } }]) assert.equal(chatgptUsable(status([account])), false)
  assert.equal(chatgptUsable({}), true)
})
test('router catalogue includes every declared model, including Anthropic and nongenerated Jev', () => {
  const config = { providers: { anthropic: { models: [{ id: 'claude-sonnet-5-5' }] }, 'opencode-zen': { models: [{ id: 'jev-1.13' }, { id: 'un-generated' }], headers: { authorization: 'Bearer exact' } } } }
  assert.deepEqual(routerModelOptions(config).map(m => m.label), ['claude-sonnet-5-5 · anthropic', 'jev-1.13 · opencode-zen', 'un-generated · opencode-zen'])
  assert.deepEqual(zenJev(config), { authorization: 'Bearer exact', model: 'jev-1.13' })
  assert.deepEqual(zenJev({}), { model: 'jev-latest' })
  const files = new Map([['sol', '---\ndescription: Execute via chatgpt.\nmodel: gpt-6.1-sol@high\n---\n'], ['missing', '---\nmodel: missing\n---\n']])
  assert.deepEqual(workerCandidates(files, [{ value: 'gpt-6.1-sol', provider: 'chatgpt', label: 'Sol' }]), [{ target: { agent: 'sol' }, model: 'gpt-6.1-sol', provider: 'chatgpt' }])
})
test('inherit resolves general, design defaults are level-dependent and pinned targets climb missing levels', () => {
  assert.deepEqual(resolvedRule('backend', DEFAULTS), DEFAULTS.rules.general)
  assert.equal(pick().target?.agent, 'gpt-6-1-sol')
  assert.equal(pick(DEFAULTS, { ...verdict, domain: 'design', level: 'deep' }).target?.model, 'opus')
  assert.equal(pick(DEFAULTS, { ...verdict, level: 'light' }, [], candidates.slice(1)).target?.agent, 'gpt-6-1-sol')
})
test('quota/off never chooses the blocked provider: the ladder moves up, then to the session model', () => {
  // Standard (Sol) and the rung above (Astra) are both ChatGPT: out of quota, the session model runs.
  const out = pick(DEFAULTS, verdict, [], candidates, false)
  assert.deepEqual(out.target, { agent: 'general-purpose' })
  assert.equal(out.effort, 'medium')
  assert.match(out.fallbackReason ?? '', /ChatGPT/)
  // Light (DeepSeek) switched off moves up to Standard, never down.
  const off = normalizeSettings({ providers: { deepseek: false } })
  const up = pick(off, { ...verdict, level: 'light' })
  assert.equal(up.target?.agent, 'gpt-6-1-sol')
  assert.equal(up.rung, 'standard')
  assert.equal(up.effort, 'medium')
  assert.match(up.fallbackReason ?? '', /deepseek is switched off/)
})
test('calibration offsets are steps; floor wins inverted ceiling', () => {
  assert.equal(calibratedEffort('medium', { effortOffset: 2 }), 'xhigh')
  assert.equal(calibratedEffort('low', { effortOffset: -2, floor: 'high', ceiling: 'medium' }), 'high')
  const s = normalizeSettings({ rules: { backend: { mode: 'pin', targets: { standard: { agent: 'gpt-6-1-sol' } }, effortOffset: 1, ceiling: 'high' } } })
  assert.equal(pick(s).effort, 'high')
})
test('auto chooses Sol high over expensive Astra medium and deep floor 50 still selects Sol', () => {
  const result = pick(auto)
  assert.equal(result.target?.agent, 'gpt-6-1-sol'); assert.equal(result.effort, 'high')
  assert.deepEqual(result.aa, { intelligence: 50.24, costPerTask: 0.3191 })
  assert.equal(result.runnerUp?.target.agent, 'claude-sonnet-5-5')
  assert.equal(pick(auto, { ...verdict, level: 'deep' }).target?.agent, 'gpt-6-1-sol')
})
test('auto preferences win only within both index and cost tie boundaries', () => {
  const data = scores.map(s => ({ ...s, variants: s.model === 'gpt-6-astra' ? [{ effort: 'medium' as const, intelligence: 49.6, costPerTask: 0.35 }] : s.variants }))
  const s = normalizeSettings({ ...auto, preference: ['gpt-6-astra'] })
  assert.equal(pick(s, verdict, data).target?.agent, 'gpt-6-astra')
  assert.equal(pick(s).target?.agent, 'gpt-6-1-sol')
  assert.equal(pick({ ...s, autoTieBand: 0.1 }, verdict, data).target?.agent, 'gpt-6-1-sol')
  assert.equal(pick(s, { ...verdict, level: 'deep' }, data).target?.agent, 'gpt-6-1-sol')
})
test('auto allow/provider/quota filters, strongest fallback, and no-data general pin fallback', () => {
  const s = normalizeSettings({ rules: { backend: { mode: 'auto', allow: ['deepseek'] } } })
  assert.equal(pick(s).target?.agent, 'deepseek-v4-1-flash')
  assert.match(pick(s).fallbackReason ?? '', /strongest/)
  assert.equal(pick({ ...auto, providers: { chatgpt: false } }).target?.agent, 'claude-sonnet-5-5')
  assert.equal(pick(auto, verdict, scores, candidates, false).target?.agent, 'claude-sonnet-5-5')
  assert.equal(pick(auto, verdict, []).target?.agent, 'gpt-6-1-sol')
  assert.match(pick(auto, verdict, []).fallbackReason ?? '', /No usable AA data/)
  assert.equal(resolveWorker(verdict, auto, [], [], true, 'en', candidates).target?.agent, 'gpt-6-1-sol')
})
test('auto calibration filters measured efforts rather than falsifying the score of a rewritten effort', () => {
  const s = normalizeSettings({ rules: { general: { mode: 'auto', allow: [], floor: 'high', ceiling: 'high' } } })
  assert.equal(pick(s).effort, 'high')
  assert.equal(pick(s).runnerUp?.effort, 'high')
  assert.deepEqual(scoreModels({ models: [{ model: 'x', provider: 'y', variants: [{ effort: 'high', intelligence: NaN, costPerTask: 1 }] }] })[0]?.variants, [])
})
test('auto offsets constrain measured efforts and no-data fallback preserves rule calibration/allow', () => {
  const up = normalizeSettings({ rules: { general: { mode: 'auto', allow: [], effortOffset: 1 } } })
  assert.equal(pick(up).effort, 'high')
  const down = normalizeSettings({ rules: { general: { mode: 'auto', allow: [], effortOffset: -1 } } })
  assert.equal(pick(down).effort, 'low') // no low measurements: general pin, calibrated for this rule
  const allow = normalizeSettings({ rules: { backend: { mode: 'auto', allow: ['deepseek'], floor: 'max' } } })
  const noData = pick(allow, verdict, [])
  assert.equal(noData.target?.agent, 'deepseek-v4-1-flash')
  assert.equal(noData.effort, 'max')
  // A model of a switched-off provider named on Claude's own agent does not run either.
  const pinnedModel = normalizeSettings({ providers: { chatgpt: false }, rules: { backend: { mode: 'pin', targets: { standard: { agent: 'general-purpose', model: 'gpt-6.1-sol' } } } } })
  assert.deepEqual(pick(pinnedModel).target, { agent: 'general-purpose' })
})

test('worker strings come from the translated tables and interpolate', async () => {
  const { t, STRINGS } = await import('../../packages/mod/hooks/i18n.ts')
  assert.equal(t('en', 'workers.autoLine', { floor: 50 }), 'cheapest above index 50 · Data: Artificial Analysis (artificialanalysis.ai)')
  assert.equal(t('ko', 'workers.autoLine', { floor: 50 }), STRINGS.ko['workers.autoLine'].replace('{floor}', '50'))
  assert.notEqual(t('ko', 'workers.autoLine', { floor: 50 }), t('en', 'workers.autoLine', { floor: 50 }))
})

test('spawn suffix and takeover retain named-worker and fork boundaries', () => {
  assert.equal(spawnModel({ agent: 'sol' }, 'max', 'gpt-6.1-sol@medium'), 'gpt-6.1-sol@max')
  assert.equal(spawnModel({ agent: 'general-purpose', model: 'sonnet' }, 'high'), 'sonnet')
  assert.equal(takesOver({ subagentType: 'ripple:auto', fork: false }, DEFAULTS), true)
  assert.equal(takesOver({ subagentType: 'ripple:auto', fork: true }, DEFAULTS), false)
  assert.equal(takesOver({ subagentType: 'general-purpose', fork: false }, { ...DEFAULTS, agentAuto: 'all' }), true)
  assert.equal(takesOver({ subagentType: 'general-purpose', model: 'sonnet', fork: false }, { ...DEFAULTS, agentAuto: 'all' }), false)
})

test('allow-lists pick by worker agent, so one model from two providers is told apart; provider names still match', async () => {
  const { allowed, shownVariant, workerAgents, workerOptions } = await import('../../packages/mod/hooks/workers.ts')
  const twins: WorkerCandidate[] = [
    { target: { agent: 'deepseek-flash' }, model: 'deepseek-v4.1-flash', provider: 'deepseek' },
    { target: { agent: 'deepseek-v4-1-flash' }, model: 'deepseek-v4.1-flash', provider: 'opencode-go' },
    ...candidates.slice(1),
  ]
  const data: ModelScore[] = [...scores, { model: 'deepseek-v4.1-flash', provider: 'opencode-go', variants: [{ effort: 'max', intelligence: 39.46, costPerTask: 0.2652 }] }]
  const light = { ...verdict, level: 'light' as const }
  const go = normalizeSettings({ rules: { general: { mode: 'auto', allow: ['deepseek-v4-1-flash', 'gpt-6-1-sol'] } } })
  assert.equal(pick(go, light, data, twins).target?.agent, 'deepseek-v4-1-flash')
  const direct = normalizeSettings({ rules: { general: { mode: 'auto', allow: ['deepseek-flash'] } } })
  assert.equal(pick(direct, light, data, twins).target?.agent, 'deepseek-flash')
  assert.equal(allowed(twins[1]!, ['opencode-go']), true)
  assert.equal(allowed(twins[0]!, ['opencode-go']), false)
  assert.equal(allowed(twins[0]!, []), true)
  assert.deepEqual(workerAgents({ agents: [{ name: 'a', model: 'm', provider: 'p' }, { name: 'b', model: 3, provider: 'p' }, null] }), [{ name: 'a', model: 'm', provider: 'p' }])
  const variants: ModelScore = { model: 'm', provider: 'p', variants: [{ effort: 'low', intelligence: 40, costPerTask: 0.1 }, { effort: 'high', intelligence: 50, costPerTask: 0.4 }, { effort: 'medium', intelligence: 46, costPerTask: 0.2 }] }
  assert.deepEqual(shownVariant(variants, 45), { effort: 'medium', intelligence: 46, costPerTask: 0.2 })
  assert.deepEqual(shownVariant(variants, 60), { effort: 'high', intelligence: 50, costPerTask: 0.4 })
  assert.equal(shownVariant(undefined, 45), undefined)
  assert.deepEqual(workerOptions([{ name: 'a', model: 'm', provider: 'p' }, { name: 'b', model: 'm', provider: 'q' }], [variants], 45), [{ name: 'a', model: 'm', provider: 'p', aa: { effort: 'medium', intelligence: 46, costPerTask: 0.2 } }, { name: 'b', model: 'm', provider: 'q' }])
})

test('Auto over Claude only picks the cheapest Claude model and effort above the floor, as general-purpose', () => {
  // AA variants as GET /api/mod-options gave them on 2026-10-10 (rounded).
  const claude: ModelScore[] = [
    { model: 'claude-haiku-5-5', provider: 'anthropic', variants: [{ effort: 'low', intelligence: 29.45, costPerTask: 0.0245 }, { effort: 'medium', intelligence: 34.46, costPerTask: 0.047 }, { effort: 'max', intelligence: 43.4, costPerTask: 0.2128 }] },
    { model: 'claude-sonnet-5-5', provider: 'anthropic', variants: [{ effort: 'medium', intelligence: 46.2, costPerTask: 0.61 }, { effort: 'high', intelligence: 48.1, costPerTask: 0.884 }] },
    { model: 'claude-opus-5-5', provider: 'anthropic', variants: [{ effort: 'high', intelligence: 53.1, costPerTask: 2.9 }] },
  ]
  const onlyClaude = claudeCandidates().map(c => c.target.model).map(m => 'general-purpose:' + m)
  const s = normalizeSettings({ rules: { general: DEFAULTS.rules.general, design: { mode: 'auto', allow: onlyClaude } } })
  const all = [...candidates, ...claudeCandidates()]
  const design = (level: WorkerVerdict['level']) => resolveWorker({ domain: 'design', level, effort: 'high', why: 'taste' }, s, all, [...scores, ...claude], true)
  // Light floor 20: Haiku low (29.45) qualifies; at the old 30 it fell to medium.
  assert.deepEqual(design('light'), { target: { agent: 'general-purpose', model: 'haiku' }, effort: 'low', aa: { intelligence: 29.45, costPerTask: 0.0245 }, runnerUp: { target: { agent: 'general-purpose', model: 'haiku' }, effort: 'medium', intelligence: 34.46, costPerTask: 0.047 } })
  assert.deepEqual(design('standard').target, { agent: 'general-purpose', model: 'sonnet' })
  assert.equal(design('standard').effort, 'medium')
  assert.deepEqual(design('deep').target, { agent: 'general-purpose', model: 'opus' })
  // Spawned as Claude's own agent on the model; its effort is set per step.
  assert.equal(spawnModel({ agent: 'general-purpose', model: 'sonnet' }, 'medium'), 'sonnet')
  assert.equal(allowed(claudeCandidates()[1]!, ['general-purpose:sonnet']), true)
  assert.equal(allowed(claudeCandidates()[1]!, ['gpt-6-1-sol']), false)
  assert.deepEqual(withClaude([]).map(w => w.name), ['general-purpose:haiku', 'general-purpose:sonnet', 'general-purpose:opus'])
})
