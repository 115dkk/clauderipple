// The matrix (2026-10-15): the desktop drawn as a board, after EqualizerAPO-XT's Signal Matrix skin
// (its constitution: docs/skins/matrix.md there). Not the deep's layout in other colours: the band
// is a departure line, the quick settings a routing matrix of rows, a card one posted row, and
// every figure a boxed mono readout. The pictures are cells.ts; this file composes them with the
// host's own Text (its ink for titles, dimmed for the quiet lines, never coloured: colour is
// rationed to rails, lamps and cells) and the blank presses of kit.tsx laid over every cell.
//
// What stays the same as the deep is the function: every press, field and select keeps its key
// and its callback, so a thing that could be switched there can be switched here (the ui tests
// hold the two to the same keys).
//
// Host facts (see kit.tsx): a placed backdrop paints over unplaced siblings, so each row holds its
// board in a placed picture first and its words in a positioned layer after it; a hover with a
// `scope` lights every member of the group, which is how a row and its coordinate cell light
// together at the crosspoint.

import { t } from '../i18n'
import type { RenderNode } from 'claude-code'

import type { Effort, Settings, Skin } from '../../types'
import { SKINS } from '../settings'
import { CELL_PX, ROW_PX } from './art'
import type { Icon } from './art'
import { bandMood, cacheFact, contextFact, effortFact, limitFact, modeFact, modeLabel, routeFact, routeName } from './band'
import { BOARD_PALETTE, CODE, CONTROL, CROSSPOINT, LEAD_PX, READOUT, SCAN_LEAD, captionArt, cellArt, cellsOf, closeArt, codeArt, groundArt, lampArt, ledStripArt, meterArt, plateArt, portCells, portsArt, powerArt, readoutArt, rowArt, ruleArt, scanArt, stepsArt } from './cells'
import type { Ink, Lamp, Made } from './cells'
import { lift, pic, press, rowsOf } from './kit'
import { rippleSource } from './parts'
import type { Els } from './parts'
import type { Face } from './ripple'
import { afterHint, cardOf } from './alerts'
import { modeItems, needsKey, settingsSay } from './settings'
import { STEPS, workersSummary } from './setup'
import { cacheTone, chOf, contextTone, limitTone } from './theme'
import type { AlertActions, AlertView, BandActions, DashboardView, Frame, SettingsActions, SettingsView, SetupActions, SetupView } from './view'
import { EFFORTS, effortIndex, effortName, limitName, minutesLeft } from './view'

/** Cells the row's lead (rail, lamp, coordinate) takes before its content. */
const LEAD_CELLS = cellsOf(LEAD_PX) + 1
/** The capsule's air across, in cells, and the width its board is drawn at. */
const PAD_X = 1
const boardWidth = (frame: Frame): number => Math.max(40, frame.columns) * CELL_PX + 48

// ---- Pieces ------------------------------------------------------------------------------------

/** 리플이 in board ink, `size` px, a plain image in a Box of its own. */
function mascot(el: Els, key: string, face: Face, alt: string, size: number, percent?: number, dim = false): RenderNode {
  if (!('Svg' in el)) return ''
  const { Box, Svg } = el
  return (
    <Box key={'ripple-' + key} flexShrink={0}>
      <Svg source={rippleSource(face, size, 'auto', percent, dim, BOARD_PALETTE, 'board')} alt={alt} width={size} height={size} />
    </Box>
  )
}

/** A picture in a Box sized to it, in whole cells and host rows. */
function cell(el: Els, key: string, made: Made, alt: string, height: number): RenderNode {
  const { Box } = el
  return (
    <Box key={'cell-' + key} width={made.cells} height={rowsOf(height)} flexShrink={0} alignItems="center" justifyContent="center">
      {pic(el, key, made.source, alt, made.width, height)}
    </Box>
  )
}

/** A pressable cell: the picture, lit at the crosspoint under the pointer, and its press (`key`). */
function pressCell(el: Els, key: string, made: Made, alt: string, height: number, onPress: () => void, scope?: string): RenderNode {
  const { Box } = el
  return (
    <Box key={'hv-' + key} position="relative" width={made.cells} height={rowsOf(height)} flexShrink={0} alignItems="center" justifyContent="center" hover={{ backgroundColor: CROSSPOINT.column, ...(scope ? { scope } : {}) }}>
      {pic(el, key, made.source, alt, made.width, height)}
      {press(el, key, made.cells * CELL_PX, onPress)}
    </Box>
  )
}

/** A caption beside a reading. */
function caption(el: Els, key: string, text: string, ink?: Ink): RenderNode {
  return cell(el, key, captionArt(text, ink ? { ink } : {}), text, READOUT)
}

function readout(el: Els, key: string, text: string, o: Parameters<typeof readoutArt>[1] = {}): RenderNode {
  return cell(el, key, readoutArt(text, o), text, READOUT)
}

/**
 * A port strip: each port the press of its option (`key-value`), the chosen one engaged.
 */
function ports<T extends string>(el: Els, key: string, options: readonly { value: T; label: string }[], value: T | null, onPick: (value: T) => void, cancelled = false): RenderNode {
  const { Box } = el
  const labels = options.map(o => o.label)
  const cells = portCells(labels)
  const total = cells.reduce((n, c) => n + c, 0)
  const chosen = options.findIndex(o => o.value === value)
  const alt = labels.map((label, i) => (i === chosen ? '[' + label + ']' : label)).join(' · ')
  return (
    <Box key={'ports-' + key} position="relative" flexDirection="row" width={total} height={rowsOf(CONTROL)} flexShrink={0}>
      <Box position="absolute" top={0} left={0}>
        {pic(el, 'ports-' + key, portsArt(labels, cells, chosen, { cancelled }), alt, total * CELL_PX, CONTROL)}
      </Box>
      {options.map((o, i) => (
        <Box key={'port-' + key + '-' + o.value} position="relative" width={cells[i]} height={rowsOf(CONTROL)} flexShrink={0} hover={{ backgroundColor: CROSSPOINT.column }}>
          {press(el, key + '-' + o.value, cells[i]! * CELL_PX, () => onPick(o.value))}
        </Box>
      ))}
    </Box>
  )
}

