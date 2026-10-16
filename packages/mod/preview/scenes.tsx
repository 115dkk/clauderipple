// The scenes the preview draws (render.mjs copies this in as the mod's only test). Each one is a
// renderer with fixed data, drawn on the desktop surface and printed as `@@SCENE {...}`.

import { test } from 'claude-code/testing'
import type { RenderElement, RenderPropsOf } from 'claude-code'

import type { LimitItem, Settings, Skin } from '../types'
import { normalizeSettings } from '../hooks/settings'
import { renderAgents } from '../hooks/ui/agents'
import { renderAlert } from '../hooks/ui/alerts'
import { renderBand } from '../hooks/ui/band'
import { renderLog } from '../hooks/ui/log'
import { renderSettings } from '../hooks/ui/settings'
import { renderSetup } from '../hooks/ui/setup'
import type { AlertView, DashboardView, Frame, SettingsView } from '../hooks/ui/view'
import type { Els } from '../hooks/ui/parts'

const LANG = 'ko'
const SKIN = 'deep'
const ONLY: string[] = []
/** The composer's width in a wide window, 768 px, in the desktop's cells. */
const WIDTH = 94
const NOW = Date.parse('2026-10-12T13:20:00')
const noop = new Proxy({}, { get: () => () => undefined }) as never

const DASH: DashboardView = {
  effort: { level: 'high', mode: 'auto', why: '여러 파일에 걸친 리팩터', by: 'jev' },
  model: 'Opus 5.5',
  context: { percent: 38, tokens: 76_000, window: 200_000 },
  cache: { expiresAt: NOW + 41 * 60_000, ttlMs: 3_600_000 },
  warm: { on: false, pings: 0, cost: 0 },
  limit: null,
  route: { model: 'gpt-6.1-sol', provider: 'chatgpt', ok: true, resent: false, status: '200', effort: 'high', cachePct: 96, seconds: 2.1 },
  notice: null,
  auto: true,
  handoff: 'off',
  agents: { live: 0, total: 0 },
  logOpen: false,
  agentsOpen: false,
  effortMenu: false,
  swampAt: 50,
  hide: [],
  extras: ['context'],
  isWorking: false,
}

const SETTINGS: Settings = normalizeSettings({ judge: 'jev', judgeModel: 'deepseek-v4.1-flash', modes: [{ id: 'm1', name: 'GPT 우선' }, { id: 'm2', name: '절약' }], activeMode: 'm1' } as never)

/** Every plan window the limits row gauges: Claude's 5-hour, weekly and Fable, then two GPT accounts. */
const LIMITS: LimitItem[] = [
  { provider: 'claude', type: 'anthropic', title: 'Claude', account: 0, kind: 'five_hour', label: '', percent: 1 },
  { provider: 'claude', type: 'anthropic', title: 'Claude', account: 0, kind: 'seven_day', label: '', percent: 88, resetsAt: '2026-10-12T18:20:00' },
  { provider: 'claude', type: 'anthropic', title: 'Claude', account: 0, kind: 'scoped', label: 'Fable', percent: 2, resetsAt: '2026-10-15T10:59:59+00:00' },
  { provider: 'chatgpt', type: 'chatgpt', title: 'GPT', account: 0, kind: 'seven_day', label: '', windowMinutes: 10080, percent: 23, resetsAt: '2026-10-19T13:20:00' },
  { provider: 'chatgpt', type: 'chatgpt', title: 'GPT', account: 1, kind: 'five_hour', label: '', windowMinutes: 300, percent: 64 },
  { provider: 'chatgpt', type: 'chatgpt', title: 'GPT', account: 1, kind: 'seven_day', label: '', windowMinutes: 10080, percent: 97, resetsAt: '2026-10-19T13:20:00' },
]

