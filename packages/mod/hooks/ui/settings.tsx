// Quick settings in the band. Each control applies immediately; the router dashboard owns
// the full settings page. Setup reuses the judge and keep-warm rows below.
//
// 리플이 holds the panel as it holds a card (parts.tsx `speak`): the panel's name beside its face,
// then one row per setting, a name, its options as ●/○ words, a quiet hint, then the one way out
// to the dashboard. No pictures but the face: every option is a native button.

import { t } from '../i18n'
import type { RenderNode } from 'claude-code'

import type { Settings } from '../../types'
import { CELL_PX, ICON_PX, SWITCH_H, SWITCH_W, iconArt, switchArt, tintText } from './art'
import type { Icon } from './art'
import { EDGE, blank, control, pic, segments, stops, surface } from './kit'
import { action, actions, canDraw, dismiss, mascot, segmented, speak, toggle } from './parts'
import type { Els } from './parts'
import { chOf, displayWidth, textTone } from './theme'
import type { Frame, SettingsActions, SettingsSection, SettingsView } from './view'
import { isRich } from './view'

/** Every name a row of quick settings or setup shows: the name column is the widest of them. */
const ROW_NAMES = ['settings.effortAuto', 'settings.lean', 'settings.judge', 'settings.key', 'settings.keepWarm', 'settings.workers', 'settings.mode', 'band.effort', 'band.cache',
  'workers.rung.light', 'workers.rung.standard', 'workers.rung.hard', 'workers.rung.plan'] as const

/** The name column's width in cells: snug to this language's names, so controls sit close to them. */
function nameCells(frame: Frame): number {
  const names = ROW_NAMES.map(key => t(frame.lang, key))
  return isRich(frame) ? Math.ceil(Math.max(...names.map(chOf))) + 1 : Math.max(...names.map(displayWidth)) + 1
}

/** A labelled row: name column, the control, an optional quiet hint. */
export function row(el: Els, frame: Frame, key: string, label: string, control: RenderNode, hint?: string): RenderNode {
  const { Box, Text } = el
  return (
    <Box key={'row-' + key} flexDirection="row" alignItems="center" columnGap={2} flexWrap="wrap">
      <Box width={nameCells(frame)} flexShrink={0}>
        <Text dimColor>{label}</Text>
      </Box>
      {control}
      {hint ? <Text dimColor wrap="wrap">{hint}</Text> : null}
    </Box>
  )
}

// ---- The lean: five stops between cheaper and smarter -------------------------------------------

const BIAS: readonly Settings['bias'][] = [-2, -1, 0, 1, 2]

/**
 * Cheaper ○ ○ ● ○ ○ Smarter on the desktop: each stop a button whose ring is filled when chosen,
 * the ripple rings of the mascot read as a slider. The terminal names them (−2 … +2).
 */
function biasStops(el: Els, frame: Frame, bias: Settings['bias'], onPick: (bias: Settings['bias']) => void): RenderNode {
  const { Box, Button, Text } = el
  const name = (b: number) => (b > 0 ? '+' + b : b < 0 ? '−' + -b : '0')
  if (!isRich(frame)) return segmented(el, frame, 'bias', BIAS.map(b => ({ value: String(b), label: name(b) })), String(bias), picked => onPick(Number(picked) as Settings['bias']))
  return (
    <Box flexDirection="row" alignItems="center" columnGap={1}>
      <Text dimColor>{t(frame.lang, 'settings.cheaper')}</Text>
      <Box flexDirection="row">
        {BIAS.map(b => (b === bias ? <Button key={'bias-' + b} plain label="●" onPress={() => onPick(b)} /> : <Button key={'bias-' + b} plain dimColor label="○" onPress={() => onPick(b)} />))}
      </Box>
      <Text dimColor>{t(frame.lang, 'settings.smarter')}</Text>
    </Box>
  )
}

// ---- Shared quick controls ---------------------------------------------------------------------

export function effortRows(el: Els, frame: Frame, d: Settings, a: SettingsActions): RenderNode[] {
  const out = [row(el, frame, 'auto', t(frame.lang, 'settings.effortAuto'), toggle(el, frame, 'set-auto', d.effortAuto ? t(frame.lang, 'band.on') : t(frame.lang, 'band.off'), d.effortAuto, () => a.patch({ effortAuto: !d.effortAuto })), t(frame.lang, 'settings.autoHint'))]
  if (d.effortAuto) out.push(row(el, frame, 'bias', t(frame.lang, 'settings.lean'), biasStops(el, frame, d.bias, bias => a.patch({ bias })), t(frame.lang, 'settings.leanHint')))
  return out
}