/** A power cell and its word, the whole pressable; `busy` blinks it. */
function power(el: Els, key: string, on: boolean, label: string, onPress: () => void, busy = false, word = true): RenderNode {
  const { Box, Text } = el
  const cells = cellsOf(36) + (word ? Math.ceil(chOf(label) * 1.1) + 1 : 0) + 1
  return (
    <Box key={'hv-' + key} position="relative" flexDirection="row" alignItems="center" columnGap={1} paddingX={0.5} width={cells} flexShrink={0} hover={{ backgroundColor: CROSSPOINT.column }}>
      {pic(el, key, powerArt(on, busy), label, 36, 22)}
      {word ? <Text key={key + '-word'} dimColor={!on}>{label}</Text> : ''}
      {press(el, key, cells * CELL_PX, onPress)}
    </Box>
  )
}

/**
 * A board line: `> ` and host Text in a sunken strip `cells` wide; `field` (an Input) in place of
 * the words makes it a scan readout. The strip is a placed picture; the words sit in a layer above.
 */
function scanLine(el: Els, key: string, cells: number, content: RenderNode, height = READOUT, edge?: 'accent'): RenderNode {
  const { Box } = el
  const w = cells * CELL_PX
  return (
    <Box key={'scan-' + key} position="relative" flexDirection="row" alignItems="center" width={cells} flexShrink={1} minWidth={16} height={rowsOf(height)} paddingLeft={SCAN_LEAD} paddingRight={1} overflow="hidden">
      <Box position="absolute" top={0} left={0}>
        {pic(el, 'scan-' + key, scanArt(w, height, edge ? { edge } : {}), '>', w, height)}
      </Box>
      <Box key={'scan-words-' + key} position="relative" flexGrow={1} flexShrink={1} minWidth={0}>
        {lift(el)}
        {content}
      </Box>
    </Box>
  )
}

/** The way out as a `×` cell, its press `key`. */
function closeCell(el: Els, key: string, label: string, onPress: () => void): RenderNode {
  const { Box } = el
  const cells = cellsOf(22) + 1
  return (
    <Box key={'hv-' + key} position="relative" width={cells} height={rowsOf(CONTROL)} flexShrink={0} alignItems="center" justifyContent="center">
      {pic(el, key, closeArt(), label, 22, 22)}
      <Box position="absolute" top={0} bottom={0} left={0} right={0} alignItems="center" justifyContent="center" display="none" hover={{ display: 'flex' }}>
        {pic(el, key + '-lit', closeArt(true), label, 22, 22)}
      </Box>
      {press(el, key, cells * CELL_PX, onPress)}
    </Box>
  )
}

/**
 * The board under a capsule: a Box with no border of the host's (its corners are round), the
 * ground painted first and placed, everything else in one positioned layer above it.
 */
function capsule(el: Els, frame: Frame, c: { key: string; lamp: Lamp; lampY: number; headerPx?: number; rows: number; paddingX?: number; paddingY?: number; gap?: number; children: RenderNode[] }): RenderNode {
  const { Box } = el
  const width = boardWidth(frame)
  const height = Math.round(c.rows * ROW_PX) + 220
  return (
    <Box key={c.key} position="relative" flexDirection="column" paddingX={0} paddingY={0} overflow="hidden" width="100%" minWidth={0}>
      <Box key={c.key + '-ground'} position="absolute" top={0} left={0}>
        {pic(el, c.key + '-ground', groundArt(width, height, { lamp: c.lamp, lampY: c.lampY, ...(c.headerPx ? { headerPx: c.headerPx } : {}) }), 'ClaudeRipple', width, height)}
      </Box>
      <Box key={c.key + '-layer'} position="relative" flexDirection="column" rowGap={c.gap ?? 0} paddingX={c.paddingX ?? PAD_X} paddingY={c.paddingY ?? 0} width="100%" minWidth={0}>
        {lift(el)}
        {c.children}
      </Box>
    </Box>
  )
}

/**
 * A posted row: its board (rule, rail, lamp, coordinate, header band and body) placed first, then
 * the header band's two host rows (the title line with its head control, the quiet line) and the
 * body under them, all in a positioned layer. The row and its lead light together at the crosspoint.
 */
function row(el: Els, frame: Frame, x: { key: string; lamp: Lamp; coordinate: string; code: string; cancelled?: boolean; title: RenderNode; head?: RenderNode; line?: string; body: RenderNode[] }): RenderNode {
  const { Box, Text } = el
  const width = boardWidth(frame)
  const headerPx = ROW_PX * 2
  const scope = 'xp-' + x.key
  const code = codeArt(x.code, x.cancelled ? { cancelled: true } : {})
  return (
    <Box key={'row-' + x.key} position="relative" flexDirection="column" width="100%" minWidth={0} overflow="hidden" hover={{ scope }}>
      <Box key={'row-board-' + x.key} position="absolute" top={0} left={0}>
        {pic(el, 'row-board-' + x.key, rowArt(width, 12 * ROW_PX, { lamp: x.lamp, coordinate: x.coordinate, headerPx, ...(x.cancelled ? { cancelled: true } : {}) }), x.coordinate, width, 12 * ROW_PX)}
      </Box>
      <Box position="absolute" top={0} bottom={0} left={0} right={0} hover={{ scope, backgroundColor: CROSSPOINT.row }} />
      <Box position="absolute" top={0} bottom={0} left={0} width={LEAD_CELLS - 1} hover={{ scope, backgroundColor: CROSSPOINT.column }} />
      <Box key={'row-layer-' + x.key} position="relative" flexDirection="column" paddingLeft={LEAD_CELLS} paddingRight={1.5} width="100%" minWidth={0}>
        {lift(el)}
        <Box key="row-head" flexDirection="column" height={2} justifyContent="center">
          <Box flexDirection="row" alignItems="center" columnGap={1} width="100%" minWidth={0}>
            {cell(el, 'code-' + x.key, code, x.code, CODE)}
            <Box flexGrow={1} flexShrink={1} minWidth={0}>{x.title}</Box>
            {x.head ?? null}
          </Box>
          {x.line ? <Text dimColor wrap="wrap">{x.line}</Text> : null}
        </Box>
        {x.body.length ? (
          <Box key="row-body" flexDirection="column" rowGap={1} paddingY={0.5}>
            {x.body}
          </Box>
        ) : null}
      </Box>
    </Box>
  )
}

/** A quiet host line under a control. */
function note(el: Els, key: string, text: string): RenderNode {
  const { Text } = el
  return <Text key={key} dimColor wrap="wrap">{text}</Text>
}

// ---- The band: a departure line ----------------------------------------------------------------
//
// One row on the board: the rail and lamp say whether Auto is on, 리플이 in board ink, then the
// facts as caption-and-readout pairs (the effort as five LED cells and its word), the last route
// as a board line, and the controls as cells at the right end: Handoff's plate when advised, the
// Auto power cell, the icon cells. A fact's tip shows in a board line over the facts on hover.

