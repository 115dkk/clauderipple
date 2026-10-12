// Operating modes (docs/specs/2026-10-12-worker-tiers.md "Operating modes"): stored modes, the
// rungs a mode moves, when it ends by itself, and the eager note.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { DEFAULTS, applySettingsChanges, normalizeModes, normalizeSettings, settingsChanges } from '../../packages/mod/hooks/settings.ts'
import { claudeChoices, inTargets, modeRungs } from '../../packages/mod/hooks/ladder.ts'
import type { LadderChoice, Rung, Step } from '../../packages/mod/types/index.d.ts'
registerHooks({ resolve(specifier, context, next) {
  const source = context.parentURL?.includes('/packages/mod/hooks/')
  return next(source && /^\.\.?\//.test(specifier) && !/\.[a-z]+$/.test(specifier) ? `${specifier}.ts` : specifier, context)
} })
const { activeModeOf, eagerNote, modeKey, modeNote, modeOver, modeProviders, quotaWindows } = await import('../../packages/mod/hooks/modes.ts')

const gpt = (agent: string, model: string, cost?: number): LadderChoice => ({ target: { agent }, model, provider: 'chatgpt', billing: 'subscription', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], ...(cost !== undefined ? { cost } : {}) })
const LIVE: LadderChoice[] = [
  { target: { agent: 'deepseek-flash' }, model: 'deepseek-flash', provider: 'deepseek', billing: 'payg', efforts: ['low', 'high', 'max'], cost: 0.3 },
  { target: { agent: 'glm-flash' }, model: 'glm-flash', provider: 'zai', billing: 'payg', efforts: [], cost: 0.9 },
  gpt('gpt-6-1-sol', 'gpt-6.1-sol'), gpt('gpt-6-astra', 'gpt-6-astra'), gpt('gpt-6-luna', 'gpt-6-luna'),
  ...claudeChoices(['low', 'medium', 'high', 'max']),
]
const USER: Record<Rung, Step> = (DEFAULTS.rules.general.mode === 'ladder' ? DEFAULTS.rules.general.rungs : {}) as Record<Rung, Step>
const opus = { agent: 'general-purpose', model: 'opus' }, sonnet = { agent: 'general-purpose', model: 'sonnet' }, haiku = { agent: 'general-purpose', model: 'haiku' }

test('modes load validated: no mode is built in, bad entries are dropped, the active one must exist', () => {
  assert.deepEqual(DEFAULTS.modes, [])
  assert.equal(normalizeSettings({}).activeMode, undefined)
  // Settings from before modes load as they did, with no modes.
  const old = normalizeSettings({ allow: ['gpt-6-1-sol'], judge: 'jev' })
  assert.deepEqual([old.modes, old.allow, old.judge, Object.hasOwn(old, 'activeMode')], [[], ['gpt-6-1-sol'], 'jev', false])
  const modes = normalizeModes([
    { id: 'burn', name: '  Burn GPT  ', targets: ['chatgpt', 'chatgpt', ' ', 3], action: 'prefer', delegation: 'eager', until: 'reset' },
    { id: 'keep', name: 'Keep Claude', targets: ['anthropic'], action: 'avoid', delegation: 'loud', until: 1_800_000_000_000 },
    { id: 'burn', name: 'duplicate id' },
    { id: 'x', name: '' },
    { name: 'no id' },
    { id: 'odd', name: 'Odd', action: 'sideways', until: -5 },
    'not a mode',
  ])
  assert.deepEqual(modes, [
    { id: 'burn', name: 'Burn GPT', targets: ['chatgpt'], action: 'prefer', delegation: 'eager', until: 'reset' },
    { id: 'keep', name: 'Keep Claude', targets: ['anthropic'], action: 'avoid', delegation: 'normal', until: 1_800_000_000_000 },
    { id: 'odd', name: 'Odd', targets: [], action: 'prefer', delegation: 'normal' },
  ])
  assert.equal(normalizeModes([{ id: 'long', name: 'x'.repeat(80) }])[0]!.name.length, 40)
  const on = normalizeSettings({ modes, activeMode: 'keep', activeSince: 1_700_000_000_000 })
  assert.deepEqual([on.activeMode, on.activeSince, activeModeOf(on)?.name], ['keep', 1_700_000_000_000, 'Keep Claude'])
  // An active mode that is gone is no active mode, and its start goes with it.
  const gone = normalizeSettings({ modes, activeMode: 'deleted', activeSince: 1_700_000_000_000 })
  assert.deepEqual([gone.activeMode, gone.activeSince, activeModeOf(gone)], [undefined, undefined, undefined])
  // Turning a mode off is a removal another surface's edit does not bring back.
  const off = applySettingsChanges(on, settingsChanges(on, normalizeSettings({ ...on, activeMode: undefined, activeSince: undefined })))
  assert.equal(Object.hasOwn(off, 'activeMode'), false)
  assert.equal(Object.hasOwn(off, 'activeSince'), false)
  assert.deepEqual(off.modes, modes)
})

