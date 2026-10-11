// The drawings in hooks/ui, mounted through the engine on the terminal and the desktop.
//
// register.tsx does not draw them yet, so each test answers `ui.render` for a Pane of its own with
// the renderer under test (a test's own hooks may close over this file's imports; an inline
// plugin's may not). The engine validates every tree against the surface's element table, and
// presses reach the callbacks below, so these check both the trees and their wiring.

import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderElement, RenderPropsOf } from 'claude-code'

import type { AgentRec, Settings, StatusRequest } from '../types'
import { STRINGS } from '../hooks/i18n'
import { normalizeSettings } from '../hooks/settings'
import { renderAgents } from '../hooks/ui/agents'
import { renderAlert } from '../hooks/ui/alerts'
import { besideBand, renderBand, renderFooter } from '../hooks/ui/band'
import { renderLog } from '../hooks/ui/log'
import { renderSettings } from '../hooks/ui/settings'
import { renderSetup } from '../hooks/ui/setup'
import { countdown, elapsed, minutesLeft, modelName, nextMinuteChange, resetsLabel, routeOf, seconds, targetOf, targetValue } from '../hooks/ui/view'
import type { AlertView, DashboardView, Frame, JevState, SettingsActions, Surface } from '../hooks/ui/view'

const SURFACES = ['terminal', 'desktop'] as const
const NOW = Date.parse('2026-10-10T13:20:00')
const PRESSER = 'test'

function paneProps(columns: number, rows = 30): RenderPropsOf['Pane'] {
  return { title: 'ui', isFocused: true, bodyColumns: columns, placement: 'inline', scroll: { offset: 0, bodyRows: rows }, view: {} } as RenderPropsOf['Pane']
}

function frameOf(surface: Surface, columns = 140, maxRows = 12): Frame {
  return { surface, columns, maxRows, now: NOW, appearance: 'auto', lang: 'en' }
}

/** Records which callback ran, with what. */
function recorder() {
  const calls: string[] = []
  const fn = (name: string) => (...args: unknown[]) => {
    calls.push(args.length ? name + ':' + JSON.stringify(args) : name)
  }
  return { calls, fn }
}