const BAND_RIPPLE = 24
const CREST_CELLS = 4
const ROW_H = CONTROL
const GAP = 0.5
const ROUTE_ROOM = 16
const ROUTE_MIN = 8
const WORDLESS = ['clear', 'compact', 'settings', 'agents', 'warm', 'auto'] as const

type Drawn = { key: string; cells: number; node: RenderNode; tip?: string }

const tipScope = (key: string) => 'board-tip-' + key

/** A fact: its parts in a row of fixed cells, pointing at it shows its tip. */
function fact(el: Els, key: string, parts: Drawn[], tip?: string, onPress?: () => void): Drawn {
  const { Box } = el
  const cells = parts.reduce((n, p) => n + p.cells, 0) + GAP * (parts.length - 1)
  return {
    key,
    cells,
    tip,
    node: (
      <Box key={'fact-' + key} position="relative" flexDirection="row" alignItems="center" columnGap={GAP} width={cells} flexShrink={0} {...(tip ? { hover: { scope: tipScope(key) } } : {})}>
        {parts.map(p => p.node)}
        {onPress ? press(el, key, cells * CELL_PX, onPress) : null}
      </Box>
    ),
  }
}

function made(el: Els, key: string, art: Made, alt: string, height: number): Drawn {
  return { key, cells: art.cells, node: cell(el, key, art, alt, height) }
}

function inkOf(tone: 'ink' | 'ok' | 'warn' | 'bad'): Ink {
  return tone === 'warn' ? 'warning' : tone === 'bad' ? 'danger' : tone === 'ok' ? 'success' : 'text'
}

function bandFacts(el: Els, frame: Frame, view: DashboardView, actions: BandActions, captions: boolean): { effort: Drawn; optional: Drawn[] } {
  const { Box } = el
  const L = frame.lang
  const { level, mode } = view.effort
  const idx = effortIndex(level)
  const look = mode === 'deciding' ? 'deciding' : mode === 'auto' ? 'auto' : mode === 'manual' ? 'manual' : 'quiet'
  const word = mode === 'deciding' ? t(L, 'band.deciding') : level ? effortName(level, L) : '—'
  // The word's slot is sized for the widest word, so a changing level moves nothing.
  const wordPx = Math.max(...[...EFFORTS.map(e => effortName(e, L)), t(L, 'band.deciding')].map(w => readoutArt(w).width))
  const effortParts: Drawn[] = [
    ...(captions ? [made(el, 'effort-caption', captionArt(t(L, 'band.effortShort')), t(L, 'band.effortShort'), READOUT)] : []),
    { key: 'meter', cells: cellsOf(24), node: <Box key="meter" width={cellsOf(24)} flexShrink={0} alignItems="center">{pic(el, 'meter', meterArt(mode === 'deciding' ? 5 : idx + 1, look), t(L, 'band.effort'), 24, 16)}</Box> },
    made(el, 'effort-word', readoutArt(word, { widthPx: wordPx, ink: mode === 'deciding' ? 'accent' : look === 'quiet' ? 'muted' : 'text' }), word, READOUT),
  ]
  const effort = fact(el, 'effort', effortParts, effortFact(frame, view, actions.toggleEffortMenu).card?.join(' · '), actions.toggleEffortMenu)
  const optional: Drawn[] = []
  if (view.mode) {
    optional.push(fact(el, 'mode', [...(captions ? [made(el, 'mode-caption', captionArt(t(L, 'band.mode')), t(L, 'band.mode'), READOUT)] : []), made(el, 'mode-value', readoutArt(modeLabel(view.mode), { ink: 'accent', widthPx: 12 * CELL_PX }), view.mode, READOUT)], modeFact(frame, view)?.card?.join(' · ')))
  }
  const ctx = view.context
  if (ctx && view.extras.includes('context')) {
    const tone = contextTone(ctx.percent, view.swampAt)
    optional.push(fact(el, 'context', [...(captions ? [made(el, 'ctx-caption', captionArt(t(L, 'band.context')), t(L, 'band.context'), READOUT)] : []), made(el, 'ctx-value', readoutArt(Math.round(ctx.percent) + '%', { ink: inkOf(tone), widthPx: readoutArt('100%').width }), Math.round(ctx.percent) + '%', READOUT)], contextFact(frame, view)?.card?.join(' · ')))
  }
  if (!view.hide.includes('timer')) {
    const cache = view.cache
    const left = cache ? cache.expiresAt - frame.now : 0
    const shown = cache && left > 0 ? Math.ceil(left / 60_000) : 0
    const text = cache ? minutesLeft(left, L) : '—'
    const words = [t(L, 'units.minutes', { n: 60 }), t(L, 'band.cold'), '—']
    optional.push(fact(el, 'cache', [...(captions ? [made(el, 'cache-caption', captionArt(t(L, 'band.cache')), t(L, 'band.cache'), READOUT)] : []), made(el, 'cache-value', readoutArt(text, { ink: shown === 1 ? 'warning' : shown === 0 ? 'muted' : 'text', widthPx: Math.max(...words.map(w => readoutArt(w).width)) }), text, READOUT)], cacheFact(frame, view)?.card?.join(' · ')))
  }
  const limit = view.limit
  if (limit && view.extras.includes('limits')) {
    const tone = limitTone(limit.percent)
    const parts: Drawn[] = [
      ...(captions ? [made(el, 'limit-caption', captionArt(limitName(limit.kind, L)), limitName(limit.kind, L), READOUT)] : []),
      made(el, 'limit-value', readoutArt(Math.round(limit.percent) + '%', { ink: inkOf(tone), widthPx: readoutArt('100%').width }), Math.round(limit.percent) + '%', READOUT),
    ]
    if (limit.save) parts.push(made(el, 'limit-save', captionArt(t(L, 'band.save'), { ink: 'accent' }), t(L, 'band.save'), READOUT))
    optional.push(fact(el, 'limit', parts, limitFact(frame, view)?.card?.join(' · ')))
  }
  return { effort, optional }
}

