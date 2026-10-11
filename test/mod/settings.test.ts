import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CLAUDE_WORKERS, DEFAULTS, applySettingsChanges, candidateKey, exceptionDomains, foldExceptions, normalizeSettings, providerAllowed, sameRule, settingsChanges, toggleProvider } from '../../packages/mod/hooks/settings.ts'

test('defaults use independent domain rules, two axes and measured floors', () => {
  assert.equal(DEFAULTS.judge, 'haiku')
  assert.equal(DEFAULTS.jevSource, 'typesafe')
  assert.deepEqual(DEFAULTS.autoFloors, { light: 20, standard: 45, deep: 50 })
  assert.equal(DEFAULTS.autoTieBand, 2)
  assert.deepEqual(DEFAULTS.rules.general, { mode: 'pin', targets: { light: { agent: 'deepseek-v4-1-flash' }, standard: { agent: 'gpt-6-1-sol' }, deep: { agent: 'gpt-6-astra' } } })
  assert.deepEqual(DEFAULTS.rules.backend, { mode: 'inherit' })
  assert.equal(DEFAULTS.rules.design.mode, 'pin')
  if (DEFAULTS.rules.design.mode === 'pin') assert.equal(DEFAULTS.rules.design.targets.deep?.model, 'opus')
  assert.equal(Object.hasOwn(DEFAULTS, 'tiers'), false)
})
test('rebasing settings preserves remote siblings and deletes only locally removed fields', () => {
  const before = normalizeSettings({ providers: { old: true }, fallback: { agent: 'general-purpose', model: 'sonnet' }, rules: { backend: { mode: 'auto', allow: ['old'], floor: 'high' } } })
  const after = normalizeSettings({ ...before, providers: { local: false }, fallback: { agent: 'custom' }, rules: { ...before.rules, backend: { mode: 'auto', allow: ['local'] } } })
  const remote = normalizeSettings({ ...before, language: 'ja', providers: { ...before.providers, remote: false }, rules: { ...before.rules, backend: { mode: 'auto', allow: ['remote'], floor: 'high', ceiling: 'max' }, docs: { mode: 'auto', allow: ['remote'] } } })
  const rebased = applySettingsChanges(remote, settingsChanges(before, after))
  assert.deepEqual(rebased.providers, { local: false, remote: false })
  assert.deepEqual(rebased.rules.backend, { mode: 'auto', allow: ['local'], ceiling: 'max' })
  assert.deepEqual(rebased.rules.docs, remote.rules.docs)
  assert.deepEqual(rebased.fallback, after.fallback)
  assert.equal(rebased.language, 'ja')
  assert.deepEqual(remote.providers, { old: true, remote: false })
})
test('a changed rule mode replaces the discriminated rule and an unchanged draft changes nothing', () => {
  const before = normalizeSettings({ rules: { backend: { mode: 'pin', targets: { light: { agent: 'old' } }, floor: 'high' } } })
  const after = normalizeSettings({ ...before, rules: { ...before.rules, backend: { mode: 'auto', allow: ['new'] } } })
  assert.deepEqual(applySettingsChanges(before, settingsChanges(before, after)).rules.backend, after.rules.backend)
  assert.deepEqual(settingsChanges(before, normalizeSettings(before)), [])
})
test('language accepts only auto and the six supported choices', () => {
  for (const language of ['auto', 'ko', 'en', 'zh', 'ja', 'es', 'pt']) assert.equal(normalizeSettings({ language }).language, language)
  for (const language of [undefined, null, '', 'Korean', 'ko_KR', 'fr', true, 1]) assert.equal(normalizeSettings({ language }).language, 'auto')
})
test('defaults are deeply independent after normalization', () => {
  for (const value of [undefined, null, false, 'bad', 7, [], {}]) assert.deepEqual(normalizeSettings(value), DEFAULTS)
  const first = normalizeSettings(null)
  first.hide.push('timer'); first.preference.push('chatgpt'); first.providers.chatgpt = false
  if (first.rules.general.mode === 'pin') first.rules.general.targets.light!.agent = 'changed'
  if (first.rules.design.mode === 'pin') first.rules.design.targets.light!.model = 'changed'
  first.autoFloors.deep = 99; first.fallback.agent = 'changed'
  assert.deepEqual(normalizeSettings(null), DEFAULTS)
})
test('old tiers migrate general and design once, explicit new rules win', () => {
  const migrated = normalizeSettings({ tiers: { light: { agent: ' custom ' }, design: { agent: 'general-purpose', model: 'haiku' } } })
  assert.equal(Object.hasOwn(migrated, 'tiers'), false)
  assert.equal(migrated.rules.general.mode, 'pin')
  if (migrated.rules.general.mode === 'pin') assert.equal(migrated.rules.general.targets.light!.agent, 'custom')
  assert.deepEqual(migrated.rules.design, { mode: 'pin', targets: { light: { agent: 'general-purpose', model: 'haiku' }, standard: { agent: 'general-purpose', model: 'haiku' }, deep: { agent: 'general-purpose', model: 'haiku' } } })
  const current = normalizeSettings({ ...migrated, tiers: { light: { agent: 'obsolete' } } })
  assert.deepEqual(current, migrated)
})
test('rules and extras validate without coercion, invalid general inherit becomes default', () => {
  const s = normalizeSettings({ jevSource: 'zen', rules: { general: { mode: 'inherit' }, backend: { mode: 'auto', allow: ['chatgpt', 'chatgpt', ' deepseek ', 1], effortOffset: 2, floor: 'high', ceiling: 'low' }, docs: { mode: 'pin', targets: { light: { agent: 'worker' }, standard: { agent: 2 } }, effortOffset: '2' } }, providers: { chatgpt: false, deepseek: 'false' }, preference: ['gpt-6.1-sol', 'chatgpt', 'chatgpt', null], autoFloors: { light: 0, standard: -1, deep: 53 }, autoTieBand: 0 })
  assert.equal(s.jevSource, 'zen')
  assert.deepEqual(s.rules.general, DEFAULTS.rules.general)
  assert.deepEqual(s.rules.backend, { mode: 'auto', allow: ['chatgpt', 'deepseek'], effortOffset: 2, floor: 'high', ceiling: 'low' })
  assert.deepEqual(s.rules.docs, { mode: 'pin', targets: { light: { agent: 'worker' } } })
  assert.deepEqual(s.providers, { chatgpt: false })
  assert.deepEqual(s.preference, ['gpt-6.1-sol', 'chatgpt'])
  assert.deepEqual(s.autoFloors, { light: 0, standard: 45, deep: 53 })
  assert.equal(s.autoTieBand, 0)
})
test('unrelated valid settings survive and invalid values retain defaults', () => {
  const s = normalizeSettings({ effortAuto: false, judge: 'jev', judgeModel: ' custom ', bias: 2, floor: 'max', ceiling: 'low', agentAuto: 'all', keepWarmHours: 8, handoffSkill: ' /handoff ', hide: ['route', 'bogus', 'timer', 'route', 4], fallback: { agent: 'custom', model: ' opus ' } })
  assert.equal(s.effortAuto, false); assert.equal(s.judgeModel, 'custom'); assert.equal(s.handoffSkill, 'handoff')
  assert.deepEqual(s.hide, ['route', 'timer']); assert.deepEqual(s.fallback, { agent: 'custom', model: 'opus' })
  assert.deepEqual(normalizeSettings({ bias: '2', jevSource: 'bad', rules: [], providers: [], autoTieBand: -1 }), DEFAULTS)
  for (const n of [-1, NaN, Infinity]) assert.equal(normalizeSettings({ autoTieBand: n }).autoTieBand, 2)
  for (const n of [-1, 101, NaN, Infinity]) assert.equal(normalizeSettings({ swampAt: n }).swampAt, 50)
})
test('Auto allow-lists name workers; provider names from old settings migrate to that provider\'s workers', async () => {
  const { allowedWorkers, migrateAllow, toggleAllow } = await import('../../packages/mod/hooks/settings.ts')
  const workers = [
    { name: 'deepseek-flash', provider: 'deepseek' },
    { name: 'deepseek-v4-1-flash', provider: 'opencode-go' },
    { name: 'glm-5-3-flash', provider: 'opencode-go' },
    { name: 'gpt-6-1-sol', provider: 'chatgpt' },
  ]
  assert.deepEqual(migrateAllow(['opencode-go', 'gpt-6-1-sol', 'gone-worker'], workers), ['deepseek-v4-1-flash', 'glm-5-3-flash', 'gpt-6-1-sol', 'gone-worker'])
  const old = { rules: { general: { mode: 'auto', allow: ['chatgpt'] }, backend: { mode: 'auto', allow: ['opencode-go'], floor: 'high' } } }
  assert.deepEqual(normalizeSettings(old).rules.backend, { mode: 'auto', allow: ['opencode-go'], floor: 'high' })
  const migrated = normalizeSettings(old, workers)
  assert.deepEqual(migrated.rules.general, { mode: 'auto', allow: ['gpt-6-1-sol'] })
  assert.deepEqual(migrated.rules.backend, { mode: 'auto', allow: ['deepseek-v4-1-flash', 'glm-5-3-flash'], floor: 'high' })
  assert.deepEqual(normalizeSettings(migrated, workers), migrated)
  assert.deepEqual(allowedWorkers([], workers), workers.map(w => w.name))
  assert.deepEqual(allowedWorkers(['opencode-go'], workers), ['deepseek-v4-1-flash', 'glm-5-3-flash'])
  // [] is everything; switching one off lists the rest, all on again is [], the last one stays on.
  assert.deepEqual(toggleAllow([], 'deepseek-flash', workers), ['deepseek-v4-1-flash', 'glm-5-3-flash', 'gpt-6-1-sol'])
  assert.deepEqual(toggleAllow(['deepseek-v4-1-flash', 'glm-5-3-flash', 'gpt-6-1-sol'], 'deepseek-flash', workers), [])
  assert.deepEqual(toggleAllow(['gpt-6-1-sol'], 'gpt-6-1-sol', workers), ['gpt-6-1-sol'])
  assert.deepEqual(toggleAllow(['opencode-go'], 'glm-5-3-flash', workers), ['deepseek-v4-1-flash'])
})