const DASH: DashboardView = {
  effort: { level: 'high', mode: 'auto', why: 'multi-file refactor' },
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

const SETTINGS: Settings = normalizeSettings({
  effortAuto: true,
  judge: 'jev',
  judgeModel: 'deepseek-v4.1-flash',
  bias: 0,
  floor: 'low',
  ceiling: 'max',
  agentAuto: 'auto',
  tiers: { light: { agent: 'deepseek-v4-1-flash' }, standard: { agent: 'gpt-6-1-sol' }, deep: { agent: 'gpt-6-astra' }, design: { agent: 'general-purpose', model: 'sonnet' } },
  fallback: { agent: 'general-purpose', model: 'sonnet' },
  keepWarm: false,
  keepWarmHours: 2,
  keepWarmMinTokens: 30_000,
  compactWith: 'haiku',
  handoffSkill: '',
  handoffAfter: 'continue',
  handoffButton: 'advised',
  swampAt: 50,
  layout: 'dashboard',
  appearance: 'auto',
  language: 'auto',
  hide: [],
  setupDone: false,
})

const QUICK_ACTIONS: SettingsActions = { patch: () => undefined, jevKey: () => undefined, testJev: () => undefined, openAllSettings: () => undefined, close: () => undefined }

type Draw = (el: Parameters<typeof renderBand>[0], surface: Surface) => ReturnType<typeof renderBand>

/** Answers ui.render for the Pane `id` with `draw`. */
function drawPane(on: On, id: string, draw: Draw) {
  on('ui.render', { component: 'Pane', requestId: id }, ($, e) => draw($.ui.resolve(e), e.surface) as RenderElement)
}

function mount($: Engine, id: string, surface: (typeof SURFACES)[number], columns = 140) {
  return $.ui.mount({ plugin: PRESSER, surface, component: 'Pane', requestId: id, props: paneProps(columns), viewport: { columns, rows: 40 } })
}

// ---- Pure helpers ------------------------------------------------------------------------------

test('view helpers', () => {
  expect(modelName('claude-opus-5-5[1m]')).toBe('Opus 5.5')
  expect(modelName('claude-fable-5-1')).toBe('Fable 5.1')
  expect(modelName('sonnet')).toBe('Sonnet')
  expect(modelName('gpt-6.1-sol')).toBe('gpt-6.1-sol')
  expect(countdown(41 * 60_000, 'en')).toBe('41m')
  expect(countdown(105_000, 'en')).toBe('1:45')
  expect(countdown(0, 'en')).toBe('cold')
  expect(countdown(41 * 60_000, 'ko')).toBe('41분')
  expect(countdown(105_000, 'ko')).toBe('1:45')
  expect(countdown(0, 'ko')).toBe(STRINGS.ko['band.cold'])
  expect(countdown(41 * 60_000, 'es')).toBe('41 min')
  expect(elapsed(12_000, 'en')).toBe('12s')
  expect(elapsed(245_000, 'ko')).toBe('4분 05초')
  expect(elapsed(3_720_000, 'ja')).toBe('1時間02分')
  expect(resetsLabel('2026-10-10T13:45:00', NOW, 'en')).toBe('resets in 25m')
  expect(resetsLabel('2026-10-10T13:45:00', NOW, 'ko')).toBe('25분 뒤 초기화')
  expect(resetsLabel('2026-10-13T13:20:00', NOW, 'zh')).toBe('3天后重置')
  expect(seconds(2.14, 'ko')).toBe('2.1초')
  expect(targetOf(targetValue({ agent: 'general-purpose', model: 'sonnet' }))).toEqual({ agent: 'general-purpose', model: 'sonnet' })
  expect(targetOf('gpt-6-1-sol')).toEqual({ agent: 'gpt-6-1-sol' })
  const record: StatusRequest = { at: '2026-10-10T13:19:10', source: 'gpt-6-1-sol@high', target: 'gpt-6.1-sol', provider: 'chatgpt', status: 200, ok: true, ms: 2140, usage: { input: 3000, cached: 41_000, output: 900 } }
  expect(routeOf(record)).toMatchObject({ model: 'gpt-6.1-sol (gpt-6-1-sol)', cachePct: 93, seconds: 2.14 })
  expect(minutesLeft(41 * 60_000 + 1, 'en')).toBe('42m')
  expect(minutesLeft(41 * 60_000, 'en')).toBe('41m')
  expect(minutesLeft(30_000, 'ko')).toBe('1분')
  expect(minutesLeft(0, 'en')).toBe('cold')
  // The shown minute changes exactly when a whole minute is left, and at expiry.
  expect(nextMinuteChange(NOW + 41 * 60_000 + 30_000, NOW)).toBe(NOW + 30_000)
  expect(nextMinuteChange(NOW + 41 * 60_000, NOW)).toBe(NOW + 60_000)
  expect(nextMinuteChange(NOW + 20_000, NOW)).toBe(NOW + 20_000)
  expect(nextMinuteChange(NOW, NOW)).toBe(null)
})

// ---- Band --------------------------------------------------------------------------------------

test('the band draws on both surfaces and its controls reach their callbacks', async ($, on) => {
  const { calls, fn } = recorder()
  const actions = {
    toggleAuto: fn('auto'), toggleWarm: fn('warm'), compact: fn('compact'), handoff: fn('handoff'), toggleLog: fn('log'),
    toggleAgents: fn('agents'), openSettings: fn('settings'), toggleEffortMenu: fn('menu'), pickEffort: fn('pick'),
  }
  drawPane(on, 'band', (el, surface) => renderBand(el, frameOf(surface), DASH, actions))
  drawPane(on, 'band-busy', (el, surface) =>
    renderBand(el, frameOf(surface), { ...DASH, effort: { level: null, mode: 'deciding', since: NOW - 500 }, warm: { on: true, pings: 2, cost: 9000 }, limit: { kind: 'five_hour', percent: 86, resetsAt: '2026-10-10T15:40:00', save: true }, handoff: 'advised', agents: { live: 2, total: 3 }, effortMenu: true }, actions),
  )
  for (const surface of SURFACES) {
    const ui = await mount($, 'band', surface)
    // Compact left the band (it is /compact and the alerts' choice).
    expect(await ui.find({ key: 'compact' })).toBeUndefined()
    // The desktop's Log is the route itself.
    for (const key of surface === 'terminal' ? ['auto', 'warm', 'log', 'agents', 'settings'] : ['auto', 'warm', 'agents', 'settings']) {
      expect(await ui.find({ type: 'Button', key }), "ui { type: 'Button', key } " + surface).toBeDefined()
      await ui.press({ key })
    }
    // One picture at most, 리플이, as a plain image: the desktop draws each answer afresh, and an
    // interactive picture (a frame) reloads blank each time; an image of the same source does not.
    const pictures = await ui.findAll({ type: 'Svg' })
    expect(pictures.length).toBeLessThanOrEqual(1)
    for (const picture of pictures) expect(picture.props.isInteractive).toBeFalsy()
    if (surface === 'terminal') {
      expect((await ui.find({ key: 'auto' }))?.props.hotkey).toBe('a')
      expect(await ui.find({ type: 'Text', text: 'gpt-6.1-sol' }), "ui { type: 'Text', text: 'gpt-6.1-sol' } " + surface).toBeDefined()
    } else {
      expect((await ui.find({ type: 'Button', key: 'route' }))?.props.label).toBe('gpt-6.1-sol')
      expect((await ui.find({ type: 'Button', key: 'effort' }))?.props.label).toBe('High')
      // What captions said is in the hover cards.
      expect(await ui.find({ type: 'Text', text: 'Opus 5.5 · Auto' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^Effort High — multi-file refactor/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^Last route: gpt-6.1-sol via chatgpt, high, cache 96%/ })).toBeDefined()
      // The route opens the log too; the effort its menu.
      await ui.press({ key: 'route' })
      await ui.press({ key: 'effort' })
    }
    await ui.unmount()

    const busy = await mount($, 'band-busy', surface)
    expect(await busy.find({ key: 'handoff' }), "busy { key: 'handoff' } " + surface).toBeDefined()
    expect(await busy.find({ key: 'compact' })).toBeUndefined()
    await busy.press({ key: 'handoff' })
    await busy.press({ key: 'pick-low' })
    if (surface === 'desktop') {
      expect((await busy.find({ type: 'Button', key: 'effort' }))?.props.label).toBe('Deciding…')
      expect(await busy.find({ type: 'Text', text: /keep-warm on, 2 pings/ })).toBeDefined()
      expect(await busy.find({ type: 'Text', text: '2' })).toBeDefined()
    } else {
      expect(await busy.find({ type: 'Text', text: /deciding/ }), "busy { type: 'Text', text: /deciding/ } " + surface).toBeDefined()
    }
    await busy.unmount()
  }
  expect(calls.filter(c => c === 'auto').length).toBe(2)
  expect(calls.filter(c => c === 'log').length).toBe(2)
  expect(calls.filter(c => c === 'menu').length).toBe(1)
  expect(calls.filter(c => c === 'pick:["low"]').length).toBe(2)
  expect(calls.filter(c => c === 'handoff').length).toBe(2)
})

test('the band draws the same markup for the same view', async ($, on) => {
  const noop = () => undefined
  const actions = { toggleAuto: noop, toggleWarm: noop, compact: noop, handoff: noop, toggleLog: noop, toggleAgents: noop, openSettings: noop, toggleEffortMenu: noop, pickEffort: noop }
  drawPane(on, 'band', (el, surface) => renderBand(el, frameOf(surface), { ...DASH, effort: { level: 'medium', mode: 'deciding', since: NOW - 300 } }, actions))
  const once = await mount($, 'band', 'desktop')
  const first = JSON.stringify(await once.drawn())
  await once.unmount()
  const second = JSON.stringify(await (await mount($, 'band', 'desktop')).drawn())
  expect(first.replace(/"handle":\d+/g, '')).toBe(second.replace(/"handle":\d+/g, ''))
})

test('the terminal band fits its rows at narrow widths', async ($, on) => {
  const noop = () => undefined
  const actions = { toggleAuto: noop, toggleWarm: noop, compact: noop, handoff: noop, toggleLog: noop, toggleAgents: noop, openSettings: noop, toggleEffortMenu: noop, pickEffort: noop }
  const busy: DashboardView = { ...DASH, warm: { on: true, pings: 3, cost: 0 }, limit: { kind: 'seven_day', percent: 91, save: false } }
  drawPane(on, 'wide', el => renderBand(el, frameOf('terminal', 200, 3), busy, actions))
  drawPane(on, 'narrow', el => renderBand(el, frameOf('terminal', 60, 4), busy, actions))
  const wide = (await (await mount($, 'wide', 'terminal', 200)).drawn()) as { children: unknown[] }
  const narrow = (await (await mount($, 'narrow', 'terminal', 60)).drawn()) as { children: unknown[] }
  expect(wide.children.length <= 3).toBe(true)
  expect(narrow.children.length <= 4).toBe(true)
})

test('the minimal footer draws on both surfaces', async ($, on) => {
  const { calls, fn } = recorder()
  drawPane(on, 'footer', (el, surface) => renderFooter(el, frameOf(surface), DASH, { toggleAuto: fn('auto'), openSettings: fn('settings') }, 'focus'))
  for (const surface of SURFACES) {
    const ui = await mount($, 'footer', surface)
    expect(await ui.find({ type: 'Text', text: /high/ }), "ui { type: 'Text', text: /high/ } " + surface).toBeDefined()
    await ui.press({ key: 'settings' })
  }
  expect(calls).toEqual(['settings', 'settings'])
})

test('a ko frame resolves temporary Korean text in labels and hover cards', async ($, on) => {
  const original = { ...STRINGS.ko }
  const noop = () => undefined
  const actions = { toggleAuto: noop, toggleWarm: noop, compact: noop, handoff: noop, toggleLog: noop, toggleAgents: noop, openSettings: noop, toggleEffortMenu: noop, pickEffort: noop }
  try {
    STRINGS.ko['band.auto'] = '자동'
    STRINGS.ko['band.high'] = '높음'
    STRINGS.ko['band.effortTitle'] = '강도 {value}{hint} · 선택'
    STRINGS.ko['band.effortAlt'] = '강도 {value} ({mode}){why}'
    drawPane(on, 'ko-band', (el, surface) => renderBand(el, { ...frameOf(surface), lang: 'ko' }, DASH, actions))
    const terminal = await mount($, 'ko-band', 'terminal')
    expect((await terminal.find({ key: 'auto' }))?.props.label).toBe('자동 ●')
    expect(await terminal.find({ type: 'Text', text: /높음/ })).toBeDefined()
    await terminal.unmount()
    const desktop = await mount($, 'ko-band', 'desktop')
    expect((await desktop.find({ type: 'Button', key: 'effort' }))?.props.label).toBe('높음')
    expect((await desktop.find({ type: 'Button', key: 'auto' }))?.props.label).toBe('자동')
    expect(await desktop.find({ type: 'Text', text: /^강도 높음 — multi-file refactor · 선택$/ })).toBeDefined()
    await desktop.unmount()
  } finally { Object.assign(STRINGS.ko, original) }
})

// ---- Alerts ------------------------------------------------------------------------------------

const ALERTS: AlertView[] = [
  { kind: 'cold', tokens: 182_000, idleMinutes: 74 },
  { kind: 'swamp', percent: 63, tokens: 126_000 },
  { kind: 'hot', limitKind: 'five_hour', percent: 86, resetsAt: '2026-10-10T15:40:00', save: false },
  { kind: 'judgeDown', judge: 'jev', reason: 'key rejected (401)' },
  { kind: 'result', stage: 'handingOff', handoffKind: 'quick' },
  { kind: 'result', stage: 'handoffDone' },
  { kind: 'result', stage: 'compacting' },
  { kind: 'result', stage: 'compacted' },
  { kind: 'result', stage: 'failed', detail: 'Haiku timed out' },
  { kind: 'compactNote', draft: '' },
  { kind: 'handoffChoice', handoffKind: 'quick', after: 'continue' },
]

test('every alert draws on both surfaces', async ($, on) => {
  const noop = () => undefined
  const actions = { compact: noop, handoff: noop, dismiss: noop, toggleSave: noop, openSettings: noop, noteInput: noop, setHandoffKind: noop, setHandoffAfter: noop, go: noop, copy: noop }
  ALERTS.forEach((alert, i) => drawPane(on, 'alert-' + i, (el, surface) => renderAlert(el, frameOf(surface), alert, actions)))
  for (const surface of SURFACES) {
    for (let i = 0; i < ALERTS.length; i++) {
      const ui = await mount($, 'alert-' + i, surface)
      expect(await ui.drawn()).toBeDefined()
      await ui.unmount()
    }
  }
})

test('alert choices reach their callbacks', async ($, on) => {
  const { calls, fn } = recorder()
  const actions = {
    compact: fn('compact'), handoff: fn('handoff'), dismiss: fn('dismiss'), toggleSave: fn('save'), openSettings: fn('settings'), noteInput: fn('note'),
    setHandoffKind: fn('kind'), setHandoffAfter: fn('after'), go: fn('go'), copy: fn('copy'),
  }
  drawPane(on, 'cold', (el, surface) => renderAlert(el, frameOf(surface), ALERTS[0]!, actions))
  drawPane(on, 'hot', (el, surface) => renderAlert(el, frameOf(surface), ALERTS[2]!, actions))
  drawPane(on, 'note', (el, surface) => renderAlert(el, frameOf(surface), { kind: 'compactNote', draft: '' }, actions))
  drawPane(on, 'choice', (el, surface) => renderAlert(el, frameOf(surface), ALERTS[10]!, actions))
  for (const surface of SURFACES) {
    const cold = await mount($, 'cold', surface)
    await cold.press({ key: 'compact' })
    await cold.press({ key: 'handoff' })
    await cold.press({ key: 'dismiss' })
    const hot = await mount($, 'hot', surface)
    await hot.press({ key: 'save' })
    const note = await mount($, 'note', surface)
    await note.input({ key: 'note', text: 'keep the API decision' })
    const choice = await mount($, 'choice', surface)
    await choice.press({ key: 'kind-full' })
    await choice.press({ key: 'after-copy' })
    await choice.press({ key: 'go' })
  }
  const once = ['compact', 'handoff', 'dismiss', 'save', 'compact:["keep the API decision"]', 'kind:["full"]', 'after:["copy"]', 'go']
  expect(calls).toEqual([...once, ...once])
})

/** The mascot pictures in a drawn tree: the Svgs on its 56 grid. */
function mascots(tree: unknown): Drawn[] {
  const out: Drawn[] = []
  walk(tree, n => {
    if (n.type === 'Svg' && String(n.props?.source).includes('viewBox="0 0 56 56"')) out.push(n)
  })
  return out
}

test('each alert shows 리플이 with the face of its state, its gauge in 5% steps; the terminal keeps a text mark', async ($, on) => {
  const noop = () => undefined
  const actions = { compact: noop, handoff: noop, dismiss: noop, toggleSave: noop, openSettings: noop, noteInput: noop, setHandoffKind: noop, setHandoffAfter: noop, go: noop, copy: noop }
  const variants: [string, AlertView][] = [
    ['swamp-59', { kind: 'swamp', percent: 59, tokens: 118_000 }],
    ['swamp-61', { kind: 'swamp', percent: 61, tokens: 122_000 }],
    ['swamp-66', { kind: 'swamp', percent: 66, tokens: 132_000 }],
    ['hot-94', { kind: 'hot', limitKind: 'five_hour', percent: 94, save: false }],
    ['hot-95', { kind: 'hot', limitKind: 'five_hour', percent: 95, save: false }],
  ]
  ALERTS.forEach((alert, i) => drawPane(on, 'face-' + i, (el, surface) => renderAlert(el, frameOf(surface), alert, actions)))
  for (const [id, alert] of variants) drawPane(on, id, (el, surface) => renderAlert(el, frameOf(surface), alert, actions))
  const sources: string[] = []
  for (let i = 0; i < ALERTS.length; i++) {
    const ui = await mount($, 'face-' + i, 'desktop')
    const found = mascots(await ui.drawn())
    expect(found.length, 'alert ' + i).toBe(1)
    expect(found[0]!.props?.width).toBe(44)
    // An image, not a frame: the desktop rebuilds a frame blank on each redraw.
    expect(found[0]!.props?.isInteractive, 'alert ' + i).toBeFalsy()
    sources.push(String(found[0]!.props?.source))
    await ui.unmount()
    const terminal = await mount($, 'face-' + i, 'terminal')
    expect(mascots(await terminal.drawn()).length).toBe(0)
    await terminal.unmount()
  }
  // handoffDone and compacted share the pleased face, compactNote and handoffChoice the asking
  // one; every other state has its own.
  expect(new Set(sources).size).toBe(ALERTS.length - 2)
  const source = async (id: string) => {
    const ui = await mount($, id, 'desktop')
    const s = String(mascots(await ui.drawn())[0]?.props?.source)
    await ui.unmount()
    return s
  }
  expect(await source('swamp-59')).toBe(await source('swamp-61'))
  expect(await source('swamp-61') === await source('swamp-66')).toBe(false)
  expect((await source('hot-94')).includes('fill="var(--warn)"')).toBe(true)
  expect((await source('hot-95')).includes('fill="var(--bad)"')).toBe(true)
  const terminal = await mount($, 'hot-95', 'terminal')
  expect(await terminal.find({ type: 'Text', text: /^✕ / })).toBeDefined()
})

test('리플이 greets in setup and quick settings and waits in empty panes, never among running agents', async ($, on) => {
  const noop = () => undefined
  const setupActions = { patch: noop, jevKey: noop, testJev: noop, openAllSettings: noop, back: noop, next: noop, finish: noop, skip: noop }
  drawPane(on, 'm-setup-1', (el, surface) => renderSetup(el, frameOf(surface), { step: 1, draft: SETTINGS, jev: { source: 'env', test: { state: 'idle' } } }, setupActions))
  drawPane(on, 'm-setup-4', (el, surface) => renderSetup(el, frameOf(surface), { step: 4, draft: SETTINGS, jev: { source: 'env', test: { state: 'idle' } } }, setupActions))
  drawPane(on, 'm-quick', (el, surface) => renderSettings(el, frameOf(surface), { settings: SETTINGS, jev: { source: null, test: { state: 'idle' } } }, QUICK_ACTIONS))
  drawPane(on, 'm-agents', (el, surface) => renderAgents(el, frameOf(surface, 64), { agents: AGENTS, now: NOW, showDone: true }, { toggleDone: noop }))
  drawPane(on, 'm-agents-empty', (el, surface) => renderAgents(el, frameOf(surface, 64), { agents: [], now: NOW, showDone: false }, { toggleDone: noop }))
  drawPane(on, 'm-log-empty', (el, surface) => renderLog(el, frameOf(surface, 64), { rows: [], mineOnly: true }, { toggleScope: noop }))
  // It greets and waits bigger (56 px) than it speaks on a card (44 px).
  const expected: [string, number, string, number][] = [['m-setup-1', 1, 'var(--accent)', 56], ['m-setup-4', 1, 'var(--ok)', 56], ['m-quick', 1, 'var(--accent)', 44], ['m-agents', 0, '', 0], ['m-agents-empty', 1, 'var(--accent)', 56], ['m-log-empty', 1, 'var(--accent)', 56]]
  for (const [id, count, tone, size] of expected) {
    const ui = await mount($, id, 'desktop', 64)
    const found = mascots(await ui.drawn())
    expect(found.length, id).toBe(count)
    if (tone) expect(String(found[0]!.props?.source).includes('stroke="' + tone + '"'), id).toBe(true)
    if (size) expect(found[0]!.props?.width, id).toBe(size)
    await ui.unmount()
    const terminal = await mount($, id, 'terminal', 64)
    expect(mascots(await terminal.drawn()).length, id).toBe(0)
    await terminal.unmount()
  }
})

// ---- Settings and setup ------------------------------------------------------------------------

test('quick settings draw on both surfaces with only session controls', async ($, on) => {
  drawPane(on, 'quick', (el, surface) => renderSettings(el, frameOf(surface), { settings: SETTINGS, jev: { source: null, test: { state: 'idle' } } }, QUICK_ACTIONS))
  drawPane(on, 'quick-off', (el, surface) => renderSettings(el, frameOf(surface), { settings: { ...SETTINGS, effortAuto: false }, jev: { source: null, test: { state: 'idle' } } }, QUICK_ACTIONS))
  for (const surface of SURFACES) {
    const ui = await mount($, 'quick', surface)
    expect((await ui.find({ type: 'Text', text: 'ClaudeRipple' }))?.props.bold).toBe(true)
    expect((await ui.find({ type: 'Text', text: 'Quick settings' }))?.props.dimColor).toBe(true)
    for (const key of ['set-auto', 'bias-2', 'judge-haiku', 'judge-jev', 'judge-model', 'set-warm', 'all-settings', 'close']) expect(await ui.find({ key }), surface + ' ' + key).toBeDefined()
    for (const key of ['save', 'tab-workers', 'floor', 'judge-model', 'jev-source', 'warm-hours', 'worker-next']) {
      if (key === 'judge-model') expect(await ui.find({ type: 'Select', key })).toBeUndefined()
      else expect(await ui.find({ key })).toBeUndefined()
    }
    expect(await ui.find({ type: 'Text', text: '● unsaved' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'not affiliated with Anthropic' })).toBeUndefined()
    await ui.unmount()
    const off = await mount($, 'quick-off', surface)
    expect(await off.find({ key: 'bias-2' })).toBeUndefined()
    await off.unmount()
  }
})

test('quick settings controls reach their callbacks on both surfaces', async ($, on) => {
  const { calls, fn } = recorder()
  const actions = { patch: fn('patch'), jevKey: fn('key'), testJev: fn('test'), openAllSettings: fn('all'), close: fn('close') }
  drawPane(on, 'quick', (el, surface) => renderSettings(el, frameOf(surface), { settings: SETTINGS, jev: { source: null, test: { state: 'idle' } } }, actions))
  for (const surface of SURFACES) {
    const ui = await mount($, 'quick', surface)
    await ui.press({ key: 'set-auto' })
    await ui.press({ key: 'bias-2' })
    await ui.press({ key: 'judge-model' })
    await ui.press({ key: 'set-warm' })
    await ui.input({ key: 'jev-key', text: 'ts-key' })
    await ui.press({ key: 'jev-test' })
    await ui.press({ key: 'all-settings' })
    await ui.press({ key: 'close' })
    await ui.unmount()
  }
  const once = ['patch:[{"effortAuto":false}]', 'patch:[{"bias":2}]', 'patch:[{"judge":"model"}]', 'patch:[{"keepWarm":true}]', 'key:["ts-key"]', 'test', 'all', 'close']
  expect(calls).toEqual([...once, ...once])
})

test('Jev key and Test row appear only for TypeSafe Jev with no known key', async ($, on) => {
  const sources: JevState['source'][] = [null, 'zen', 'env', 'file', 'pasted']
  for (const judge of ['haiku', 'jev', 'model'] as const) {
    for (const jevSource of ['typesafe', 'zen'] as const) {
      for (const source of sources) drawPane(on, [judge, jevSource, source].join('-'), (el, surface) => renderSettings(el, frameOf(surface), { settings: { ...SETTINGS, judge, jevSource }, jev: { source, test: { state: 'idle' } } }, QUICK_ACTIONS))
    }
  }
  for (const surface of SURFACES) {
    for (const judge of ['haiku', 'jev', 'model'] as const) {
      for (const jevSource of ['typesafe', 'zen'] as const) {
        for (const source of sources) {
          const ui = await mount($, [judge, jevSource, source].join('-'), surface)
          const shown = judge === 'jev' && jevSource === 'typesafe' && (source === null || source === 'zen')
          expect(!!await ui.find({ type: 'Input', key: 'jev-key' }), surface + ' ' + [judge, jevSource, source]).toBe(shown)
          expect(!!await ui.find({ key: 'jev-test' })).toBe(shown)
          await ui.unmount()
        }
      }
    }
  }
})

test('setup steps draw on both surfaces and move on', async ($, on) => {
  const { calls, fn } = recorder()
  const actions = { patch: fn('patch'), jevKey: fn('key'), testJev: fn('test'), openAllSettings: fn('all'), back: fn('back'), next: fn('next'), finish: fn('finish'), skip: fn('skip') }
  for (const step of [1, 2, 3, 4] as const) {
    drawPane(on, 'setup-' + step, (el, surface) =>
      renderSetup(el, frameOf(surface), { step, draft: SETTINGS, jev: { source: 'env', test: { state: 'idle' } } }, actions),
    )
  }
  for (const surface of SURFACES) {
    await (await mount($, 'setup-1', surface)).press({ key: 'next' })
    const workers = await mount($, 'setup-2', surface)
    expect(await workers.find({ type: 'Text', text: 'Workers start on Auto; details are on the dashboard.' })).toBeDefined()
    expect(await workers.find({ key: 'rule-mode-auto' })).toBeUndefined()
    await workers.press({ key: 'all-settings' })
    await workers.press({ key: 'back' })
    await (await mount($, 'setup-3', surface)).press({ key: 'set-warm' })
    const done = await mount($, 'setup-4', surface)
    expect(await done.find({ type: 'Text', text: /^Fixed · exceptions: Design → Fixed$/ }), "done { type: 'Text', text: /Fixed · exceptions: Design → Fixed/ } " + surface).toBeDefined()
    expect(await done.find({ type: 'Text', text: 'not affiliated with Anthropic' })).toBeUndefined()
    await done.press({ key: 'finish' })
  }
  const once = ['next', 'all', 'back', 'patch:[{"keepWarm":true}]', 'finish']
  expect(calls).toEqual([...once, ...once])
})

// ---- Panes -------------------------------------------------------------------------------------

const AGENTS: AgentRec[] = [
  {
    id: 'a1',
    description: 'Port the request log renderer',
    type: 'gpt-6-1-sol',
    model: 'gpt-6.1-sol@high',
    pick: { domain: 'frontend', level: 'standard', effort: 'high', sure: 0.8, why: 'designed refactor', target: { agent: 'gpt-6-1-sol' }, by: 'haiku', ms: 900, aa: { intelligence: 50.24, costPerTask: 0.3191 }, runnerUp: { target: { agent: 'gpt-6-astra' }, effort: 'medium', intelligence: 49.6, costPerTask: 1.541 } },
    state: 'running',
    now: 'Edit hooks/ui/log.tsx',
    toolSince: NOW - 14_000,
    startedAt: NOW - 192_000,
    cost: 38_400,
  },
  { id: 'a2', description: 'Summarize the docs', type: 'deepseek-v4-1-flash', state: 'done', startedAt: NOW - 900_000, endedAt: NOW - 800_000, cost: 9000 },
]

test('the Agents pane draws live, finished and empty', async ($, on) => {
  const { calls, fn } = recorder()
  drawPane(on, 'agents', (el, surface) => renderAgents(el, frameOf(surface, 64), { agents: AGENTS, now: NOW, showDone: false }, { toggleDone: fn('done') }))
  drawPane(on, 'agents-open', (el, surface) => renderAgents(el, frameOf(surface, 64), { agents: AGENTS, now: NOW, showDone: true }, { toggleDone: fn('done') }))
  drawPane(on, 'agents-empty', (el, surface) => renderAgents(el, frameOf(surface, 64), { agents: [], now: NOW, showDone: false }, { toggleDone: fn('done') }))
  for (const surface of SURFACES) {
    const ui = await mount($, 'agents', surface, 64)
    expect(await ui.find({ type: 'Text', text: 'Port the request log renderer' }), "ui { type: 'Text', text: 'Port the request log renderer' } " + surface).toBeDefined()
    // The desktop leaves what an agent is doing to the host's task list above the pane.
    if (surface === 'terminal') expect(await ui.find({ type: 'Text', text: /Edit hooks\/ui\/log.tsx/ }), surface).toBeDefined()
    else expect(await ui.find({ type: 'Text', text: /Edit hooks\/ui\/log.tsx/ }), surface).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'Summarize the docs' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Frontend \/ Standard/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /index 50.2.*\$0.32\/task.*next:.*Data: Artificial Analysis/ })).toBeDefined()
    await ui.press({ key: 'done' })
    const open = await mount($, 'agents-open', surface, 64)
    expect(await open.find({ type: 'Text', text: 'Summarize the docs' }), "open { type: 'Text', text: 'Summarize the docs' } " + surface).toBeDefined()
    const empty = await mount($, 'agents-empty', surface, 64)
    expect(await empty.find({ type: 'Text', text: 'No agents yet' }), "empty { type: 'Text', text: 'No agents yet' } " + surface).toBeDefined()
  }
  expect(calls).toEqual(['done', 'done'])
})