export function judgeRows(el: Els, frame: Frame, view: SettingsView, a: SettingsActions): RenderNode[] {
  const d = view.settings
  const tone = textTone(frame.appearance)
  const { Box, Text } = el
  const out: RenderNode[] = [
    row(
      el,
      frame,
      'judge',
      t(frame.lang, 'settings.judge'),
      segmented(
        el,
        frame,
        'judge',
        [
          { value: 'haiku', label: t(frame.lang, 'settings.haiku') },
          { value: 'jev', label: t(frame.lang, 'settings.jev') },
          { value: 'model', label: t(frame.lang, 'settings.routerModel') },
        ] as const,
        d.judge,
        judge => a.patch({ judge }),
      ),
    ),
  ]
  if (d.judge === 'jev' && d.jevSource === 'typesafe' && !['env', 'file', 'pasted'].includes(view.jev.source ?? '')) {
    const jev = view.jev
    const placeholder = t(frame.lang, 'settings.keyPaste')
    const field = 'Input' in el ? (
      <el.Input key="jev-key" placeholder={placeholder} value="" submitLabel={t(frame.lang, 'settings.saveKey')} onSubmit={(key: string) => a.jevKey(key)} />
    ) : (
      <Text dimColor>{placeholder}</Text>
    )
    const result =
      jev.test.state === 'testing' ? (
        <Text dimColor>{t(frame.lang, 'settings.testing')}</Text>
      ) : jev.test.state === 'ok' ? (
        <Text color={tone.ok} wrap="wrap">{'✓ ' + (jev.test.message ?? t(frame.lang, 'settings.keyWorks'))}</Text>
      ) : jev.test.state === 'fail' ? (
        <Text color={tone.bad} wrap="wrap">{'✕ ' + (jev.test.message ?? t(frame.lang, 'settings.keyRejected'))}</Text>
      ) : null
    out.push(
      row(
        el,
        frame,
        'jev-key',
        t(frame.lang, 'settings.key'),
        <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={1} rowGap={1}>
          {field}
          {action(el, frame, 'jev-test', t(frame.lang, 'settings.test'), a.testJev, { hotkey: 't' })}
          {result}
        </Box>,
      ),
    )
  }
  return out
}

/**
 * The active saved worker set: Base followed by user-named modes. Rungs are edited on the dashboard.
 */
export function modeRows(el: Els, frame: Frame, d: Settings, a: SettingsActions): RenderNode[] {
  const { Text } = el
  const items = [{ value: '', label: t(frame.lang, 'settings.modeNone') }, ...d.modes.map(m => ({ value: m.id, label: m.name }))]
  const current = d.activeMode ?? ''
  const control = 'Select' in el && a.setMode
    ? <el.Select key="mode" options={items} value={current} onSelect={(value: string) => a.setMode!(value)} />
    : <Text>{items.find(item => item.value === current)?.label ?? '—'}</Text>
  return [row(el, frame, 'mode', t(frame.lang, 'settings.mode'), control)]
}

export function keepWarmRow(el: Els, frame: Frame, d: Settings, a: SettingsActions): RenderNode {
  return row(el, frame, 'warm', t(frame.lang, 'settings.keepWarm'), toggle(el, frame, 'set-warm', d.keepWarm ? t(frame.lang, 'band.on') : t(frame.lang, 'band.off'), d.keepWarm, () => a.patch({ keepWarm: !d.keepWarm })), t(frame.lang, 'settings.keepWarmHint'))
}

// ---- Desktop: cards, and the open card's controls ------------------------------------------------
//
// A drawn surface (kit.tsx): a header with 리플이, the brand and the way out to the full settings;
// a row of cards, each a setting's name and what it is set to now, the open one lit; under them the
// open card's controls, drawn large (switches, chips, a slider) with a line on what they do. Every
// press applies and saves at once, as before.

type Card = { id: SettingsSection; icon: Icon; title: string; summary: string }

function cardsOf(frame: Frame, view: SettingsView): Card[] {
  const L = frame.lang
  const d = view.settings
  const onOff = (on: boolean) => t(L, on ? 'band.on' : 'band.off')
  const lean = d.bias === 0 ? '' : ' · ' + t(L, d.bias < 0 ? 'settings.cheaper' : 'settings.smarter') + ' ' + (d.bias < 0 ? '−' + -d.bias : '+' + d.bias)
  const judge = d.judge === 'haiku' ? t(L, 'settings.haiku') : d.judge === 'jev' ? t(L, 'settings.jev') : t(L, 'settings.routerModel')
  const judgeModel = d.judge === 'model' && d.judgeModel ? ' · ' + d.judgeModel : ''
  const mode = d.modes.find(m => m.id === d.activeMode)?.name ?? t(L, 'settings.modeNone')
  return [
    { id: 'effort', icon: 'gauge', title: t(L, 'band.effort'), summary: onOff(d.effortAuto) + (d.effortAuto ? lean : '') },
    { id: 'judge', icon: 'judge', title: t(L, 'settings.judge'), summary: judge + judgeModel },
    { id: 'mode', icon: 'layers', title: t(L, 'settings.mode'), summary: mode },
    { id: 'warm', icon: 'flame', title: t(L, 'settings.keepWarm'), summary: onOff(d.keepWarm) },
  ]
}

