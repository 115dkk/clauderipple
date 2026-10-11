import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { DEFAULTS, normalizeSettings } from '../../packages/mod/hooks/settings.ts'
import { billingOf, cheapest, claudeChoices, nearestEffort, preset, presets, rungOf } from '../../packages/mod/hooks/ladder.ts'
import type { LadderChoice, WorkerCandidate, WorkerVerdict } from '../../packages/mod/types/index.d.ts'
registerHooks({ resolve(specifier, context, next) {
  const source = context.parentURL?.includes('/packages/mod/hooks/')
  return next(source && /^\.\.?\//.test(specifier) && !/\.[a-z]+$/.test(specifier) ? `${specifier}.ts` : specifier, context)
} })
const { resolveWorker } = await import('../../packages/mod/hooks/workers.ts')

const v = (level: WorkerVerdict['level'], more: Partial<WorkerVerdict> = {}): WorkerVerdict => ({ domain: 'general', level, effort: 'medium', why: '', ...more })

test('levels land on light, standard and hard; a plan at standard or deep goes to Plan', () => {
  assert.equal(rungOf(v('light')), 'light')
  assert.equal(rungOf(v('standard')), 'standard')
  assert.equal(rungOf(v('deep')), 'hard')
  assert.equal(rungOf(v('standard', { kind: 'plan' })), 'plan')
  assert.equal(rungOf(v('deep', { kind: 'plan' })), 'plan')
  // A light plan (rename a section of the spec) is still light work.
  assert.equal(rungOf(v('light', { kind: 'plan' })), 'light')
  assert.equal(rungOf(v('deep', { kind: 'do' })), 'hard')
})

test('an unsure verdict takes the next rung up; Hard and Plan stay', () => {
  assert.equal(rungOf(v('light', { sure: 0.49 })), 'standard')
  assert.equal(rungOf(v('standard', { sure: 0.3 })), 'hard')
  assert.equal(rungOf(v('deep', { sure: 0.1 })), 'hard')
  assert.equal(rungOf(v('deep', { kind: 'plan', sure: 0.1 })), 'plan')
  assert.equal(rungOf(v('light', { sure: 0.5 })), 'light')
  assert.equal(rungOf(v('light')), 'light')
})

// The router's workers on 2026-10-11 and Claude's own models.
const candidates: WorkerCandidate[] = [
  { target: { agent: 'deepseek-v4-1-flash' }, model: 'deepseek-v4.1-flash', provider: 'opencode-go' },
  { target: { agent: 'gpt-6-1-sol' }, model: 'gpt-6.1-sol', provider: 'chatgpt' },
  { target: { agent: 'gpt-6-astra' }, model: 'gpt-6-astra', provider: 'chatgpt' },
  { target: { agent: 'general-purpose', model: 'opus' }, model: 'claude-opus-5-5', provider: 'anthropic' },
  { target: { agent: 'general-purpose', model: 'sonnet' }, model: 'claude-sonnet-5-5', provider: 'anthropic' },
]
const pick = (s: typeof DEFAULTS, verdict: WorkerVerdict, chatgpt = true, workers = candidates) => resolveWorker(verdict, s, workers, [], chatgpt)

test('the default ladder runs each rung at its own effort, whatever effort the judge said', () => {
  assert.deepEqual(pick(DEFAULTS, v('light', { effort: 'low' })), { target: { agent: 'deepseek-v4-1-flash' }, effort: 'max', rung: 'light' })
  assert.deepEqual(pick(DEFAULTS, v('standard', { effort: 'high' })), { target: { agent: 'gpt-6-1-sol' }, effort: 'medium', rung: 'standard' })
  assert.deepEqual(pick(DEFAULTS, v('deep')), { target: { agent: 'gpt-6-astra' }, effort: 'high', rung: 'hard' })
  assert.deepEqual(pick(DEFAULTS, v('deep', { kind: 'plan' })), { target: { agent: 'general-purpose', model: 'opus' }, effort: 'high', rung: 'plan' })
  // Design has its own ladder on Claude.
  assert.deepEqual(pick(DEFAULTS, v('standard', { domain: 'design' })).target, { agent: 'general-purpose', model: 'sonnet' })
})

test('unavailable: the rung\'s backup, else one rung up, else the session model; never down', () => {
  const ladder = (rungs: object) => normalizeSettings({ rules: { general: { mode: 'ladder', rungs } } })
  const sol = { agent: 'gpt-6-1-sol' }, astra = { agent: 'gpt-6-astra' }, opus = { agent: 'general-purpose', model: 'opus' }, sonnet = { agent: 'general-purpose', model: 'sonnet' }
  // ChatGPT out of quota: Standard's backup runs, at Standard's effort.
  const backed = ladder({ standard: { target: sol, effort: 'medium', backup: sonnet }, hard: { target: astra, effort: 'high' } })
  const b = pick(backed, v('standard'), false)
  assert.deepEqual([b.target, b.effort, b.rung], [sonnet, 'medium', 'standard'])
  assert.match(b.fallbackReason ?? '', /ChatGPT/)
  // No backup: one rung up, at that rung's effort.
  const up = pick(ladder({ standard: { target: sol, effort: 'medium' }, hard: { target: opus, effort: 'high' } }), v('standard'), false)
  assert.deepEqual([up.target, up.effort, up.rung], [opus, 'high', 'hard'])
  // Nothing up there either: the session model, at the wanted rung's effort.
  const none = pick(ladder({ standard: { target: sol, effort: 'low' }, hard: { target: astra, effort: 'high' }, plan: { target: opus, effort: 'high' } }), v('standard'), false)
  assert.deepEqual([none.target, none.effort], [{ agent: 'general-purpose' }, 'low'])
  // Only one rung up: Light's trouble never reaches Plan's Opus.
  const one = pick(ladder({ light: { target: { agent: 'gone' }, effort: 'low' }, standard: { target: sol, effort: 'medium' }, plan: { target: opus, effort: 'high' } }), v('light'), false)
  assert.deepEqual(one.target, { agent: 'general-purpose' })
  assert.match(one.fallbackReason ?? '', /gone is not installed/)
  // Never down: Hard out, Light free, still the session model.
  const down = pick(ladder({ light: { target: sonnet, effort: 'low' }, hard: { target: astra, effort: 'high' } }), v('deep'), false)
  assert.deepEqual(down.target, { agent: 'general-purpose' })
  // An empty rung says so and moves up.
  const empty = pick(ladder({ standard: { target: sol, effort: 'medium' } }), v('light'))
  assert.deepEqual([empty.target, empty.rung], [sol, 'standard'])
  assert.match(empty.fallbackReason ?? '', /Light work has no model set/)
})

test('pins and Auto migrate: Auto stays Auto, pins become ladders with Plan one effort above Hard', () => {
  // The owner's stored settings of 2026-10-11 (revision 24).
  const stored = { rules: {
    general: { mode: 'auto', allow: ['chatgpt', 'anthropic', 'deepseek'] },
    design: { mode: 'pin', targets: { light: { agent: 'general-purpose', model: 'sonnet' }, standard: { agent: 'general-purpose', model: 'sonnet' }, deep: { agent: 'general-purpose', model: 'opus' } } },
    frontend: { mode: 'auto', allow: ['anthropic'] }, backend: { mode: 'inherit' },
  }, agentAuto: 'all', autoFloors: { light: 20, standard: 45, deep: 50 } }
  const s = normalizeSettings(stored)
  assert.deepEqual(s.rules.general, { mode: 'auto', allow: ['chatgpt', 'anthropic', 'deepseek'] })
  assert.deepEqual(s.rules.frontend, { mode: 'auto', allow: ['anthropic'] })
  assert.deepEqual(s.autoFloors, { light: 20, standard: 45, deep: 50 })
  const sonnet = { agent: 'general-purpose', model: 'sonnet' }, opus = { agent: 'general-purpose', model: 'opus' }
  assert.deepEqual(s.rules.design, { mode: 'ladder', rungs: { light: { target: sonnet, effort: 'medium' }, standard: { target: sonnet, effort: 'high' }, hard: { target: opus, effort: 'high' }, plan: { target: opus, effort: 'xhigh' } } })
  assert.deepEqual(normalizeSettings(s), s)
  // The old default general pin: its models keep the default ladder's efforts.
  const old = normalizeSettings({ rules: { general: { mode: 'pin', targets: { light: { agent: 'deepseek-v4-1-flash' }, standard: { agent: 'gpt-6-1-sol' }, deep: { agent: 'gpt-6-astra' } } } } }).rules.general
  assert.deepEqual(old, { mode: 'ladder', rungs: {
    light: { target: { agent: 'deepseek-v4-1-flash' }, effort: 'max' }, standard: { target: { agent: 'gpt-6-1-sol' }, effort: 'medium' },
    hard: { target: { agent: 'gpt-6-astra' }, effort: 'high' }, plan: { target: { agent: 'gpt-6-astra' }, effort: 'xhigh' },
  } })
  // A pin's calibration moves each rung's effort as it moved the judge's; the ceiling holds Hard, Plan still goes one up.
  const tuned = normalizeSettings({ rules: { backend: { mode: 'pin', targets: { light: { agent: 'a' }, deep: { agent: 'b' } }, effortOffset: 1, ceiling: 'high' } } }).rules.backend
  assert.deepEqual(tuned, { mode: 'ladder', rungs: { light: { target: { agent: 'a' }, effort: 'medium' }, standard: { target: { agent: 'b' }, effort: 'high' }, hard: { target: { agent: 'b' }, effort: 'high' }, plan: { target: { agent: 'b' }, effort: 'xhigh' } } })
  // A pin with no target at all is the field's default ladder.
  assert.deepEqual(normalizeSettings({ rules: { design: { mode: 'pin', targets: {} } } }).rules.design, DEFAULTS.rules.design)
})

test('ladder rungs validate: a bad effort is the rung default, a rung without a target is dropped, backups stay', () => {
  const s = normalizeSettings({ rules: { docs: { mode: 'ladder', rungs: {
    light: { target: { agent: ' w ' }, effort: 'ultra', backup: { agent: 'general-purpose', model: 'haiku' } },
    standard: { target: { agent: 2 }, effort: 'high' }, hard: { target: { agent: 'h' }, effort: 'xhigh', backup: { agent: '' } }, extra: { target: { agent: 'x' } },
  } } } }).rules.docs
  assert.deepEqual(s, { mode: 'ladder', rungs: { light: { target: { agent: 'w' }, effort: 'low', backup: { agent: 'general-purpose', model: 'haiku' } }, hard: { target: { agent: 'h' }, effort: 'xhigh' } } })
})

test('efforts move to the nearest the model takes, ties up, as the router clamps them', () => {
  assert.equal(nearestEffort('medium', ['low', 'high', 'max']), 'high')
  assert.equal(nearestEffort('xhigh', ['low', 'medium', 'high', 'max']), 'max')
  assert.equal(nearestEffort('max', ['low', 'medium', 'high']), 'high')
  assert.equal(nearestEffort('low', ['none', 'minimal', 'low']), 'low')
  assert.equal(nearestEffort('high', []), 'high')
})

test('billing comes from the provider: subscriptions, pay-per-token APIs and free local or :free models', () => {
  assert.equal(billingOf({ type: 'chatgpt' }), 'subscription')
  assert.equal(billingOf({ type: 'anthropic', auth: 'claude-code' }), 'subscription')
  assert.equal(billingOf({ type: 'anthropic', auth: 'api-key' }), 'payg')
  assert.equal(billingOf({ type: 'google', auth: 'antigravity' }), 'subscription')
  assert.equal(billingOf({ type: 'openai-compatible', preset: 'opencode-go' }), 'subscription')
  assert.equal(billingOf({ type: 'anthropic-compatible', preset: 'deepseek' }), 'payg')
  assert.equal(billingOf({ type: 'openai-compatible', preset: 'ollama' }), 'free')
  assert.equal(billingOf({ type: 'openai-compatible', url: 'http://127.0.0.1:1234/v1' }), 'free')
  assert.equal(billingOf({ type: 'anthropic-compatible', preset: 'openrouter' }, 'qwen/qwen3-coder:free'), 'free')
})

const anthropicLadder = ['low', 'medium', 'high', 'max']
const gpt = (agent: string, model: string): LadderChoice => ({ target: { agent }, model, provider: 'chatgpt', billing: 'subscription', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] })
const LIVE: LadderChoice[] = [
  { target: { agent: 'deepseek-flash' }, model: 'deepseek-flash', provider: 'deepseek', billing: 'payg', efforts: ['low', 'high', 'max'], cost: 0.3 },
  { target: { agent: 'deepseek-v4-1-flash' }, model: 'deepseek-v4.1-flash', provider: 'opencode-go', billing: 'subscription', efforts: ['low', 'high', 'max'], cost: 0.27 },
  gpt('gpt-6-1-sol', 'gpt-6.1-sol'), gpt('gpt-6-astra', 'gpt-6-astra'), gpt('gpt-6-luna', 'gpt-6-luna'), gpt('gpt-6-sol', 'gpt-6-sol'),
  ...claudeChoices(anthropicLadder),
]
const sonnet = { agent: 'general-purpose', model: 'sonnet' }, opus = { agent: 'general-purpose', model: 'opus' }, haiku = { agent: 'general-purpose', model: 'haiku' }