test('the log pane lists this session\'s verdicts among its requests, a fallback in plain words', async ($, on) => {
  const rows: StatusRequest[] = [{ at: '2026-10-10T13:19:10', source: 'claude-opus-5-5', target: 'claude-opus-5-5', provider: 'anthropic', status: 200, ok: true, ms: 19_400, effort: 'low', mine: true }]
  const judges = [
    { at: Date.parse('2026-10-10T13:19:09'), for: 'prompt' as const, asked: 'jev' as const, by: 'jev' as const, ms: 610, effort: 'low' as const, sure: 0.94 },
    { at: Date.parse('2026-10-10T13:20:00'), for: 'prompt' as const, asked: 'jev' as const, by: 'haiku' as const, ms: 3400, effort: 'medium' as const, error: 'Jev timed out' },
  ]
  drawPane(on, 'log-judges', (el, surface) => renderLog(el, frameOf(surface, 80), { rows, mineOnly: true, judges }, { toggleScope: () => undefined }))
  drawPane(on, 'log-all', (el, surface) => renderLog(el, frameOf(surface, 80), { rows, mineOnly: false, judges }, { toggleScope: () => undefined }))
  for (const surface of SURFACES) {
    const ui = await mount($, 'log-judges', surface, 80)
    expect(await ui.find({ type: 'Text', text: 'Effort judge' }), surface).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /sure 94%/ }), surface).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Jev failed → Haiku' }), surface).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Jev timed out' }), surface).toBeDefined()
    // Newest first: the fallback, the request, then the verdict that preceded it.
    const order: string[] = []
    walk(await ui.drawn(), n => { const text = (n.children ?? []).join(''); if (n.type === 'Text' && /^(Jev failed → Haiku|claude-opus-5-5|Jev)$/.test(text)) order.push(text) })
    expect(order).toEqual(['Jev failed → Haiku', 'claude-opus-5-5', 'Jev'])
    // Another session's requests have no verdicts of ours beside them.
    const all = await mount($, 'log-all', surface, 80)
    expect(await all.find({ type: 'Text', text: 'Effort judge' }), surface).toBeUndefined()
  }
})