/** The last route as a board line: `> model` and its hit in the hit's colour; the way into the log. */
function routeDrawn(el: Els, frame: Frame, view: DashboardView, actions: BandActions, room: number): Drawn | null {
  if (view.hide.includes('route')) return null
  const { Box } = el
  const r = view.route
  if (!r) {
    if (!view.notice) return null
    const text = view.notice.replace(/^ClaudeRipple:\s*/, '')
    return made(el, 'route', readoutArt(text, { ink: 'muted', marker: true, widthPx: room * CELL_PX }), text, READOUT)
  }
  const tone = r.cachePct !== undefined ? cacheTone(r.cachePct) : 'ok'
  const tail = !r.ok ? (r.resent ? t(frame.lang, 'band.resent', { status: r.status }) : String(r.status)) : r.cachePct !== undefined ? r.cachePct + '%' : ''
  const tailArt = tail ? readoutArt(tail, { ink: !r.ok ? (r.resent ? 'muted' : 'danger') : tone === 'ok' ? 'success' : tone === 'warn' ? 'warning' : 'danger' }) : null
  const nameRoom = Math.max(ROUTE_MIN, room - (tailArt ? tailArt.cells + GAP : 0))
  const name = readoutArt((r.resent ? '~ ' : '') + routeName(r.model), { marker: true, widthPx: nameRoom * CELL_PX, ink: r.ok ? 'text' : 'danger' })
  const parts: Drawn[] = [{ key: 'route-name', cells: nameRoom, node: <Box key="route-name" width={nameRoom} flexShrink={0} overflow="hidden">{pic(el, 'route-name', name.source, routeName(r.model), name.width, READOUT)}</Box> }]
  if (tailArt) parts.push(made(el, 'route-hit', tailArt, tail, READOUT))
  return fact(el, 'route', parts, routeFact(frame, view, 200, actions.toggleLog)?.card?.join(' · '), actions.toggleLog)
}

/** The tips laid over the facts, each shown while its fact or control is pointed at: a board line. */
function tips(el: Els, frame: Frame, list: { key: string; text: string }[], at: number): RenderNode {
  const { Box, Text } = el
  const left = Math.ceil(at)
  const width = boardWidth(frame)
  return (
    <Box key="board-why" position="absolute" top={0} bottom={0} left={left} right={0} minWidth={0} overflow="hidden">
      {list.map(tip => (
        <Box position="absolute" top={0} bottom={0} left={0} right={0} display="none" hover={{ scope: tipScope(tip.key), display: 'flex' }} overflow="hidden" alignItems="center">
          <Box position="absolute" top={0} left={0}>
            {pic(el, 'tip-plate-' + tip.key, scanArt(width, ROW_H), tip.text, width, ROW_H)}
          </Box>
          <Box position="relative" flexShrink={1} minWidth={0} paddingLeft={SCAN_LEAD}>
            {lift(el)}
            <Text wrap="truncate">{tip.text}</Text>
          </Box>
        </Box>
      ))}
    </Box>
  )
}

/** An icon cell at the band's right end, its word when the band has room, lit under the pointer. */
function iconCell(el: Els, key: string, icon: Icon, alt: string, tip: string, onPress: () => void, o: { on?: boolean; lamp?: Lamp; count?: string; word?: string }): Drawn {
  const { Box, Text } = el
  const art = cellsOf(26 + (o.count ? 16 : 0))
  const cells = art + (o.word ? Math.ceil(chOf(o.word) * 1.04) + 1 : 0) + 1
  return {
    key,
    cells,
    tip,
    node: (
      <Box key={'hv-' + key} position="relative" flexDirection="row" alignItems="center" columnGap={1} paddingX={0.5} width={cells} flexShrink={0} hover={{ backgroundColor: CROSSPOINT.column, scope: tipScope(key) }}>
        {pic(el, key, cellArt(icon, art, { on: o.on, lamp: o.lamp, count: o.count }), alt, art * CELL_PX, CONTROL)}
        {o.word ? <Text key={key + '-word'} dimColor={!o.on}>{o.word}</Text> : ''}
        {press(el, key, cells * CELL_PX, onPress)}
      </Box>
    ),
  }
}

function bandControls(el: Els, frame: Frame, view: DashboardView, actions: BandActions, words: readonly string[]): Drawn[] {
  const { Box } = el
  const L = frame.lang
  const out: Drawn[] = []
  const state = (on: boolean) => t(L, on ? 'band.on' : 'band.off')
  if (view.handoff !== 'off') {
    const advised = view.handoff === 'advised'
    const label = t(L, 'band.handoff')
    const art = plateArt(label, advised ? 'execute' : 'quiet')
    out.push({ key: 'handoff', cells: art.cells + 1, tip: t(L, 'alerts.handoffTitle'), node: pressCell(el, 'handoff', art, label, CONTROL, actions.handoff, tipScope('handoff')) })
  }
  const autoLabel = t(L, 'band.auto')
  const autoWord = words.includes('auto')
  out.push({ key: 'auto', cells: cellsOf(36) + (autoWord ? Math.ceil(chOf(autoLabel) * 1.1) + 1 : 0) + 1, tip: t(L, 'band.effortAutoAlt', { state: state(view.auto) }) + ' · ' + t(L, 'settings.autoLine'), node: (
    <Box key="hv-auto-scope" hover={{ scope: tipScope('auto') }}>{power(el, 'auto', view.auto, autoLabel, actions.toggleAuto, view.effort.mode === 'deciding', autoWord)}</Box>
  ) })
  const warm = t(L, 'band.warm')
  out.push(iconCell(el, 'warm', 'flame', warm, t(L, 'band.warmAlt', { state: state(view.warm.on) }) + ' · ' + t(L, view.warm.here ? 'band.warmHere' : 'settings.warmLine'), actions.toggleWarm, { on: view.warm.on, lamp: view.warm.on ? (view.warm.stopped ? 'bypass' : 'on') : 'off', ...(words.includes('warm') ? { word: warm } : {}) }))
  const agents = t(L, 'band.agents')
  const live = view.agents.live
  out.push(iconCell(el, 'agents', 'agents', live > 0 ? agents + ' ' + live : agents, t(L, 'band.agentsAlt', { count: live }), actions.toggleAgents, { on: view.agentsOpen || live > 0, ...(live > 0 ? { count: live > 9 ? '9+' : String(live) } : {}), ...(words.includes('agents') ? { word: agents } : {}) }))
  const compact = t(L, 'band.compact')
  out.push(iconCell(el, 'compact', 'compact', compact, t(L, 'band.compactAlt'), actions.compact, { ...(words.includes('compact') ? { word: compact } : {}) }))
  const clear = t(L, 'band.clear')
  out.push(iconCell(el, 'clear', 'clear', clear, t(L, 'band.clearAlt'), actions.clear, { ...(words.includes('clear') ? { word: clear } : {}) }))
  const settings = t(L, 'band.settings')
  out.push(iconCell(el, 'settings', 'gear', settings, t(L, 'band.settingsAlt'), actions.openSettings, { ...(words.includes('settings') ? { word: settings } : {}) }))
  return out
}