test('presets fill the four rungs from what is connected, as the spec lists them', () => {
  const all = presets(LIVE)
  assert.deepEqual(all.claude, { rungs: { light: { target: haiku, effort: 'low' }, standard: { target: sonnet, effort: 'medium' }, hard: { target: opus, effort: 'high' }, plan: { target: opus, effort: 'high' } }, substituted: [] })
  // The cheapest pay-per-token model at max (DeepSeek's ladder has max), the newest Sol, Astra, Opus.
  assert.deepEqual(all.claudeGpt, { rungs: { light: { target: { agent: 'deepseek-flash' }, effort: 'max' }, standard: { target: { agent: 'gpt-6-1-sol' }, effort: 'medium' }, hard: { target: { agent: 'gpt-6-astra' }, effort: 'high' }, plan: { target: opus, effort: 'high' } }, substituted: [] })
  assert.deepEqual(all.gpt, { rungs: { light: { target: { agent: 'gpt-6-luna' }, effort: 'low' }, standard: { target: { agent: 'gpt-6-1-sol' }, effort: 'medium' }, hard: { target: { agent: 'gpt-6-astra' }, effort: 'high' }, plan: { target: { agent: 'gpt-6-astra' }, effort: 'xhigh' } }, substituted: [] })
  assert.deepEqual(all.cheap.rungs.light, { target: { agent: 'deepseek-flash' }, effort: 'high' })
  assert.deepEqual(all.cheap.rungs.hard, { target: { agent: 'deepseek-flash' }, effort: 'max' })
  assert.deepEqual(all.cheap.rungs.plan, { target: sonnet, effort: 'high' })
})

