// The scenes the preview draws (render.mjs copies this in as the mod's only test). Each one is a
// renderer with fixed data, drawn on the desktop surface and printed as `@@SCENE {...}`.

import { test } from 'claude-code/testing'
import type { RenderElement, RenderPropsOf } from 'claude-code'

import type { Settings } from '../types'
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
const SETTINGS_VIEW: SettingsView = { settings: SETTINGS, jev: { source: 'env', test: { state: 'idle' } } }

/** The AbovePrompt site as register.tsx composes it on the desktop: the band, its × inside. */
function site(el: Els, frame: Frame, view: DashboardView): RenderElement {
  return renderBand(el, frame, view, noop) as RenderElement
}

type Scene = { name: string; columns?: number; draw: (el: Els, frame: Frame) => unknown }

const alert = (a: AlertView) => (el: Els, frame: Frame) => renderAlert(el, frame, a, noop)

const SCENES: Scene[] = [
  { name: 'band', draw: (el, f) => site(el, f, DASH) },
  { name: 'band-deciding', draw: (el, f) => site(el, f, { ...DASH, effort: { level: null, mode: 'deciding', since: NOW - 500 } }) },
  { name: 'band-working-handoff', draw: (el, f) => site(el, f, { ...DASH, isWorking: true, handoff: 'advised', warm: { on: true, pings: 2, cost: 9000 }, agents: { live: 2, total: 3 }, context: { percent: 64, tokens: 128_000, window: 200_000 }, mode: 'GPT 우선' }) },
  { name: 'band-drowsy-off', draw: (el, f) => site(el, f, { ...DASH, auto: false, effort: { level: 'medium', mode: 'off' }, cache: { expiresAt: NOW + 60_000, ttlMs: 3_600_000 }, limit: { kind: 'five_hour', percent: 86, resetsAt: '2026-10-12T15:40:00', save: false }, extras: ['context', 'limits'] }) },
  { name: 'band-asleep', draw: (el, f) => site(el, f, { ...DASH, cache: { expiresAt: NOW - 1, ttlMs: 3_600_000 } }) },
  { name: 'band-menu', draw: (el, f) => site(el, f, { ...DASH, effortMenu: true, effort: { level: 'xhigh', mode: 'manual' } }) },
  { name: 'band-narrow', columns: 70, draw: (el, f) => site(el, f, DASH) },
  { name: 'band-700-busy', columns: 79, draw: (el, f) => site(el, f, { ...DASH, effort: { level: 'xhigh', mode: 'manual' }, handoff: 'advised', agents: { live: 2, total: 3 }, warm: { on: true, pings: 3, cost: 0 } }) },
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
  { name: 'agents', columns: 90, draw: (el, f) => renderAgents(el, f, { agents: [], now: NOW, showDone: false }, noop) },
  { name: 'log', columns: 90, draw: (el, f) => renderLog(el, f, { rows: [], mineOnly: true }, noop) },
]

test('scenes', async ($, on) => {
  const shown = SCENES.filter(scene => !ONLY.length || ONLY.includes(scene.name))
  for (const scene of shown) {
    const columns = scene.columns ?? WIDTH
    on('ui.render', { component: 'Pane', requestId: scene.name }, ($, e) => {
      const frame: Frame = { surface: 'desktop', columns, maxRows: 12, now: NOW, appearance: 'auto', lang: LANG }
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