function effortMenu(el: Els, frame: Frame, view: DashboardView, actions: BandActions): RenderNode {
  const { Box } = el
  const current = view.effort.mode === 'manual' || view.effort.mode === 'off' ? view.effort.level : null
  return (
    <Box key="effort-menu" flexDirection="row" alignItems="center" flexWrap="wrap" columnGap={2} rowGap={1} paddingTop={1} paddingLeft={CREST_CELLS}>
      {power(el, 'pick-auto', view.auto, t(frame.lang, 'band.auto'), actions.toggleAuto)}
      {ports(el, 'pick', EFFORTS.map(effort => ({ value: effort, label: effortName(effort, frame.lang) })), current as Effort | null, effort => actions.pickEffort(effort))}
    </Box>
  )
}

export function boardBand(el: Els, frame: Frame, view: DashboardView, actions: BandActions): RenderNode {
  const { Box } = el
  const cols = Math.max(30, frame.columns) - 2 * PAD_X - 1
  const mood = bandMood(frame, view)
  const lamp: Lamp = view.effort.mode === 'deciding' ? 'busy' : view.effort.mode === 'off' || view.effort.mode === 'paused' ? 'bypass' : 'on'
  const close = actions.hide ? cellsOf(22) + 1 : 0
  // The row's budget, widths alone: narrow, the captions go first, then the icons' words, then
  // the route draws in, then the mode and the context chip, last the cache.
  let captions = true
  let words: readonly string[] = [...WORDLESS]
  let route = view.hide.includes('route') ? 0 : ROUTE_ROOM
  const counted = (w: readonly string[]) => bandControls(el, frame, { ...view, handoff: 'advised' }, actions, w).reduce((n, c) => n + c.cells, 0) + 0.15 * 6 + (actions.hide ? 0.15 : 0)
  let controlCells = counted(words)
  let { effort, optional: facts } = bandFacts(el, frame, view, actions, captions)
  const need = () => CREST_CELLS + GAP + effort.cells + GAP + facts.reduce((n, f) => n + f.cells + GAP, 0) + (route ? route + GAP : 0) + controlCells + close + 1
  for (const drop of ['captions', ...WORDLESS, 'route', 'mode', 'context', 'cache']) {
    if (need() <= cols) break
    if (drop === 'captions') {
      captions = false
      const again = bandFacts(el, frame, view, actions, false)
      effort = again.effort
      facts = again.optional.filter(f => facts.some(g => g.key === f.key))
    } else if ((WORDLESS as readonly string[]).includes(drop)) {
      words = words.filter(w => w !== drop)
      controlCells = counted(words)
    } else if (drop === 'route') route = ROUTE_MIN
    else facts = facts.filter(f => f.key !== drop)
  }
  const controls = bandControls(el, frame, view, actions, words)
  const routeNode = route > 0 ? routeDrawn(el, frame, view, actions, route) : null
  const list = [effort, ...facts].filter(f => f.tip).map(f => ({ key: f.key, text: f.tip! }))
  if (routeNode?.tip) list.push({ key: 'route', text: routeNode.tip })
  for (const c of controls) if (c.tip && c.key !== 'handoff') list.push({ key: c.key, text: c.tip })
  if (actions.hide) list.push({ key: 'hide', text: t(frame.lang, 'band.hideBand') })
  const crest = (
    <Box key="band-crest" width={CREST_CELLS} flexShrink={0} alignItems="center">
      {mascot(el, 'band-' + mood.face + (mood.dim ? '-dim' : ''), mood.face, 'ClaudeRipple', BAND_RIPPLE, undefined, mood.dim)}
    </Box>
  )
  const row = (
    <Box key="band-row" flexDirection="row" alignItems="center" width="100%" minWidth={0} height={rowsOf(ROW_H)}>
      <Box key="band-facts" flexDirection="row" alignItems="center" columnGap={GAP} flexGrow={1} flexShrink={1} width={0} minWidth={0}>
        {crest}
        {effort.node}
        {facts.map(f => f.node)}
        {routeNode?.node ?? null}
        {tips(el, frame, list, CREST_CELLS + GAP + effort.cells + GAP)}
      </Box>
      <Box key="band-controls" flexDirection="row" alignItems="center" columnGap={0.15} flexShrink={0} marginLeft={0.5}>
        {controls.map(c => c.node)}
        {actions.hide ? <Box key="hv-hide-scope" hover={{ scope: tipScope('hide') }}>{closeCell(el, 'hide', t(frame.lang, 'band.hideBand'), () => actions.hide!())}</Box> : null}
      </Box>
    </Box>
  )
  return capsule(el, frame, {
    key: 'band',
    lamp,
    lampY: Math.round(0.5 * ROW_PX * 0.5 + ROW_H / 2 - 2),
    rows: view.effortMenu ? 3.4 : 1.8,
    paddingX: PAD_X,
    paddingY: 0.5,
    children: [row, view.effortMenu ? effortMenu(el, frame, view, actions) : ''],
  })
}

// ---- The quick settings: a routing matrix ------------------------------------------------------
//
// A masthead (리플이, the panel's name, the ways out as cells, 리플이's sentence as a board line),
// then one posted row per setting: E1 AUTO, J2 JUDGE, M3 MODE, W4 WARM, S5 SKIN. A row's lamp says
// whether the setting is on; its controls sit in the body band under the title and its line.

const BIAS: readonly Settings['bias'][] = [-2, -1, 0, 1, 2]