/** Card edges: lit for the open one, quiet otherwise; both read on light and dark. */
const CARD_EDGE = 'rgba(128,124,150,0.30)'
const CARD_WASH = 'rgba(129,112,232,0.10)'

function cardDrawn(el: Els, frame: Frame, card: Card, open: boolean, cardCells: number, onPress: () => void): RenderNode {
  const { Box, Button, Text } = el
  const px = cardCells * CELL_PX
  return (
    <Box key={'card-' + card.id} position="relative" flexDirection="column" flexGrow={1} width={0} minWidth={18} paddingX={1} borderStyle="round" borderColor={open ? EDGE.violet : CARD_EDGE} {...(open ? { backgroundColor: CARD_WASH } : {})} hover={{ borderColor: EDGE.violet }}>
      <Box flexDirection="row" alignItems="center" columnGap={1}>
        {pic(el, 'card-icon-' + card.id, iconArt(card.icon, open, frame.appearance), card.title, ICON_PX, ICON_PX)}
        <Text bold color={open ? tintText('violet', frame.appearance) : undefined} wrap="wrap">{card.title}</Text>
      </Box>
      <Text dimColor wrap="wrap">{card.summary}</Text>
      {/* Two blank presses stacked: one host button is a line high, the card two. */}
      <Box position="absolute" top={0} bottom={0} left={0} right={0} flexDirection="column" justifyContent="space-around" alignItems="center" overflow="hidden">
        <Button key={'settings-card-' + card.id} plain label={blank(px)} onPress={() => onPress()} />
        <Button key={'settings-card-' + card.id + '-2'} plain label={blank(px)} onPress={() => onPress()} />
      </Box>
    </Box>
  )
}

/** A named row of the open card: the name, the control, a quiet line on what it does. */
function rowDrawn(el: Els, key: string, name: string, nameCells: number, control: RenderNode, hint?: string): RenderNode {
  const { Box, Text } = el
  return (
    <Box key={'row-' + key} flexDirection="row" alignItems="center" columnGap={2} flexWrap="wrap" rowGap={1}>
      <Box width={nameCells} flexShrink={0}>
        <Text dimColor>{name}</Text>
      </Box>
      {control}
      {hint ? <Text dimColor wrap="wrap">{hint}</Text> : null}
    </Box>
  )
}

function switchDrawn(el: Els, frame: Frame, key: string, on: boolean, onPress: () => void): RenderNode {
  const label = t(frame.lang, on ? 'band.on' : 'band.off')
  return control(el, { key, source: switchArt(on, frame.appearance), alt: label, width: SWITCH_W, height: SWITCH_H, label, ...(on ? { labelColor: tintText('violet', frame.appearance) } : { dim: true }), bold: on, onPress, pad: 0 })
}