test('the log pane keeps its content', async ($, on) => {
  const { calls, fn } = recorder()
  const rows: StatusRequest[] = [
    { at: '2026-10-10T13:19:10', source: 'gpt-6-1-sol@high', target: 'gpt-6.1-sol', provider: 'chatgpt', status: 200, ok: true, ms: 2140, effort: 'high', usage: { input: 3000, cached: 41_000, output: 900 }, mine: true },
    { at: '2026-10-10T13:18:55', source: 'deepseek-v4.1-flash', target: 'deepseek-v4.1-flash', provider: 'opencode-go', status: 429, ok: false, ms: 310, note: 'rate limited', mine: false },
  ]
  drawPane(on, 'log', (el, surface) => renderLog(el, frameOf(surface, 64), { rows, mineOnly: false }, { toggleScope: fn('scope') }))
  drawPane(on, 'log-empty', (el, surface) => renderLog(el, frameOf(surface, 64), { rows: [], mineOnly: true }, { toggleScope: fn('scope') }))
  for (const surface of SURFACES) {
    const ui = await mount($, 'log', surface, 64)
    expect(await ui.find({ type: 'Text', text: 'gpt-6.1-sol (gpt-6-1-sol)' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'cache 93%' }), "ui { type: 'Text', text: 'cache 93%' } " + surface).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'in 44.0k' }), "ui { type: 'Text', text: 'in 44.0k' } " + surface).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '✕ 429' }), "ui { type: 'Text', text: '✕ 429' } " + surface).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'rate limited' }), "ui { type: 'Text', text: 'rate limited' } " + surface).toBeDefined()
    await ui.press({ key: 'scope' })
    const empty = await mount($, 'log-empty', surface, 64)
    expect(await empty.find({ type: 'Text', text: 'No model requests yet.' }), "empty { type: 'Text', text: 'No model requests yet.' } " + surface).toBeDefined()
  }
  expect(calls).toEqual(['scope', 'scope'])
})