/** The lean as a bipolar LED strip, each stop the press of its value (`bias-<value>`), with its readout. */
function lean(el: Els, frame: Frame, d: Settings, a: SettingsActions): RenderNode {
  const { Box, Text } = el
  const per = 3
  const chosen = Math.max(0, BIAS.indexOf(d.bias))
  const total = BIAS.length * per
  const name = d.bias > 0 ? '+' + d.bias : d.bias < 0 ? '-' + -d.bias : '0'
  return (
    <Box key="lean" flexDirection="row" alignItems="center" columnGap={1} flexWrap="wrap">
      <Text dimColor>{t(frame.lang, 'settings.cheaper')}</Text>
      <Box key="sl-bias" position="relative" flexDirection="row" width={total} height={rowsOf(CONTROL)} flexShrink={0} alignItems="center">
        <Box position="absolute" top={0} bottom={0} left={0} alignItems="center" justifyContent="center">
          {pic(el, 'sl-bias', ledStripArt(BIAS.length, per, chosen), name, total * CELL_PX, READOUT)}
        </Box>
        {BIAS.map(v => (
          <Box key={'st-bias-' + v} position="relative" width={per} height={rowsOf(CONTROL)} flexShrink={0} hover={{ backgroundColor: CROSSPOINT.column }}>
            {press(el, 'bias-' + v, per * CELL_PX, () => a.patch({ bias: v }))}
          </Box>
        ))}
      </Box>
      <Text dimColor>{t(frame.lang, 'settings.smarter')}</Text>
      {readout(el, 'bias-value', name, { ink: d.bias === 0 ? 'text' : d.bias < 0 ? 'accent2' : 'accent', widthPx: readoutArt('-2').width })}
    </Box>
  )
}

export function autoRow(el: Els, frame: Frame, view: SettingsView, a: SettingsActions): RenderNode {
  const { Text } = el
  const L = frame.lang
  const d = view.settings
  return row(el, frame, {
    key: 'auto',
    lamp: d.effortAuto ? 'on' : 'bypass',
    coordinate: 'E1',
    code: 'AUTO',
    title: <Text bold wrap="wrap">{t(L, 'settings.effortAuto')}</Text>,
    head: power(el, 'set-auto', d.effortAuto, t(L, d.effortAuto ? 'band.on' : 'band.off'), () => a.patch({ effortAuto: !d.effortAuto })),
    line: t(L, 'settings.autoLine'),
    body: d.effortAuto ? [lean(el, frame, d, a), note(el, 'lean-note', t(L, 'settings.leanHint'))] : [note(el, 'auto-off', t(L, 'settings.autoOffNote'))],
  })
}

export function judgeRow(el: Els, frame: Frame, view: SettingsView, a: SettingsActions): RenderNode {
  const { Box, Text } = el
  const L = frame.lang
  const d = view.settings
  const body: RenderNode[] = [
    ports(el, 'judge', [
      { value: 'haiku', label: t(L, 'settings.haiku') },
      { value: 'jev', label: t(L, 'settings.jev') },
      { value: 'model', label: t(L, 'settings.routerModel') },
    ] as const, d.judge, judge => a.patch({ judge })),
  ]
  if (d.judge === 'model' && d.judgeModel) body.push(<Box key="judge-model-name" flexDirection="row" alignItems="center" columnGap={1}>{caption(el, 'judge-model-caption', t(L, 'settings.routerModel'))}{readout(el, 'judge-model-name', d.judgeModel)}</Box>)
  if (needsKey(view)) {
    const jev = view.jev
    const placeholder = t(L, 'settings.keyPaste')
    const cells = Math.max(20, frame.columns - LEAD_CELLS - 12)
    const field = 'Input' in el
      ? scanLine(el, 'jev-key', cells, <el.Input key="jev-key" placeholder={placeholder} value="" submitLabel={t(L, 'settings.saveKey')} onSubmit={(key: string) => a.jevKey(key)} />, 32, 'accent')
      : <Text dimColor>{placeholder}</Text>
    const result =
      jev.test.state === 'testing' ? <Text dimColor>{t(L, 'settings.testing')}</Text>
        : jev.test.state === 'ok' ? <Box flexDirection="row" alignItems="center" columnGap={1}>{pic(el, 'jev-lamp', lampArt('on'), 'ok', 7, 7)}<Text wrap="wrap">{jev.test.message ?? t(L, 'settings.keyWorks')}</Text></Box>
          : jev.test.state === 'fail' ? <Box flexDirection="row" alignItems="center" columnGap={1}>{pic(el, 'jev-lamp', lampArt('danger'), 'failed', 7, 7)}<Text wrap="wrap">{jev.test.message ?? t(L, 'settings.keyRejected')}</Text></Box>
            : null
    body.push(
      field,
      <Box key="jev-row" flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={1} rowGap={1}>
        {pressCell(el, 'jev-test', plateArt(t(L, 'settings.test'), 'quiet'), t(L, 'settings.test'), CONTROL, a.testJev)}
        {result}
      </Box>,
    )
  }
  return row(el, frame, { key: 'judge', lamp: 'on', coordinate: 'J2', code: 'JUDGE', title: <Text bold wrap="wrap">{t(L, 'settings.judge')}</Text>, line: t(L, 'settings.judgeLine'), body })
}

export function modeRow(el: Els, frame: Frame, view: SettingsView, a: SettingsActions): RenderNode {
  const { Text } = el
  const L = frame.lang
  const d = view.settings
  const items = modeItems(frame, d)
  const current = d.activeMode ?? ''
  const control = items.length <= 5 || !('Select' in el)
    ? ports(el, 'mode', items, current, id => a.setMode?.(id))
    : <el.Select key="mode" options={items} value={current} onSelect={(value: string) => a.setMode?.(value)} />
  return row(el, frame, { key: 'mode', lamp: current ? 'on' : 'off', coordinate: 'M3', code: 'MODE', title: <Text bold wrap="wrap">{t(L, 'settings.mode')}</Text>, line: t(L, 'settings.modeLine'), body: [control] })
}

export function warmRow(el: Els, frame: Frame, view: SettingsView, a: SettingsActions): RenderNode {
  const { Text } = el
  const L = frame.lang
  const d = view.settings
  return row(el, frame, {
    key: 'warm',
    lamp: d.keepWarm ? 'on' : 'bypass',
    coordinate: 'W4',
    code: 'WARM',
    title: <Text bold wrap="wrap">{t(L, 'settings.keepWarm')}</Text>,
    head: power(el, 'set-warm', d.keepWarm, t(L, d.keepWarm ? 'band.on' : 'band.off'), () => a.patch({ keepWarm: !d.keepWarm })),
    line: t(L, 'settings.warmLine'),
    body: [note(el, 'warm-cost', t(L, 'settings.warmCostShort'))],
  })
}

export function skinRow(el: Els, frame: Frame, view: SettingsView, a: SettingsActions): RenderNode {
  const { Text } = el
  const L = frame.lang
  const d = view.settings
  const options = SKINS.map(skin => ({ value: skin, label: t(L, skin === 'deep' ? 'settings.skinDeep' : skin === 'flat' ? 'settings.skinFlat' : 'settings.skinMatrix') }))
  return row(el, frame, { key: 'skin', lamp: 'on', coordinate: 'S5', code: 'SKIN', title: <Text bold wrap="wrap">{t(L, 'settings.skin')}</Text>, line: t(L, 'settings.skinLine'), body: [ports<Skin>(el, 'skin', options, d.skin, skin => a.patch({ skin }))] })
}

