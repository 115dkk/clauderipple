// The limits row's data: the router's per-model weeklies, the ChatGPT accounts, and how the
// band names and groups them. Follows test/mod/modes.test.ts for extensionless imports.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
registerHooks({ resolve(specifier, context, next) {
  const source = context.parentURL?.includes('/packages/mod/hooks/')
  return next(source && /^\.\.?\//.test(specifier) && !/\.[a-z]+$/.test(specifier) ? `${specifier}.ts` : specifier, context)
} })
const { claudeScopedFrom, CLAUDE_USAGE_STALE_MS } = await import('../../packages/mod/hooks/session.ts')
const { chatgptProviders, gptLimitsFrom } = await import('../../packages/mod/hooks/modes.ts')
const { limitGroupName, limitGroups, limitItemName, limitItemTip } = await import('../../packages/mod/hooks/ui/view.ts')
const { barArt } = await import('../../packages/mod/hooks/ui/art.ts')

const NOW = Date.parse('2026-10-15T00:00:00Z')

const claudeStatus = (at: number, scoped?: unknown) => ({ claude: { accounts: [
  { id: 'other', quota: { at, scoped } },
  { id: 'current', quota: { type: 'claude.usage', at, rate_limits: {}, ...(scoped === undefined ? {} : { scoped }) } },
] } })

test('scoped weeklies come from the current login only, fresh snapshots only', () => {
  const scoped = [
    { name: 'Fable', used_percent: 2, window_minutes: 10080, reset_at: NOW / 1000 },
    { name: 'Opus', used_percent: 41.25, window_minutes: 10080 },
    { name: '', used_percent: 3, window_minutes: 10080 },
    { name: 'Vague', used_percent: 'many', window_minutes: 10080 },
    null,
  ]
  assert.deepEqual(claudeScopedFrom(claudeStatus(NOW - 60_000, scoped), NOW), [
    { name: 'Fable', percent: 2, resetsAt: new Date(NOW).toISOString() },
    { name: 'Opus', percent: 41.3 },
  ])
  assert.deepEqual(claudeScopedFrom(claudeStatus(NOW - CLAUDE_USAGE_STALE_MS - 1, scoped), NOW), [])
  assert.deepEqual(claudeScopedFrom(claudeStatus(NOW - 60_000), NOW), [])
  assert.deepEqual(claudeScopedFrom({}, NOW), [])
  assert.deepEqual(claudeScopedFrom(null, NOW), [])
})

test('chatgpt provider names come from the status providers', () => {
  const status = { providers: { anthropic: { type: 'anthropic' }, chatgpt: { type: 'chatgpt' }, codex: { type: 'chatgpt' }, zai: { type: 'anthropic-compatible' } } }
  assert.deepEqual(chatgptProviders(status), ['chatgpt', 'codex'])
  assert.deepEqual(chatgptProviders({}), [])
  assert.deepEqual(chatgptProviders(null), [])
})

test('gpt windows skip paused and needs-login accounts, and number the rest', () => {
  // Shape answered 2026-10-15, with a second account added.
  const body = (at: number) => ({ provider: 'chatgpt', accounts: [
    { id: 'legacy', state: 'ready', paused: false, quota: { type: 'codex.rate_limits', rate_limits: { primary: { used_percent: 23, window_minutes: 10080, reset_after_seconds: 537851, reset_at: 1792565062 }, secondary: null }, at } },
    { id: '89ec', state: 'paused', paused: true, quota: null },
    { id: 'codex', state: 'needs-login', quota: { type: 'codex.rate_limits', rate_limits: { primary: { used_percent: 1, window_minutes: 300 } }, at } },
    { id: 'second', state: 'ready', quota: { type: 'codex.rate_limits', rate_limits: { primary: { used_percent: 64.44, window_minutes: 300, reset_at: 1792027211.5 }, secondary: { used_percent: 97, window_minutes: 10080, reset_after_seconds: 3600 } }, at } },
  ] })
  const at = NOW - 60_000
  assert.deepEqual(gptLimitsFrom(body(at), 'chatgpt', NOW), [
    { provider: 'chatgpt', account: 0, kind: 'seven_day', label: '', windowMinutes: 10080, percent: 23, resetsAt: new Date(1792565062 * 1000).toISOString() },
    { provider: 'chatgpt', account: 1, kind: 'five_hour', label: '', windowMinutes: 300, percent: 64.4, resetsAt: new Date(1792027211.5 * 1000).toISOString() },
    { provider: 'chatgpt', account: 1, kind: 'seven_day', label: '', windowMinutes: 10080, percent: 97, resetsAt: new Date(at + 3600 * 1000).toISOString() },
  ])
  // An old snapshot still stands (the router only refreshes it on use); a window whose reset has
  // passed does not. An unknown body leaves nothing.
  // Six hours old: the second account's weekly (reset an hour after that snapshot) has rolled over.
  assert.deepEqual(gptLimitsFrom(body(NOW - 6 * 3_600_000), 'chatgpt', NOW).map(w => w.account + ':' + w.kind), ['0:seven_day', '1:five_hour'])
  assert.deepEqual(gptLimitsFrom(body(at), 'chatgpt', Date.parse('2026-10-15T02:00:00Z')).map(w => w.kind), ['seven_day'])
  assert.deepEqual(gptLimitsFrom({}, 'chatgpt', NOW), [])
  // A window of another length keeps its minutes for a generic name.
  const odd = { provider: 'chatgpt', accounts: [{ id: 'a', state: 'ready', quota: { rate_limits: { primary: { used_percent: 5, window_minutes: 43200 } }, at } }] }
  assert.deepEqual(gptLimitsFrom(odd, 'chatgpt', NOW), [{ provider: 'chatgpt', account: 0, kind: 'window', label: '', windowMinutes: 43200, percent: 5 }])
})

test('the row names windows, groups accounts, and tips the reset', () => {
  const items = [
    { provider: 'claude', account: 0, kind: 'five_hour', label: '', percent: 1 },
    { provider: 'claude', account: 0, kind: 'seven_day', label: '', percent: 88, resetsAt: '2026-10-15T04:00:00Z' },
    { provider: 'claude', account: 0, kind: 'scoped', label: 'Fable', percent: 2 },
    { provider: 'chatgpt', account: 0, kind: 'seven_day', label: '', windowMinutes: 10080, percent: 23 },
    { provider: 'chatgpt', account: 1, kind: 'five_hour', label: '', windowMinutes: 300, percent: 64 },
  ] as const
  assert.equal(limitItemName(items[0]!, 'ko'), '5시간')
  assert.equal(limitItemName(items[1]!, 'ko'), '주간')
  assert.equal(limitItemName(items[2]!, 'ko'), 'Fable')
  assert.equal(limitItemName(items[3]!, 'en'), 'Weekly')
  assert.equal(limitItemName({ provider: 'x', account: 0, kind: 'window', label: '', windowMinutes: 43200, percent: 5 }, 'ko'), '30일')
  const groups = limitGroups(items)
  assert.deepEqual(groups.map(g => g.key), ['claude', 'chatgpt#0', 'chatgpt#1'])
  assert.equal(limitGroupName(groups[0]!, false), 'Claude')
  assert.equal(limitGroupName(groups[1]!, false), 'GPT')
  assert.equal(limitGroupName(groups[1]!, true), 'GPT 1')
  assert.equal(limitGroupName(groups[2]!, true), 'GPT 2')
  assert.equal(limitItemTip({ ...items[1]!, provider: 'claude', account: 0, kind: 'seven_day', label: '', resetsAt: new Date(NOW + 30 * 60_000).toISOString() }, 'Claude', 'ko', NOW), 'Claude 주간 88% · 30분 뒤 초기화')
  assert.equal(limitItemTip({ ...items[0]!, provider: 'claude', account: 0, kind: 'five_hour', label: '' }, 'Claude', 'en', NOW), 'Claude 5-hour 1%')
})

test('the bar rounds to integers, and tones the fill', () => {
  assert.equal(barArt(23.4, 'ink'), barArt(23, 'ink'), 'the same figure draws the same picture')
  assert.notEqual(barArt(23.6, 'ink'), barArt(23.4, 'ink'))
  assert.ok(barArt(50, 'ink').includes('#67e8f9'), 'the well reading keeps the teal-to-violet fill')
  assert.ok(barArt(88, 'amber').includes('#fde68a'))
  assert.ok(barArt(97, 'red').includes('#fecdd3'))
})
