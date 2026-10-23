import { expect, test } from 'claude-code/testing'
import type { RenderElement, RenderPropsOf } from 'claude-code'
import { renderBand, renderFooter } from '../hooks/ui/band'
import type { BandActions, DashboardView, Frame } from '../hooks/ui/view'

const noop = () => undefined
const actions: BandActions = { toggleAuto: noop, toggleWarm: noop, compact: noop, clear: noop, handoff: noop, toggleLog: noop, toggleAgents: noop, openSettings: noop, toggleEffortMenu: noop, pickEffort: noop }
const view: DashboardView = {
  effort: { level: 'high', mode: 'auto' }, model: 'Opus', context: null, cache: null,
  warm: { on: false, pings: 0, cost: 0 }, limit: null, route: null, notice: null,
  auto: true, handoff: 'off', agents: { live: 0, total: 0 }, compactions: 0,
  logOpen: false, agentsOpen: false, effortMenu: false, swampAt: 50, hide: [], extras: [], isWorking: false,
}
const props: RenderPropsOf['Pane'] = { title: 'pin', isFocused: true, bodyColumns: 100, placement: 'inline', scroll: { offset: 0, bodyRows: 30 }, view: {} } as RenderPropsOf['Pane']

test('pin chip and one-press release appear only while pinned in band and minimal footer', async ($, on) => {
  let releases = 0
  on('ui.render', { component: 'Pane' }, ($, e) => {
    const pinned = e.requestId?.includes('pinned')
    const frame: Frame = { surface: e.surface, columns: 100, maxRows: 12, now: 0, appearance: 'auto', skin: 'deep', lang: 'ko' }
    const state = { ...view, ...(pinned ? { delegationPin: 'Sol' } : {}) }
    const controls = { ...actions, releaseDelegationPin: () => { releases++ } }
    return (e.requestId?.includes('footer') ? renderFooter($.ui.resolve(e), frame, state, controls) : renderBand($.ui.resolve(e), frame, state, controls)) as RenderElement
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const layout of ['band', 'footer']) {
      for (const pinned of [false, true]) {
        const ui = await $.ui.mount({ plugin: 'test', surface, component: 'Pane', requestId: layout + (pinned ? '-pinned' : '-base'), props, viewport: { columns: 100, rows: 40 } })
        expect(!!await ui.find({ type: 'Text', text: '위임 고정: Sol' })).toBe(pinned)
        expect(!!await ui.find({ type: 'Button', key: 'release-pin' })).toBe(pinned)
        if (pinned) await ui.press({ key: 'release-pin' })
        await ui.unmount()
      }
    }
  }
  expect(releases).toBe(4)
})

test('pin hover has a keyed scope and four explanation lines only on rich surfaces', async ($, on) => {
  on('ui.render', { component: 'Pane' }, ($, e) => renderBand($.ui.resolve(e), { surface: e.surface, columns: 100, maxRows: 12, now: 0, appearance: 'auto', skin: 'deep', lang: 'en' }, { ...view, delegationPin: 'Sol' }, actions) as RenderElement)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'test', surface, component: 'Pane', requestId: 'pin', props, viewport: { columns: 100, rows: 40 } })
    const chip = await ui.find({ type: 'Box', key: 'delegation-pin' })
    expect(chip).toBeDefined()
    if (surface === 'terminal') {
      expect(chip?.props.hover).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /A request like/ })).toBeUndefined()
    } else {
      const boxes: { key?: string; props?: Record<string, unknown>; hover?: { scope?: string; display?: string } }[] = []
      let chipClipped = false
      let chipInBand = true
      const walk = (value: unknown, clipped = false, inBand = false): void => {
        if (!value || typeof value !== 'object') return
        if (Array.isArray(value)) { value.forEach(child => walk(child, clipped, inBand)); return }
        const node = value as { type?: string; key?: string; props?: Record<string, unknown>; hover?: { scope?: string; display?: string }; children?: unknown[] }
        if (node.type === 'Box') boxes.push(node)
        if (node.props?.key === 'delegation-pin') { chipClipped = clipped; chipInBand = inBand }
        node.children?.forEach(child => walk(child, clipped || node.props?.overflow === 'hidden', inBand || node.props?.key === 'band'))
      }
      walk(await ui.drawn())
      expect(chipClipped).toBe(false)
      // The chip is its own row above the band's capsule, never inside it: the band draws the same pinned or not.
      expect(chipInBand).toBe(false)
      expect(boxes.find(box => box.props?.key === 'delegation-pin')?.hover).toEqual({ scope: 'ripple-tip-delegation-pin' })
      expect(boxes.some(box => box.props?.display === 'none' && box.hover?.scope === 'ripple-tip-delegation-pin' && box.hover?.display === 'flex')).toBe(true)
      for (const text of [/A request like/, /count as your explicit choice/, /The pin ends with the session/, /To pin a model/]) expect(await ui.find({ type: 'Text', text })).toBeDefined()
    }
    await ui.unmount()
  }
})