// ---- Nothing cut, nothing reloaded (2026-10-10) -------------------------------------------------

type Drawn = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
function walk(node: unknown, visit: (n: Drawn) => void): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { for (const child of node) walk(child, visit); return }
  const n = node as Drawn
  visit(n)
  for (const child of n.children ?? []) walk(child, visit)
}
/** Each pressable chip: its picture's width and its blank hit label. */
function chips(tree: unknown): { key: string; width: number; label: string }[] {
  const out: { key: string; width: number; label: string }[] = []
  walk(tree, n => {
    const [picture, layer] = n.children ?? []
    if (n.type !== 'Box' || (picture as Drawn)?.type !== 'Svg') return
    walk(layer, b => {
      const label = b.props?.label
      if (b.type === 'Button' && typeof label === 'string' && /^\u00a0+$/.test(label)) out.push({ key: String(b.props?.key), width: Number((picture as Drawn).props?.width), label })
    })
  })
  return out
}

test('리플이 is the one picture: every control is a native button, none a picture with a blank label over it', async ($, on) => {
  // Each Svg is a new <img> or <iframe> on every desktop redraw (parts.tsx), and a blank label laid
  // over a picture had to be sized against the host's font or it was cut to "…" (2026-10-10).
  const noop = () => undefined
  const setupActions = { patch: noop, jevKey: noop, testJev: noop, openAllSettings: noop, back: noop, next: noop, finish: noop, skip: noop }
  const alertActions = { compact: noop, handoff: noop, dismiss: noop, toggleSave: noop, openSettings: noop, noteInput: noop, setHandoffKind: noop, setHandoffAfter: noop, go: noop, copy: noop }
  const cases: [string, Draw][] = [
    ['one-quick', (el, surface) => renderSettings(el, frameOf(surface, 64, 30), { settings: { ...SETTINGS, jevSource: 'typesafe' }, jev: { source: null, test: { state: 'idle' } } }, QUICK_ACTIONS)],
    ...([1, 2, 3, 4] as const).map((step): [string, Draw] => ['one-setup-' + step, (el, surface) => renderSetup(el, frameOf(surface, 64, 30), { step, draft: SETTINGS, jev: { source: null, test: { state: 'idle' } } }, setupActions)]),
    ...ALERTS.map((alert, i): [string, Draw] => ['one-alert-' + i, (el, surface) => renderAlert(el, frameOf(surface, 60), alert, alertActions)]),
    ['one-hot-save', (el, surface) => renderAlert(el, frameOf(surface, 60), { kind: 'hot', limitKind: 'five_hour', percent: 97, save: true }, alertActions)],
  ]
  for (const [id, draw] of cases) drawPane(on, id, draw)
  for (const [id] of cases) {
    const ui = await mount($, id, 'desktop', 64)
    const tree = await ui.drawn()
    let pictures = 0
    walk(tree, n => { if (n.type === 'Svg') pictures++ })
    expect(pictures, id).toBe(1)
    expect(mascots(tree).length, id).toBe(1)
    expect(chips(tree), id).toEqual([])
    await ui.unmount()
  }
})