test('a preset model that is not connected leaves the rung on its nearest choice, marked', () => {
  const claudeOnly = claudeChoices(anthropicLadder)
  const p = preset('claudeGpt', claudeOnly)
  assert.deepEqual(p.rungs.light, { target: haiku, effort: 'low' })
  assert.deepEqual(p.rungs.standard, { target: sonnet, effort: 'medium' })
  assert.deepEqual(p.rungs.hard, { target: opus, effort: 'high' })
  assert.deepEqual(p.substituted, ['light', 'standard', 'hard'])
  // GPT-first without ChatGPT: Plan's Astra at xhigh becomes Opus at high.
  assert.deepEqual(preset('gpt', claudeOnly).rungs.plan, { target: opus, effort: 'high' })
  // No pay-per-token model: Claude + GPT's light is Luna at low.
  const noPayg = LIVE.filter(c => c.billing !== 'payg')
  assert.deepEqual(preset('claudeGpt', noPayg).rungs.light, { target: { agent: 'gpt-6-luna' }, effort: 'low' })
  assert.deepEqual(preset('claudeGpt', noPayg).substituted, ['light'])
  // Free beats any measured cost; unmeasured pay-per-token models come last.
  const free: LadderChoice = { target: { agent: 'qwen-free' }, model: 'qwen3-coder:free', provider: 'openrouter', billing: 'free', efforts: [] }
  const unmeasured: LadderChoice = { target: { agent: 'mystery' }, model: 'mystery', provider: 'x', billing: 'payg', efforts: [] }
  assert.equal(cheapest([unmeasured, ...LIVE, free])?.target.agent, 'qwen-free')
  assert.equal(cheapest([unmeasured, ...LIVE])?.target.agent, 'deepseek-flash')
})