/** Every readable provider at once, for the general limits row: Claude, GPT, Gemini and OpenCode Go. */
const LIMITS_ALL: LimitItem[] = [
  { provider: 'anthropic', type: 'anthropic', title: 'Claude', account: 0, kind: 'five_hour', label: '', percent: 1 },
  { provider: 'anthropic', type: 'anthropic', title: 'Claude', account: 0, kind: 'seven_day', label: '', percent: 88, resetsAt: '2026-10-12T18:20:00' },
  { provider: 'anthropic', type: 'anthropic', title: 'Claude', account: 0, kind: 'scoped', label: 'Fable', percent: 2, resetsAt: '2026-10-15T10:59:59+00:00' },
  { provider: 'chatgpt', type: 'chatgpt', title: 'GPT', account: 0, kind: 'seven_day', label: '', windowMinutes: 10080, percent: 23, resetsAt: '2026-10-19T13:20:00' },
  { provider: 'google-gemini', type: 'google', title: 'Gemini', account: 0, kind: 'five_hour', label: '', windowMinutes: 300, percent: 0 },
  { provider: 'google-gemini', type: 'google', title: 'Gemini', account: 0, kind: 'seven_day', label: '', windowMinutes: 10080, percent: 2, resetsAt: '2026-10-19T13:20:00' },
  { provider: 'google-gemini', type: 'google', title: 'Gemini', account: 0, kind: 'scoped', label: '3P', windowMinutes: 10080, percent: 10, resetsAt: '2026-10-19T13:20:00' },
  { provider: 'google-gemini', type: 'google', title: 'Gemini', account: 0, kind: 'scoped', label: '3P', windowMinutes: 300, percent: 0 },
  { provider: 'opencode-go', type: 'opencode-go', title: 'Go', account: 0, kind: 'five_hour', label: '', windowMinutes: 300, percent: 3, resetsAt: '2026-10-15T05:39:48Z' },
  { provider: 'opencode-go', type: 'opencode-go', title: 'Go', account: 0, kind: 'seven_day', label: '', windowMinutes: 10080, percent: 52, resetsAt: '2026-10-19T00:00:00Z' },
  { provider: 'opencode-go', type: 'opencode-go', title: 'Go', account: 0, kind: 'window', label: '', windowMinutes: 43200, percent: 92, resetsAt: '2026-10-18T05:43:30Z' },
]
const SETTINGS_VIEW: SettingsView = { settings: SETTINGS, jev: { source: 'env', test: { state: 'idle' } } }

/** The AbovePrompt site as register.tsx composes it on the desktop: the band, its × inside. */
function site(el: Els, frame: Frame, view: DashboardView): RenderElement {
  return renderBand(el, frame, view, noop) as RenderElement
}

type Scene = { name: string; columns?: number; skin?: Skin; draw: (el: Els, frame: Frame) => unknown }

const alert = (a: AlertView) => (el: Els, frame: Frame) => renderAlert(el, frame, a, noop)