// The router's seven workers (GET /api/mod-options, 2026-10-10) and Claude's own models.
const LISTED = [
  { name: 'deepseek-flash', provider: 'deepseek' }, { name: 'deepseek-v4-1-flash', provider: 'opencode-go' },
  { name: 'gemini-3-8-flash', provider: 'google-gemini' }, { name: 'glm-5-3-flash', provider: 'opencode-go' },
  { name: 'gpt-6-1-sol', provider: 'chatgpt' }, { name: 'gpt-6-astra', provider: 'chatgpt' }, { name: 'gpt-6-luna', provider: 'chatgpt' },
  ...CLAUDE_WORKERS.map(w => ({ name: w.name, provider: w.provider })),
]

test('Claude models are candidates keyed general-purpose:<model>', () => {
  assert.deepEqual(CLAUDE_WORKERS.map(w => w.name), ['general-purpose:haiku', 'general-purpose:sonnet', 'general-purpose:opus'])
  assert.deepEqual(CLAUDE_WORKERS.map(w => w.model), ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'])
  for (const w of CLAUDE_WORKERS) assert.equal(candidateKey(w.target), w.name)
  assert.equal(candidateKey({ agent: 'gpt-6-1-sol' }), 'gpt-6-1-sol')
})

test('a provider switch sets all its candidates; some on reads mixed', () => {
  assert.equal(providerAllowed([], 'anthropic', LISTED), true)
  // Design → Auto → only Anthropic: every other provider off, anthropic on.
  let allow: string[] = []
  for (const provider of ['deepseek', 'opencode-go', 'google-gemini', 'chatgpt']) allow = toggleProvider(allow, provider, LISTED)
  assert.deepEqual(allow, ['general-purpose:haiku', 'general-purpose:sonnet', 'general-purpose:opus'])
  assert.equal(providerAllowed(allow, 'anthropic', LISTED), true)
  assert.equal(providerAllowed(allow, 'chatgpt', LISTED), false)
  // The last provider on cannot go off.
  assert.deepEqual(toggleProvider(allow, 'anthropic', LISTED), allow)
  const some = ['gpt-6-1-sol', 'general-purpose:sonnet']
  assert.equal(providerAllowed(some, 'chatgpt', LISTED), 'mixed')
  assert.deepEqual(toggleProvider(some, 'chatgpt', LISTED), ['gpt-6-1-sol', 'gpt-6-astra', 'gpt-6-luna', 'general-purpose:sonnet'])
  // All on again is stored as [].
  assert.deepEqual(toggleProvider(LISTED.filter(w => w.provider !== 'chatgpt').map(w => w.name), 'chatgpt', LISTED), [])
})

test('a field rule equal to the main choice is no exception and saves as inherit', () => {
  // The router's settings of 2026-10-10 (revision 3): frontend pinned exactly as the main choice.
  const general = { mode: 'pin', targets: { light: { agent: 'deepseek-v4-1-flash' }, standard: { agent: 'gpt-6-1-sol' }, deep: { agent: 'gpt-6-astra' } } }
  const s = normalizeSettings({ rules: { general, design: DEFAULTS.rules.design, frontend: { ...general, targets: { deep: general.targets.deep, light: general.targets.light, standard: general.targets.standard } } } })
  assert.equal(sameRule(s.rules.frontend, s.rules.general), true)
  assert.deepEqual(exceptionDomains(s), ['design'])
  const saved = foldExceptions(s)
  assert.deepEqual(saved.rules.frontend, { mode: 'inherit' })
  assert.equal(saved.rules.design.mode, 'pin')
  assert.equal(sameRule({ mode: 'auto', allow: ['b', 'a'] }, { mode: 'auto', allow: ['a', 'b'] }), true)
  assert.equal(sameRule({ mode: 'auto', allow: [] }, { mode: 'auto', allow: [], floor: 'high' }), false)
})

test('the heavy-context band and optional chips are off unless switched on', () => {
  assert.equal(DEFAULTS.swampAlert, false)
  assert.deepEqual(DEFAULTS.extras, [])
  assert.equal(normalizeSettings({ swampAt: 50 }).swampAlert, false)
  assert.deepEqual(normalizeSettings({ swampAlert: true, extras: ['context', 'bogus', 'context'] }), { ...DEFAULTS, swampAlert: true, extras: ['context'] })
})