test('prefer fills each tier the target can serve: strongest on High and Max, cheapest on Low; its own and empty-handed tiers stay', () => {
  const chatgpt = modeRungs(USER, { targets: ['chatgpt'], action: 'prefer' }, LIVE)
  assert.deepEqual(chatgpt.rungs, {
    light: { target: { agent: 'gpt-6-luna' }, effort: 'low' },
    // Already on the target: the user's own pick and effort stay.
    standard: USER.standard,
    hard: USER.hard,
    plan: { target: { agent: 'gpt-6-astra' }, effort: 'xhigh' },
  })
  assert.deepEqual(chatgpt.changed, ['light', 'plan'])
  // Claude by provider: Haiku, Sonnet, Opus, Opus.
  const claude = modeRungs(USER, { targets: ['anthropic'], action: 'prefer' }, LIVE)
  assert.deepEqual([claude.rungs.light, claude.rungs.standard, claude.rungs.hard, claude.rungs.plan], [{ target: haiku, effort: 'low' }, { target: sonnet, effort: 'medium' }, { target: opus, effort: 'high' }, USER.plan])
  // Models by key, none of a known family: the cheapest below, the dearest above, at each rung's default effort as the model takes it.
  const flash = modeRungs(USER, { targets: ['deepseek-flash', 'glm-flash'], action: 'prefer' }, LIVE)
  assert.deepEqual(flash.rungs.light, { target: { agent: 'deepseek-flash' }, effort: 'max' })
  // Medium at its default effort, moved to what DeepSeek takes (low/high/max: medium ties up to high).
  assert.deepEqual(flash.rungs.standard, { target: { agent: 'deepseek-flash' }, effort: 'high' })
  assert.deepEqual(flash.rungs.hard, { target: { agent: 'glm-flash' }, effort: 'high' })
  assert.deepEqual(flash.rungs.plan, { target: { agent: 'glm-flash' }, effort: 'high' })
  // The target cannot run now (not among the choices): every tier stays as the user set it.
  const none = modeRungs(USER, { targets: ['chatgpt'], action: 'prefer' }, LIVE.filter(c => c.provider !== 'chatgpt'))
  assert.deepEqual([none.rungs, none.changed], [USER, []])
  // An empty tier is filled when the target can serve it.
  assert.deepEqual(modeRungs({}, { targets: ['chatgpt'], action: 'prefer' }, LIVE).rungs.standard, { target: { agent: 'gpt-6-1-sol' }, effort: 'medium' })
})

test('avoid refills only the tiers on a target, from the other ticked models, else the session model', () => {
  const noGpt = modeRungs(USER, { targets: ['chatgpt'], action: 'avoid' }, LIVE)
  assert.deepEqual(noGpt.rungs, { light: USER.light, standard: { target: sonnet, effort: 'medium' }, hard: { target: opus, effort: 'high' }, plan: USER.plan })
  assert.deepEqual(noGpt.changed, ['standard', 'hard'])
  // Keep Claude for orchestrating: Max goes to Astra rather than Opus.
  const noClaude = modeRungs(USER, { targets: ['anthropic'], action: 'avoid' }, LIVE)
  assert.deepEqual(noClaude.rungs.plan, { target: { agent: 'gpt-6-astra' }, effort: 'xhigh' })
  assert.deepEqual(noClaude.changed, ['plan'])
  // A target model that cannot run now is still recognised by its provider through `known`.
  const off = LIVE.filter(c => c.provider !== 'chatgpt')
  const known = [{ target: { agent: 'gpt-6-1-sol' }, provider: 'chatgpt' }, { target: { agent: 'gpt-6-astra' }, provider: 'chatgpt' }]
  assert.deepEqual(modeRungs(USER, { targets: ['chatgpt'], action: 'avoid' }, off, known).changed, ['standard', 'hard'])
  // Nothing else ticked: the session's model.
  const only = modeRungs(USER, { targets: ['chatgpt', 'anthropic', 'deepseek', 'zai'], action: 'avoid' }, LIVE)
  assert.deepEqual(only.rungs.hard, { target: { agent: 'general-purpose' }, effort: 'high' })
  // Targets name a provider or a model key, Claude's own as general-purpose:<model>.
  assert.equal(inTargets(['general-purpose:opus'], { target: opus, provider: 'anthropic' }), true)
  assert.equal(inTargets(['chatgpt'], { target: opus, provider: 'anthropic' }), false)
})