const SCENES: Scene[] = [
  { name: 'band', draw: (el, f) => site(el, f, DASH) },
  { name: 'band-deciding', draw: (el, f) => site(el, f, { ...DASH, effort: { level: null, mode: 'deciding', since: NOW - 500 } }) },
  { name: 'band-working-handoff', draw: (el, f) => site(el, f, { ...DASH, isWorking: true, handoff: 'advised', warm: { on: true, pings: 2, cost: 9000 }, agents: { live: 2, total: 3 }, context: { percent: 64, tokens: 128_000, window: 200_000 }, mode: 'GPT 우선' }) },
  { name: 'band-drowsy-off', draw: (el, f) => site(el, f, { ...DASH, auto: false, effort: { level: 'medium', mode: 'off' }, cache: { expiresAt: NOW + 60_000, ttlMs: 3_600_000 }, limit: { kind: 'five_hour', percent: 86, resetsAt: '2026-10-12T15:40:00', save: false }, extras: ['context', 'limits'] }) },
  { name: 'band-warm-here', draw: (el, f) => site(el, f, { ...DASH, warm: { on: false, pings: 0, cost: 0, here: true } }) },
  { name: 'band-asleep', draw: (el, f) => site(el, f, { ...DASH, cache: { expiresAt: NOW - 1, ttlMs: 3_600_000 } }) },
  { name: 'band-menu', draw: (el, f) => site(el, f, { ...DASH, effortMenu: true, effort: { level: 'xhigh', mode: 'manual' } }) },
  { name: 'band-narrow', columns: 70, draw: (el, f) => site(el, f, DASH) },
  { name: 'band-700-busy', columns: 79, draw: (el, f) => site(el, f, { ...DASH, effort: { level: 'xhigh', mode: 'manual' }, handoff: 'advised', agents: { live: 2, total: 3 }, warm: { on: true, pings: 3, cost: 0 } }) },
  // The band's two real widths, at its new maximum (2026-10-14): everything on — context, limits, a
  // limit, Handoff advised, a route and every control — must hold at both.
  { name: 'band-94-full', columns: 94, draw: (el, f) => site(el, f, { ...DASH, limit: { kind: 'seven_day', percent: 42, resetsAt: '2026-10-15T15:40:00', save: false }, handoff: 'advised', extras: ['context', 'limits'] }) },
  { name: 'band-100-full', columns: 100, draw: (el, f) => site(el, f, { ...DASH, limit: { kind: 'seven_day', percent: 42, resetsAt: '2026-10-15T15:40:00', save: false }, handoff: 'advised', extras: ['context', 'limits'] }) },
  // The limits row (2026-10-15): every plan window gauges the second row, and the first row's
  // limit fact steps aside for the route. Narrow, the GPT accounts go first, then Fable.
  { name: 'band-limits-94', columns: 94, draw: (el, f) => site(el, f, { ...DASH, limit: { kind: 'seven_day', percent: 88, resetsAt: '2026-10-12T18:20:00', save: false }, handoff: 'advised', extras: ['context', 'limits'], limits: LIMITS }) },
  { name: 'band-limits-100', columns: 100, draw: (el, f) => site(el, f, { ...DASH, limit: { kind: 'seven_day', percent: 88, resetsAt: '2026-10-12T18:20:00', save: false }, handoff: 'advised', extras: ['context', 'limits'], limits: LIMITS }) },
  { name: 'band-limits-70', columns: 70, draw: (el, f) => site(el, f, { ...DASH, limit: { kind: 'seven_day', percent: 88, resetsAt: '2026-10-12T18:20:00', save: false }, handoff: 'advised', extras: ['context', 'limits'], limits: LIMITS }) },
  // Every readable provider (2026-10-15): Claude, GPT, Gemini and OpenCode Go in one row, at the
  // two real widths. Narrow, the scoped windows go first, then a later provider's group.
  { name: 'band-limits-all-100', columns: 100, draw: (el, f) => site(el, f, { ...DASH, limit: { kind: 'seven_day', percent: 88, resetsAt: '2026-10-12T18:20:00', save: false }, handoff: 'advised', extras: ['context', 'limits'], limits: LIMITS_ALL }) },
  { name: 'band-limits-all-140', columns: 140, draw: (el, f) => site(el, f, { ...DASH, limit: { kind: 'seven_day', percent: 88, resetsAt: '2026-10-12T18:20:00', save: false }, handoff: 'advised', extras: ['context', 'limits'], limits: LIMITS_ALL }) },
  { name: 'band-limits-all-94', columns: 94, draw: (el, f) => site(el, f, { ...DASH, limit: { kind: 'seven_day', percent: 88, resetsAt: '2026-10-12T18:20:00', save: false }, handoff: 'advised', extras: ['context', 'limits'], limits: LIMITS_ALL }) },
  { name: 'settings', draw: (el, f) => renderSettings(el, f, SETTINGS_VIEW, noop) },
  { name: 'settings-off', draw: (el, f) => renderSettings(el, f, { ...SETTINGS_VIEW, settings: { ...SETTINGS, effortAuto: false, judge: 'haiku', keepWarm: true, activeMode: undefined } }, noop) },
  { name: 'settings-key', draw: (el, f) => renderSettings(el, f, { settings: { ...SETTINGS, jevSource: 'typesafe', judge: 'jev' }, jev: { source: null, test: { state: 'fail', message: 'key rejected (401)' } } }, noop) },
  { name: 'settings-router', columns: 70, draw: (el, f) => renderSettings(el, f, { ...SETTINGS_VIEW, settings: { ...SETTINGS, judge: 'model', bias: 1 } }, noop) },
  { name: 'alert-cold', draw: alert({ kind: 'cold', tokens: 182_000, idleMinutes: 74 }) },
  { name: 'alert-kept', draw: alert({ kind: 'kept', pings: 2, tokens: 312_000, minutesLeft: 47 }) },
  { name: 'alert-swamp', draw: alert({ kind: 'swamp', percent: 63, tokens: 126_000 }) },
  { name: 'alert-hot', draw: alert({ kind: 'hot', limitKind: 'five_hour', percent: 86, resetsAt: '2026-10-12T15:40:00', save: false }) },
  { name: 'alert-judge', draw: alert({ kind: 'judgeDown', judge: 'jev', reason: 'key rejected (401)' }) },
  { name: 'alert-compact', draw: alert({ kind: 'compactNote', draft: '' }) },
  { name: 'alert-handoff', draw: alert({ kind: 'handoffChoice', handoffKind: 'quick', after: 'continue' }) },
  { name: 'alert-handing', draw: alert({ kind: 'result', stage: 'handingOff', handoffKind: 'full' }) },
  { name: 'alert-ready', draw: alert({ kind: 'result', stage: 'handoffReady', handoffKind: 'quick' }) },
  { name: 'alert-compacted', draw: alert({ kind: 'result', stage: 'compacted' }) },
  { name: 'setup', draw: (el, f) => renderSetup(el, f, { step: 1, draft: SETTINGS, jev: { source: null, test: { state: 'idle' } } }, noop) },
  { name: 'setup-2', draw: (el, f) => renderSetup(el, f, { step: 2, draft: SETTINGS, jev: { source: 'env', test: { state: 'idle' } } }, noop) },
  { name: 'setup-3', draw: (el, f) => renderSetup(el, f, { step: 3, draft: SETTINGS, jev: { source: 'env', test: { state: 'idle' } } }, noop) },
  { name: 'setup-done', draw: (el, f) => renderSetup(el, f, { step: 4, draft: SETTINGS, jev: { source: 'env', test: { state: 'idle' } } }, noop) },
  // The other two skins (look.ts), each on the band, the quick settings, a card and a setup step.
  { name: 'flat-band', skin: 'flat', draw: (el, f) => site(el, f, { ...DASH, warm: { on: true, pings: 2, cost: 9000 }, agents: { live: 2, total: 3 }, extras: ['context', 'limits'], limit: { kind: 'five_hour', percent: 42, resetsAt: '2026-10-12T15:40:00', save: false } }) },
  { name: 'flat-band-menu', skin: 'flat', draw: (el, f) => site(el, f, { ...DASH, effortMenu: true, effort: { level: 'xhigh', mode: 'manual' } }) },
  { name: 'flat-settings', skin: 'flat', draw: (el, f) => renderSettings(el, f, SETTINGS_VIEW, noop) },
  { name: 'flat-settings-key', skin: 'flat', draw: (el, f) => renderSettings(el, f, { settings: { ...SETTINGS, jevSource: 'typesafe', judge: 'jev', effortAuto: false, keepWarm: true }, jev: { source: null, test: { state: 'fail', message: 'key rejected (401)' } } }, noop) },
  { name: 'flat-alert-swamp', skin: 'flat', draw: (el, f) => renderAlert(el, f, { kind: 'swamp', percent: 63, tokens: 126_000 }, noop) },
  { name: 'flat-alert-handoff', skin: 'flat', draw: (el, f) => renderAlert(el, f, { kind: 'handoffChoice', handoffKind: 'quick', after: 'continue' }, noop) },
  { name: 'flat-setup', skin: 'flat', draw: (el, f) => renderSetup(el, f, { step: 1, draft: SETTINGS, jev: { source: null, test: { state: 'idle' } } }, noop) },
  { name: 'matrix-band', skin: 'matrix', draw: (el, f) => site(el, f, { ...DASH, warm: { on: true, pings: 2, cost: 9000 }, agents: { live: 2, total: 3 }, extras: ['context', 'limits'], limit: { kind: 'five_hour', percent: 42, resetsAt: '2026-10-12T15:40:00', save: false } }) },
  { name: 'matrix-band-deciding', skin: 'matrix', draw: (el, f) => site(el, f, { ...DASH, effort: { level: null, mode: 'deciding', since: NOW - 500 }, effortMenu: true }) },
  { name: 'matrix-settings', skin: 'matrix', draw: (el, f) => renderSettings(el, f, SETTINGS_VIEW, noop) },
  { name: 'matrix-settings-key', skin: 'matrix', draw: (el, f) => renderSettings(el, f, { settings: { ...SETTINGS, jevSource: 'typesafe', judge: 'jev', effortAuto: false, keepWarm: true }, jev: { source: null, test: { state: 'fail', message: 'key rejected (401)' } } }, noop) },
  { name: 'matrix-alert-hot', skin: 'matrix', draw: (el, f) => renderAlert(el, f, { kind: 'hot', limitKind: 'five_hour', percent: 86, resetsAt: '2026-10-12T15:40:00', save: false }, noop) },
  { name: 'matrix-alert-handoff', skin: 'matrix', draw: (el, f) => renderAlert(el, f, { kind: 'handoffChoice', handoffKind: 'quick', after: 'continue' }, noop) },
  { name: 'matrix-setup', skin: 'matrix', draw: (el, f) => renderSetup(el, f, { step: 4, draft: SETTINGS, jev: { source: 'env', test: { state: 'idle' } } }, noop) },
  { name: 'agents', columns: 90, draw: (el, f) => renderAgents(el, f, { agents: [], now: NOW, showDone: false }, noop) },
  { name: 'log', columns: 90, draw: (el, f) => renderLog(el, f, { rows: [], mineOnly: true }, noop) },
]

test('scenes', async ($, on) => {
  const shown = SCENES.filter(scene => !ONLY.length || ONLY.includes(scene.name))
  for (const scene of shown) {
    const columns = scene.columns ?? WIDTH
    on('ui.render', { component: 'Pane', requestId: scene.name }, ($, e) => {
      const frame: Frame = { surface: 'desktop', columns, maxRows: 12, now: NOW, appearance: 'auto', skin: scene.skin ?? SKIN, lang: LANG }
      const tree = scene.draw($.ui.resolve(e), frame)
      console.log('@@SCENE ' + JSON.stringify({ name: scene.name, columns, tree }))
      return tree as RenderElement
    })
  }
  for (const scene of shown) {
    const columns = scene.columns ?? WIDTH
    const props = { title: 'ui', isFocused: true, bodyColumns: columns, placement: 'inline', scroll: { offset: 0, bodyRows: 30 }, view: {} } as RenderPropsOf['Pane']
    const ui = await $.ui.mount({ plugin: 'test', surface: 'desktop', component: 'Pane', requestId: scene.name, props, viewport: { columns, rows: 40 } })
    await ui.unmount()
  }
})