test('a card says one thing: the title in ink, at most one main action, the others quiet, the host’s × to let it go', async ($, on) => {
  const noop = () => undefined
  const alertActions = { compact: noop, handoff: noop, dismiss: noop, toggleSave: noop, openSettings: noop, noteInput: noop, setHandoffKind: noop, setHandoffAfter: noop, go: noop, copy: noop }
  const all: AlertView[] = [...ALERTS, { kind: 'hot', limitKind: 'five_hour', percent: 97, save: true }]
  all.forEach((alert, i) => drawPane(on, 'say-' + i, (el, surface) => renderAlert(el, frameOf(surface), alert, alertActions)))
  for (let i = 0; i < all.length; i++) {
    const ui = await mount($, 'say-' + i, 'desktop')
    const buttons: Drawn[] = []
    walk(await ui.drawn(), n => { if (n.type === 'Button') buttons.push(n) })
    const main = buttons.filter(b => b.props?.variant === 'primary')
    const closes = buttons.filter(b => b.props?.role === 'dismiss')
    const others = buttons.filter(b => b.props?.variant !== 'primary' && b.props?.role !== 'dismiss')
    expect(main.length <= 1, 'alert ' + i).toBe(true)
    expect(closes.length <= 1, 'alert ' + i).toBe(true)
    // Quiet: dim at rest; an option says whether it is chosen in its mark, not its dimness alone.
    for (const b of others) expect(b.props?.dimColor === true || /^● /.test(String(b.props?.label)), 'alert ' + i + ' ' + String(b.props?.key)).toBe(true)
    // The title (the first bold Text) takes no colour: 리플이's face is the card's colour.
    let title: Drawn | undefined
    walk(await ui.drawn(), n => { if (!title && n.type === 'Text' && n.props?.bold) title = n })
    expect(title?.props?.color, 'alert ' + i).toBeUndefined()
    await ui.unmount()
  }
  // Save mode on: nothing left to press but turning it off, quietly.
  const on_ = await mount($, 'say-' + (all.length - 1), 'desktop')
  expect((await on_.find({ type: 'Button', key: 'save' }))?.props).toMatchObject({ label: 'Turn save mode off', dimColor: true })
  expect((await on_.find({ type: 'Button', key: 'dismiss' }))?.props.role).toBe('dismiss')
})