test('a mode ends at its time, or once every account\'s window has reset since it turned on', () => {
  const since = Date.parse('2026-10-12T10:00:00Z')
  assert.equal(modeOver({ until: since + 3_600_000 }, since, since + 3_599_999), false)
  assert.equal(modeOver({ until: since + 3_600_000 }, since, since + 3_600_000), true)
  assert.equal(modeOver({}, since, since + 1e12), false)
  // Reset: unknown windows, or no start, never end it.
  assert.equal(modeOver({ until: 'reset' }, since, since + 1e12, []), false)
  assert.equal(modeOver({ until: 'reset' }, undefined, since + 1e12, [{ at: since + 1 }]), false)
  const week = 7 * 86_400_000
  const pending = [{ at: since + 86_400_000, windowMs: week }]
  assert.equal(modeOver({ until: 'reset' }, since, since + 3_600_000, pending), false)
  assert.equal(modeOver({ until: 'reset' }, since, since + 86_400_000, pending), true)
  // A fresh snapshot after the reset shows the next one; the window it started began after `since`.
  assert.equal(modeOver({ until: 'reset' }, since, since + 2 * 86_400_000, [{ at: since + 86_400_000 + week, windowMs: week }]), true)
  // Two accounts: over only when both have reset.
  assert.equal(modeOver({ until: 'reset' }, since, since + 86_400_000, [...pending, { at: since + 3 * 86_400_000, windowMs: week }]), false)
  // The router's account list: the weekly window where there is one, reset_at in seconds or a countdown; paused accounts left out.
  const body = { provider: 'chatgpt', accounts: [
    { state: 'ready', quota: { at: since, rate_limits: { primary: { used_percent: 40, window_minutes: 300, reset_at: (since + 3_600_000) / 1000 }, secondary: { used_percent: 70, window_minutes: 10080, reset_at: (since + 86_400_000) / 1000 } } } },
    { state: 'cooling', quota: { at: since, rate_limits: { primary: { used_percent: 100, window_minutes: 300, reset_after_seconds: 600 }, secondary: null } } },
    { state: 'paused', quota: { at: since, rate_limits: { primary: { used_percent: 1, reset_at: 1 } } } },
    { state: 'ready', quota: null },
  ] }
  assert.deepEqual(quotaWindows(body), [{ at: since + 86_400_000, windowMs: week }, { at: since + 600_000, windowMs: 300 * 60_000 }])
  assert.deepEqual(quotaWindows({}), [])
  // The providers a mode's targets name: model keys stand for theirs.
  assert.deepEqual(modeProviders(['gpt-6-astra', 'chatgpt', 'general-purpose:opus'], LIVE), ['chatgpt', 'anthropic'])
})

test('the eager note goes with the first prompt after the mode turns on and after each compaction, not every turn', () => {
  const modes = normalizeModes([{ id: 'burn', name: 'Burn GPT', targets: ['chatgpt'], delegation: 'eager' }, { id: 'calm', name: 'Calm', targets: ['chatgpt'] }])
  const on = { modes, activeMode: 'burn', activeSince: 5 }
  const first = eagerNote(on, null)
  assert.equal(first.note, modeNote('Burn GPT'))
  assert.equal(first.note, 'ClaudeRipple mode Burn GPT: delegate everything except judgment and final review to ripple:low/medium/high/max.')
  assert.equal(first.noted, modeKey(on))
  // The next turn: nothing.
  assert.deepEqual(eagerNote(on, first.noted), { noted: first.noted })
  // A compaction clears what was noted: the next prompt carries it again.
  assert.equal(eagerNote(on, null).note, first.note)
  // Turned off and on again is a new turning-on.
  assert.equal(eagerNote({ ...on, activeSince: 9 }, first.noted).note, first.note)
  // A normal mode, or none, adds nothing.
  assert.deepEqual(eagerNote({ modes, activeMode: 'calm', activeSince: 5 }, null), { noted: null })
  assert.deepEqual(eagerNote({ modes }, 'burn@5'), { noted: 'burn@5' })
})