/** The drawn controls of one card (setup lends them too). */
export function drawnRows(el: Els, frame: Frame, view: SettingsView, a: SettingsActions, section: SettingsSection): RenderNode[] {
  const { Box, Text } = el
  const L = frame.lang
  const d = view.settings
  const violet = tintText('violet', frame.appearance)
  const nameCells = Math.ceil(Math.max(...[t(L, 'settings.effortAuto'), t(L, 'settings.lean'), t(L, 'settings.judge'), t(L, 'settings.key'), t(L, 'settings.mode'), t(L, 'settings.keepWarm')].map(chOf))) + 1
  if (section === 'effort') {
    const out = [rowDrawn(el, 'auto', t(L, 'settings.effortAuto'), nameCells, switchDrawn(el, frame, 'set-auto', d.effortAuto, () => a.patch({ effortAuto: !d.effortAuto })), t(L, 'settings.autoHint'))]
    if (d.effortAuto) {
      out.push(
        rowDrawn(
          el,
          'bias',
          t(L, 'settings.lean'),
          nameCells,
          <Box key="bias" flexDirection="row" alignItems="center" columnGap={1}>
            <Text dimColor>{t(L, 'settings.cheaper')}</Text>
            {stops(el, frame, 'bias', BIAS, d.bias, bias => a.patch({ bias }))}
            <Text dimColor>{t(L, 'settings.smarter')}</Text>
          </Box>,
          t(L, 'settings.leanHint'),
        ),
      )
    }
    return out
  }
  if (section === 'judge') {
    const out = [
      rowDrawn(
        el,
        'judge',
        t(L, 'settings.judge'),
        nameCells,
        segments(el, frame, 'judge', [
          { value: 'haiku', label: t(L, 'settings.haiku') },
          { value: 'jev', label: t(L, 'settings.jev') },
          { value: 'model', label: t(L, 'settings.routerModel') },
        ] as const, d.judge, judge => a.patch({ judge }), 'violet', violet),
        t(L, 'settings.judgeBlurb'),
      ),
    ]
    // The key field when Jev needs one: the terminal's row, which is native controls already.
    const key = judgeRows(el, frame, view, a).slice(1)
    return [...out, ...key]
  }
  if (section === 'mode') {
    const items = [{ value: '', label: t(L, 'settings.modeNone') }, ...d.modes.map(m => ({ value: m.id, label: m.name }))]
    const current = d.activeMode ?? ''
    const control = items.length <= 6 || !('Select' in el)
      ? segments(el, frame, 'mode', items, current, id => a.setMode?.(id), 'violet', violet)
      : <el.Select key="mode" options={items} value={current} onSelect={(value: string) => a.setMode?.(value)} />
    return [rowDrawn(el, 'mode', t(L, 'settings.mode'), nameCells, control, t(L, 'settings.workersBlurb'))]
  }
  return [
    rowDrawn(el, 'warm', t(L, 'settings.keepWarm'), nameCells, switchDrawn(el, frame, 'set-warm', d.keepWarm, () => a.patch({ keepWarm: !d.keepWarm })), t(L, 'settings.keepWarmHint')),
    <Box key="warm-cost" paddingLeft={nameCells + 2}>
      <Text dimColor wrap="wrap">{t(L, 'settings.warmCost')}</Text>
    </Box>,
  ]
}

function settingsDrawn(el: Els, frame: Frame, view: SettingsView, a: SettingsActions): RenderNode {
  const { Box, Button, Text } = el
  const L = frame.lang
  const section = view.section ?? 'effort'
  const cards = cardsOf(frame, view)
  const cardCells = Math.max(18, Math.floor((frame.columns - 4 - (cards.length - 1)) / cards.length) - 2)
  const openLabel = t(L, 'settings.openAll')
  const header = (
    <Box key="settings-head" flexDirection="row" alignItems="center" columnGap={1} width="100%" minWidth={0}>
      {mascot(el, frame, 'settings', 'calm', t(L, 'band.brand'), 22)}
      <Text bold>{t(L, 'band.brand')}</Text>
      <Text dimColor>{t(L, 'settings.quick')}</Text>
      <Box flexGrow={1} />
      {control(el, { key: 'all-settings', source: iconArt('open', false, frame.appearance), alt: openLabel, width: ICON_PX, height: ICON_PX, label: openLabel, dim: true, onPress: a.openAllSettings })}
      <Button key="close" plain role="dismiss" label={t(L, 'settings.close')} onPress={() => a.close()} />
    </Box>
  )
  const grid = (
    <Box key="settings-cards" flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1} width="100%">
      {cards.map(card => cardDrawn(el, frame, card, card.id === section, cardCells, () => a.openSection?.(card.id)))}
    </Box>
  )
  const detail = (
    <Box key="settings-detail" flexDirection="column" rowGap={1} paddingX={1} width="100%" minWidth={0}>
      {drawnRows(el, frame, view, a, section)}
    </Box>
  )
  return surface(el, frame, { key: 'settings', tint: 'violet', motion: { ripples: 'slow' }, rows: 8, column: true, gap: 1, children: [header, grid, detail] })
}

// ---- The panel ---------------------------------------------------------------------------------

/** Session-time controls only; the full settings live on the router dashboard. */
export function renderSettings(el: Els, frame: Frame, view: SettingsView, a: SettingsActions): RenderNode {
  if (canDraw(el, frame)) return settingsDrawn(el, frame, view, a)
  const { Box } = el
  const rich = isRich(frame)
  const close = dismiss(el, frame, 'close', t(frame.lang, 'settings.close'), a.close, 'x')
  return speak(el, frame, {
    key: 'settings',
    face: 'calm',
    title: t(frame.lang, 'band.brand'),
    aside: t(frame.lang, 'settings.quick'),
    blocks: [
      <Box key="controls" flexDirection="column" rowGap={rich ? 1 : 0}>
        {effortRows(el, frame, view.settings, a)}
        {judgeRows(el, frame, view, a)}
        {modeRows(el, frame, view.settings, a)}
        {keepWarmRow(el, frame, view.settings, a)}
      </Box>,
      actions(el, frame, [action(el, frame, 'all-settings', t(frame.lang, 'settings.openAll'), a.openAllSettings, { hotkey: 's', primary: true }), rich ? '' : close]),
    ],
    ...(rich ? { dismiss: close } : {}),
  })
}