/** The masthead: 리플이, the name, the ways out, and a board line of what the settings do now. */
function masthead(el: Els, frame: Frame, face: Face, title: string, aside: string | RenderNode, line: string, ways: RenderNode[], size = 36): RenderNode {
  const { Box, Text } = el
  return (
    <Box key="masthead" flexDirection="column" rowGap={0} width="100%" minWidth={0}>
      <Box key="masthead-row" flexDirection="row" alignItems="center" columnGap={2} width="100%" minWidth={0} height={2}>
        {mascot(el, 'masthead', face, title, size)}
        <Box flexDirection="row" alignItems="center" columnGap={1} flexGrow={1} flexShrink={1} minWidth={0} flexWrap="wrap">
          <Text bold>{title}</Text>
          {typeof aside === 'string' ? <Text dimColor>{aside}</Text> : aside}
        </Box>
        <Box flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
          {ways}
        </Box>
      </Box>
      {scanLine(el, 'masthead-line', Math.max(20, frame.columns - 2 * PAD_X - 2), <Text wrap="truncate">{line}</Text>)}
    </Box>
  )
}

/** The masthead's height, px: two host rows and the board line with its air. */
const MASTHEAD_PX = 2 * ROW_PX + READOUT + 8

export function boardSettings(el: Els, frame: Frame, view: SettingsView, a: SettingsActions): RenderNode {
  const { Box } = el
  const L = frame.lang
  const d = view.settings
  const head = masthead(el, frame, d.effortAuto ? 'calm' : 'drowsy', t(L, 'settings.quick'), t(L, 'band.brand'), settingsSay(frame, d), [
    pressCell(el, 'all-settings', plateArt(t(L, 'settings.openAll'), 'quiet'), t(L, 'settings.openAll'), CONTROL, a.openAllSettings),
    closeCell(el, 'close', t(L, 'settings.close'), a.close),
  ])
  const rows = (
    <Box key="settings-rows" flexDirection="column" width="100%" minWidth={0}>
      {autoRow(el, frame, view, a)}
      {judgeRow(el, frame, view, a)}
      {modeRow(el, frame, view, a)}
      {warmRow(el, frame, view, a)}
      {skinRow(el, frame, view, a)}
    </Box>
  )
  return capsule(el, frame, {
    key: 'settings',
    lamp: d.effortAuto ? 'on' : 'bypass',
    lampY: Math.round(ROW_PX / 2) - 2,
    headerPx: MASTHEAD_PX,
    rows: 34 + (needsKey(view) ? 5 : 0),
    paddingX: 0,
    children: [
      <Box key="settings-head" paddingX={PAD_X} paddingLeft={LEAD_CELLS - 4} paddingBottom={0.5}>{head}</Box>,
      <Box key="settings-rule">{pic(el, 'settings-rule', ruleArt(boardWidth(frame)), '', boardWidth(frame), 1)}</Box>,
      rows,
    ],
  })
}

// ---- A card: one posted row --------------------------------------------------------------------
//
// The rail and lamp carry the card's state (amber for a caution, red when something failed, the
// accent while it asks, blinking while it works, green when done), the code cell names what it is
// about, 리플이 keeps its face, the title and the why are host Text, and the actions sit in the
// body: the main one an EXECUTE plate, the quiet ones cells, the way out a `×` cell.

const CARD_FACE = 34

function cardLamp(alert: AlertView, key: string): Lamp {
  switch (key) {
    case 'cold': return 'bypass'
    case 'kept': return 'on'
    case 'swamp': return 'bypass'
    case 'hot': return (alert.kind === 'hot' && alert.percent >= 95) ? 'danger' : 'bypass'
    case 'judge': return 'danger'
    case 'note':
    case 'clear':
    case 'handoff': return 'busy'
    default: {
      const stage = alert.kind === 'result' ? alert.stage : 'failed'
      if (stage === 'handingOff' || stage === 'compacting') return 'busy'
      if (stage === 'failed') return 'danger'
      if (stage === 'handoffReady') return 'busy'
      return 'on'
    }
  }
}

const CARD_CODE: Record<string, string> = { cold: 'COLD', kept: 'KEPT', swamp: 'HEAVY', hot: 'LIMIT', judge: 'JUDGE', note: 'COMPACT', clear: 'CLEAR', handoff: 'HANDOFF', result: 'RESULT' }

function cardExtras(el: Els, frame: Frame, alert: AlertView, a: AlertActions): RenderNode[] {
  const { Box, Text } = el
  if (alert.kind === 'compactNote' && 'Input' in el) {
    const Field = el.Input
    const name = t(frame.lang, 'alerts.keep').trim()
    const placeholder = t(frame.lang, 'alerts.keepPlaceholder')
    const cells = Math.max(20, frame.columns - LEAD_CELLS - Math.ceil(chOf(name)) - 8)
    return [
      <Box key="note-row" flexDirection="row" alignItems="center" columnGap={2} width="100%" minWidth={0}>
        <Text dimColor>{name}</Text>
        {scanLine(el, 'note', cells, (
          <Field key="note" placeholder={placeholder} value={alert.draft} submitLabel={t(frame.lang, 'alerts.compactSubmit')} autoFocus onInput={(text: string) => a.noteInput(text)} onSubmit={(text: string) => a.compact(text)} />
        ), 32, 'accent')}
      </Box>,
    ]
  }
  if (alert.kind !== 'handoffChoice') return []
  const kinds = [{ value: 'quick' as const, label: t(frame.lang, 'alerts.quick') }, { value: 'full' as const, label: t(frame.lang, 'alerts.full') }]
  const afters = [{ value: 'continue' as const, label: t(frame.lang, 'alerts.continue') }, { value: 'confirm' as const, label: t(frame.lang, 'alerts.confirm') }, { value: 'copy' as const, label: t(frame.lang, 'alerts.copy') }]
  const names = [t(frame.lang, 'alerts.kind'), t(frame.lang, 'alerts.then')].map(n => n.trim())
  const line = (key: string, name: string, control: RenderNode) => (
    <Box key={key} flexDirection="row" alignItems="center" columnGap={2}>
      {caption(el, 'caption-' + key, name)}
      {control}
    </Box>
  )
  return [
    <Box key="choices" flexDirection="column" rowGap={1}>
      {line('kind', names[0]!, ports(el, 'kind', kinds, alert.handoffKind, k => a.setHandoffKind(k)))}
      {line('after', names[1]!, ports(el, 'after', afters, alert.after, k => a.setHandoffAfter(k)))}
      <Text dimColor wrap="wrap">{afterHint(frame, alert.after)}</Text>
    </Box>,
  ]
}