test('no drawing cuts its text: no truncating Text on any surface', async ($, on) => {
  const noop = () => undefined
  const settingsActions = QUICK_ACTIONS
  const cases: [string, Draw][] = [
    ['cut-quick', (el, surface) => renderSettings(el, frameOf(surface, 60, 30), { settings: SETTINGS, jev: { source: null, test: { state: 'fail', message: 'key rejected (401) '.repeat(4) } } }, settingsActions)],
    ['cut-agents', (el, surface) => renderAgents(el, frameOf(surface, 40), { agents: AGENTS.map(a => ({ ...a, description: a.description + ' and a much longer tail of words that runs past any pane width', state: 'running' as const })), now: NOW, showDone: true }, { toggleDone: noop })],
    ['cut-agents-done', (el, surface) => renderAgents(el, frameOf(surface, 40), { agents: AGENTS, now: NOW, showDone: true }, { toggleDone: noop })],
    ['cut-log', (el, surface) => renderLog(el, frameOf(surface, 40), { rows: [{ at: '2026-10-10T13:19:10', source: 'a-very-long-requested-model-name@high', target: 'another-very-long-routed-model-name', provider: 'opencode-go', status: 200, ok: true, ms: 2140 }], mineOnly: false }, { toggleScope: noop })],
    ...ALERTS.map((alert, i): [string, Draw] => ['cut-alert-' + i, (el, surface) => renderAlert(el, frameOf(surface, 40), alert, { compact: noop, handoff: noop, dismiss: noop, toggleSave: noop, openSettings: noop, noteInput: noop, setHandoffKind: noop, setHandoffAfter: noop, go: noop, copy: noop })]),
  ]
  for (const [id, draw] of cases) drawPane(on, id, draw)
  for (const surface of SURFACES) {
    for (const [id] of cases) {
      const ui = await mount($, id, surface, 40)
      walk(await ui.drawn(), n => {
        if (n.type === 'Text') expect(String(n.props?.wrap ?? 'wrap').startsWith('truncate'), id + ' ' + surface).toBe(false)
      })
      await ui.unmount()
    }
  }
})

// ---- The band holds still (2026-10-10) ----------------------------------------------------------

const BAND_ACTIONS = { toggleAuto: () => undefined, toggleWarm: () => undefined, compact: () => undefined, handoff: () => undefined, toggleLog: () => undefined, toggleAgents: () => undefined, openSettings: () => undefined, toggleEffortMenu: () => undefined, pickEffort: () => undefined }
const unhandled = (tree: unknown) => JSON.stringify(tree).replace(/"handle":\d+/g, '')

test('within a minute the band draws the same tree; a minute on, only the countdown changes', async ($, on) => {
  const view: DashboardView = { ...DASH, cache: { expiresAt: NOW + 41 * 60_000 + 30_000, ttlMs: 3_600_000 }, effort: { level: null, mode: 'deciding', since: NOW - 300 } }
  for (const surface of SURFACES) {
    drawPane(on, 'now-' + surface, el => renderBand(el, frameOf(surface), view, BAND_ACTIONS))
    // Twenty-nine seconds on, the judge further along: the same minute shown, so the same tree.
    drawPane(on, 'later-' + surface, el => renderBand(el, { ...frameOf(surface), now: NOW + 29_000 }, { ...view, effort: { ...view.effort, since: NOW - 2_000 } }, BAND_ACTIONS))
    drawPane(on, 'minute-' + surface, el => renderBand(el, { ...frameOf(surface), now: NOW + 31_000 }, view, BAND_ACTIONS))
  }
  for (const surface of SURFACES) {
    const drawn = async (id: string) => unhandled(await (await mount($, id, surface)).drawn())
    const now = await drawn('now-' + surface)
    expect(now).toContain('"42m"')
    expect(await drawn('later-' + surface)).toBe(now)
    expect((await drawn('minute-' + surface)).replace(/\b41m\b/g, '42m')).toBe(now)
  }
})

