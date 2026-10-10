import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULTS, applySettingsChanges, normalizeSettings, settingsChanges } from '../../packages/mod/hooks/settings.ts'

test('defaults use independent domain rules, two axes and measured floors', () => {
  assert.equal(DEFAULTS.judge, 'haiku')
  assert.equal(DEFAULTS.jevSource, 'typesafe')
  assert.deepEqual(DEFAULTS.autoFloors, { light: 30, standard: 45, deep: 50 })
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