export function boardAlert(el: Els, frame: Frame, alert: AlertView, a: AlertActions): RenderNode {
  const { Box, Text } = el
  const card = cardOf(frame, alert, a)
  const lamp = cardLamp(alert, card.key)
  const fieldSubmits = alert.kind === 'compactNote' && 'Input' in el
  const main = card.main && !fieldSubmits ? card.main : undefined
  const quiet = card.quiet ?? []
  const extras = cardExtras(el, frame, alert, a)
  const actions = main || quiet.length || card.close ? (
    <Box key="actions" flexDirection="row" alignItems="center" columnGap={1} flexWrap="wrap" rowGap={1}>
      {main ? pressCell(el, main.key, plateArt(main.label, 'execute'), main.label, CONTROL, main.onPress) : null}
      {quiet.map(c => pressCell(el, c.key, plateArt(c.label, 'quiet'), c.label, CONTROL, c.onPress))}
      {card.close ? closeCell(el, card.close.key, card.close.label, card.close.onPress) : null}
    </Box>
  ) : null
  const rows = 4 + (extras.length ? 3.5 : 0) + (actions ? 1.6 : 0)
  return capsule(el, frame, {
    key: 'alert-' + card.key,
    lamp,
    lampY: ROW_PX,
    rows,
    paddingX: 0,
    children: [
      row(el, frame, {
        key: 'card-' + card.key,
        lamp,
        coordinate: 'C1',
        code: CARD_CODE[card.key] ?? 'CARD',
        title: (
          <Box flexDirection="row" alignItems="center" columnGap={1} minWidth={0}>
            {mascot(el, 'card-' + card.key, card.face, card.title, CARD_FACE, card.percent)}
            <Text bold wrap="wrap">{card.title}</Text>
          </Box>
        ),
        line: card.body,
        body: [...extras, ...(actions ? [actions] : [])],
      }),
    ],
  })
}

// ---- Setup: the board's first posting ----------------------------------------------------------

export function boardSetup(el: Els, frame: Frame, view: SetupView, a: SetupActions): RenderNode {
  const { Box, Text } = el
  const L = frame.lang
  const asSettings: SettingsView = { settings: view.draft, jev: view.jev }
  const asActions: SettingsActions = { ...a, close: () => undefined }
  const d = view.draft
  const done = view.step === 4
  const step = done ? null : STEPS[view.step - 1]!
  const face: Face = done ? 'pleased' : view.step === 1 ? 'asking' : 'calm'
  const title = done ? t(L, 'setup.ready') : view.step === 1 ? t(L, 'setup.welcome') : t(L, step!.title)
  const line = done ? t(L, 'setup.changeDashboard') : t(L, step!.blurb)
  const steps = stepsArt(done ? 4 : view.step, 3)
  const summary = done
    ? [
        [t(L, 'band.effort'), t(L, 'setup.effortSummary', { state: t(L, d.effortAuto ? 'band.on' : 'band.off').toLowerCase(), judge: d.judge === 'haiku' ? t(L, 'settings.haiku') : d.judge === 'jev' ? t(L, 'settings.jev') : d.judgeModel })],
        [t(L, 'settings.workers'), workersSummary(L, d)],
        [t(L, 'band.cache'), d.keepWarm ? t(L, 'setup.cacheSummary', { hours: d.keepWarmHours }) : t(L, 'setup.cacheOff')],
      ]
    : []
  const content: RenderNode[] = done
    ? [
        <Box key="summary" flexDirection="column" rowGap={1} paddingX={PAD_X} paddingLeft={LEAD_CELLS} paddingY={1}>
          {summary.map(([name, value], i) => (
            <Box key={'sum-' + i} flexDirection="row" columnGap={2} alignItems="center">
              {caption(el, 'sum-caption-' + i, name!)}
              <Text wrap="wrap">{value}</Text>
            </Box>
          ))}
        </Box>,
      ]
    : view.step === 1 ? [judgeRow(el, frame, asSettings, asActions)] : view.step === 3 ? [warmRow(el, frame, asSettings, asActions)] : []
  const next = done
    ? pressCell(el, 'finish', plateArt(t(L, 'setup.start'), 'execute'), t(L, 'setup.start'), CONTROL, a.finish)
    : pressCell(el, 'next', plateArt(view.step === 3 ? t(L, 'setup.finish') : t(L, 'setup.next'), 'execute'), t(L, 'setup.next'), CONTROL, a.next)
  const actions = (
    <Box key="actions" flexDirection="row" alignItems="center" columnGap={1} flexWrap="wrap" rowGap={1} paddingX={PAD_X} paddingLeft={LEAD_CELLS} paddingY={1}>
      {next}
      {!done && view.step === 2 ? pressCell(el, 'all-settings', plateArt(t(L, 'settings.openAll'), 'quiet'), t(L, 'settings.openAll'), CONTROL, a.openAllSettings) : null}
      {done || view.step > 1 ? pressCell(el, 'back', plateArt(t(L, 'setup.back'), 'quiet'), t(L, 'setup.back'), CONTROL, a.back) : null}
      {done ? null : pressCell(el, 'skip', plateArt(t(L, 'setup.skip'), 'quiet'), t(L, 'setup.skip'), CONTROL, a.skip)}
    </Box>
  )
  return capsule(el, frame, {
    key: 'setup',
    lamp: done ? 'on' : 'busy',
    lampY: Math.round(ROW_PX / 2) - 2,
    headerPx: MASTHEAD_PX,
    rows: 8 + (done ? 6 : view.step === 1 ? 10 : view.step === 3 ? 7 : 0) + (frame.columns < 70 ? 4 : 0),
    paddingX: 0,
    children: [
      <Box key="setup-head" paddingX={PAD_X} paddingLeft={LEAD_CELLS - 4} paddingBottom={0.5}>
        {masthead(el, frame, face, title, done ? '' : cell(el, 'setup-steps', steps, view.step + ' / 3', CODE), line, [], 48)}
      </Box>,
      <Box key="setup-rule">{pic(el, 'setup-rule', ruleArt(boardWidth(frame)), '', boardWidth(frame), 1)}</Box>,
      ...content,
      actions,
    ],
  })
}