/** Each fact's slot width and each control's label, by key, as drawn. */
function layoutOf(tree: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  walk(tree, n => {
    const key = String(n.props?.key ?? '')
    if (n.type === 'Box' && key.startsWith('fact-')) out[key] = n.props?.width
    if (n.type === 'Button' && ['auto', 'warm', 'log', 'agents', 'settings'].includes(key)) out[key] = typeof n.props?.label === 'string' ? [...n.props.label].map(c => (/[●○·0-9]/.test(c) ? '#' : c)).join('') : n.props?.label
  })
  return out
}

test('no value moves a neighbour: every slot keeps its width whatever it shows', async ($, on) => {
  const levels: DashboardView['effort'][] = [
    ...(['low', 'medium', 'high', 'xhigh', 'max'] as const).flatMap(level => [{ level, mode: 'auto' as const, why: 'w' }, { level, mode: 'manual' as const }]),
    { level: null, mode: 'deciding' }, { level: 'high', mode: 'paused' }, { level: null, mode: 'off' },
  ]
  const caches: DashboardView['cache'][] = [{ expiresAt: NOW + 3_600_000, ttlMs: 3_600_000 }, { expiresAt: NOW + 9 * 60_000, ttlMs: 3_600_000 }, { expiresAt: NOW + 20_000, ttlMs: 300_000 }, { expiresAt: NOW - 1, ttlMs: 300_000 }, null]
  const routes: Pick<DashboardView, 'route' | 'notice'>[] = [
    { route: DASH.route, notice: null },
    { route: { ...DASH.route!, model: 'a-very-long-routed-model-name (and-what-was-asked)', cachePct: 100 }, notice: null },
    { route: { ...DASH.route!, ok: false, status: '429', cachePct: undefined }, notice: null },
    { route: { ...DASH.route!, ok: false, resent: true, status: '529' }, notice: null },
    { route: null, notice: 'ClaudeRipple: router not answering' },
  ]
  const views: DashboardView[] = [
    ...levels.map(effort => ({ ...DASH, effort })),
    ...caches.map(cache => ({ ...DASH, cache })),
    ...routes.map(r => ({ ...DASH, ...r })),
    { ...DASH, agents: { live: 2, total: 3 }, agentsOpen: true, logOpen: true, auto: false, warm: { on: true, pings: 12, cost: 0, stopped: 'no cache' } },
    { ...DASH, handoff: 'advised', context: { percent: 100, tokens: 200_000, window: 200_000 } },
  ]
  const LANGS = ['en', 'ko', 'ja', 'es'] as const
  for (const lang of LANGS) {
    for (const surface of SURFACES) {
      // A terminal wide enough for the reason's slot, a desktop band of ~1000 px.
      for (const [i, view] of views.entries()) drawPane(on, lang + '-' + surface + '-' + i, el => renderBand(el, { ...frameOf(surface, surface === 'terminal' ? 200 : 110), lang }, view, BAND_ACTIONS))
    }
  }
  for (const lang of LANGS) {
    for (const surface of SURFACES) {
      const seen: Record<string, unknown> = {}
      for (let i = 0; i < views.length; i++) {
        const ui = await mount($, lang + '-' + surface + '-' + i, surface, 110)
        for (const [key, value] of Object.entries(layoutOf(await ui.drawn()))) {
          if (key in seen) expect(value, lang + ' ' + surface + ' view ' + i + ' ' + key).toEqual(seen[key])
          else seen[key] = value
        }
        await ui.unmount()
      }
      // A wide enough terminal keeps a slot for the reason, blank while there is none.
      const why = surface === 'terminal' ? ['fact-why'] : []
      expect(Object.keys(seen).sort()).toEqual(['agents', 'auto', 'fact-cache', 'fact-context', 'fact-effort', 'fact-route', ...why, ...(surface === 'terminal' ? ['log'] : []), 'settings', 'warm'])
    }
  }
})

test('the desktop band is one row at 700 px in Korean and Chinese, 770 px in English and Japanese, 870 px in Spanish and Portuguese, Handoff advised', async ($, on) => {
  // 700 px is 79 ch of the host's 14 px sans; the close control beside the band takes its share.
  // The facts' names (Effort, Cache) and the word Settings cost the Latin and kana labels the most.
  // The row wraps only where the host's real widths leave the facts less than their group's least
  // width: that least width plus the controls' cells must fit, and the route must be there.
  // Narrower than that, the controls wrap under the facts.
  const busy: DashboardView = { ...DASH, effort: { level: 'xhigh', mode: 'manual' }, handoff: 'advised', agents: { live: 2, total: 3 }, warm: { on: true, pings: 3, cost: 0 } }
  const langs = Object.keys(STRINGS) as (keyof typeof STRINGS)[]
  for (const lang of langs) {
    const frame = { ...frameOf('desktop', 79), lang }
    drawPane(on, 'row-' + lang, el => renderBand(el, { ...frame, columns: frame.columns - besideBand(frame) }, busy, BAND_ACTIONS))
  }
  for (const lang of langs) {
    const ui = await mount($, 'row-' + lang, 'desktop', 79)
    const least = Number((await ui.find({ type: 'Box', key: 'band-facts' }))?.props.minWidth)
    // Each control: its label (Hangul and kana 1.36 ch, measured 2026-10-10), the host's padding
    // (2), the gap (1); the agents' count slot (2).
    let controls = 2
    walk(await ui.drawn(), n => {
      if (n.type === 'Button' && ['handoff', 'auto', 'warm', 'log', 'agents', 'settings'].includes(String(n.props?.key))) controls += [...String(n.props?.label)].reduce((w, c) => w + (/[ᄀ-ᇿ　-鿿가-힯＀-￯]/.test(c) ? 1.36 : 0.9), 0) + 3
    })
    expect(least + controls, lang).toBeLessThanOrEqual((lang === 'es' || lang === 'pt' ? 99 : lang === 'en' || lang === 'ja' ? 87 : 79) - 5)
    expect(await ui.find({ type: 'Box', key: 'fact-route' }), lang).toBeDefined()
    await ui.unmount()
  }
})
