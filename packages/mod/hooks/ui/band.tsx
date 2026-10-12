// The dashboard band above the prompt, and its minimal form in the footer.
//
// One quiet row of native text: on the desktop 리플이 first (20 px, acting out what the band is
// doing: thinking while Auto picks, busy while a request is out, drowsy as the cache runs out,
// asleep once it has, otherwise its idle life), the effort, the cache countdown in whole minutes,
// the context and plan-limit figures when switched on in Look, the last route; then small toggles
// at the right end (Handoff when advised, Auto, Warm, Log, Agents, settings), with air but no rule
// between the two. What a caption used to say sits in a hover card on the desktop. The terminal
// draws the same facts, without 리플이.
//
// Two facts of the desktop host shape it (claude.ai assets c2719cf1b-C7sTDzb6.js, read 2026-10-10):
// - Each answer the band gives is drawn as a freshly built DOM tree swapped in for the last one
//   (`Qc`: `o.replaceWith(a)`), and an Svg becomes a new <img> of a data URL or, interactive, a new
//   sandboxed <iframe srcdoc> (`Pa`). The frame paints blank until loaded, so an interactive Svg
//   blinked on every redraw; the image does not (seen in the owner's app, 2026-10-11), and its CSS
//   motion runs. So 리플이 is the band's one picture, a plain image whose source is fixed per mood
//   (bandMood): a redraw hands the host the same document and only starts its motion over.
// - The surface asks again on every write of state the band read and on every invalidate, and
//   takes each answer as new (`if(t===n)return` compares the object). So the countdown shows whole
//   minutes, and register.tsx invalidates only when the minute shown changes.
//
// - In the band the host draws every Button the size of a small control (its own padding, a
//   control's height), and a plain Button under the pointer turns full ink on a ghost fill whether
//   it is dimmed or not (`button[data-press-dim]:hover{color:text.primary}`). So a toggle told by
//   dimness alone looks the same on and off right after the click: on the desktop a toggle that is
//   on, an open pane, the advised Handoff and the picked level are primary Buttons (the host's
//   filled accent), the rest plain and dimmed. Both have the same box, so a press moves nothing.
//
// No item's width depends on its value: each fact has a slot sized for the widest value its
// language can show (in cells, East Asian wide characters two); on the desktop the route takes what
// the row leaves (a flex item, cut by the host only when the row has no room for the whole name),
// on the terminal the room the frame's width leaves. The controls sit at the right end with the one
// that comes and goes (Handoff) first, so a changing value never moves a neighbour.

import { t } from '../i18n'
import type { Lang } from '../i18n'
import type { RenderChildren, RenderNode } from 'claude-code'

import type { Effort } from '../../types'
import { rippleSource, textButton } from './parts'
import type { Els } from './parts'
import type { Face } from './ripple'
import { cacheTone, chOf, clip, contextTone, displayWidth, limitTone, textTone } from './theme'
import type { BandActions, DashboardView, Frame } from './view'
import { EFFORTS, effortIndex, effortLabel, effortName, isRich, limitName, minutesLeft, resetsLabel, seconds, compactNumber } from './view'

/** Growing ripples: low → max. */
const RIPPLE_CHAR = ['·', '∘', '○', '◎', '◉']
/** Theme keys: they follow the person's light or dark theme on every surface. */
const WARN = 'warning'
const BAD = 'error'
/** Cells between facts, and between controls. */
const GAP = 2
const CTRL_GAP = 1
/** The least room a route is drawn in; on the desktop the host cuts the name to what is left. */
const ROUTE_MIN = 14
const RICH_ROUTE_MIN = 6
/** Desktop: the slot of the live agents' count after its control. */
const COUNT_CELLS = 2
/** 리플이 in the band, px: one text line high, so the mini drawing (ripple.ts). */
export const BAND_RIPPLE = 20
/**
 * Desktop: 리플이's slot at the row's start, in cells: 20 px in a ch of 8.8 px, rounded up, the
 * rest its air. All the facts' room gives up for it (the ∿ glyph and its gap took the same).
 */
const MARK_SLOT = 3
const MARK_CELLS = MARK_SLOT
/** Without an Svg in the table, the crest as a glyph: one cell in the host's sans (∿ 8.2 px at 14 px). */
const CREST = '∿'
/** The cache's last stretch, when 리플이 grows drowsy: five minutes, or a fifth of a short life. */
const DROWSY_MS = 5 * 60_000

/** What 리플이 acts out in the band, and so which of its fixed sources the band shows. */
export type BandMood = { face: Extract<Face, 'thinking' | 'working' | 'drowsy' | 'sleepy' | 'calm'>; dim: boolean }

/**
 * Thinking while Auto picks, working while a request is out, asleep once the cache has run out
 * and drowsy in its last minutes (not while keep-warm holds it), else its idle life; dimmed at
 * rest when Auto is off or paused. Read from whole minutes, as the countdown is, so the mood
 * changes no more often than what the band shows.
 */
export function bandMood(frame: Frame, view: DashboardView): BandMood {
  const quiet = view.effort.mode === 'off' || view.effort.mode === 'paused'
  if (view.effort.mode === 'deciding') return { face: 'thinking', dim: false }
  if (view.isWorking) return { face: 'working', dim: false }
  const cache = view.cache
  if (cache && !view.hide.includes('timer')) {
    const left = cache.expiresAt - frame.now
    if (left <= 0) return { face: 'sleepy', dim: quiet }
    const shown = Math.ceil(left / 60_000) * 60_000
    const held = view.warm.on && !view.warm.stopped
    if (!held && shown <= Math.min(DROWSY_MS, cache.ttlMs / 5)) return { face: 'drowsy', dim: quiet }
  }
  return { face: 'calm', dim: quiet }
}
/** The reason's slot on a wide terminal. */
const WHY_CELLS = 28

type Run = { text: string; color?: string; dim?: boolean; bold?: boolean }

/** One fact of the band: a slot of fixed width holding a glyph, a value and quiet trailing runs. */
type Fact = {
  key: string
  /** Cells the slot takes, whatever it shows. */
  width: number
  /** Desktop: a quiet name before the value, so a bare "60 min" says what it is. */
  label?: Run
  glyph?: Run
  value: Run
  /** The value is a button (desktop): the effort opens its menu, the route the log. */
  onPress?: () => void
  /** Desktop: the slot takes the room the row leaves instead of `width` (the route). */
  grow?: true
  tail?: Run[]
  /** What a hover card says, a line each (desktop). */
  card?: string[]
}

/**
 * Cells `text` takes: terminal columns, or on the desktop the host's `ch`, the width of "0" in its
 * 14 px sans. Measured 2026-10-10 in Chromium on macOS: ch 8.8 px, Hangul and kana ~12 px (1.36 ch),
 * "Medium" 5.9 ch, "X-High" 5.1 ch. Each class of character is taken a little wide of that; the
 * terminal's 2 cells for a wide character would leave a gap after every short Korean value.
 */
function cells(frame: Frame, text: string): number {
  return isRich(frame) ? Math.ceil(chOf(text)) : displayWidth(text)
}

function widest(frame: Frame, texts: readonly string[]): number {
  return Math.max(1, ...texts.map(text => cells(frame, text)))
}

/** The host's padding either side of a Button's label in the band, in ch (about 8 px each). */
const PAD = 2

/** What the effort slot can show: the names and "Deciding…" (a dash when there is no level). */
function effortWords(lang: Lang, rich: boolean): string[] {
  const words = [...EFFORTS.map(e => effortName(e, lang)), t(lang, 'band.deciding')]
  return rich ? words : words.map(w => w.toLowerCase())
}

// ---- Facts -------------------------------------------------------------------------------------

function effortFact(frame: Frame, view: DashboardView, onPress: () => void): Fact {
  const rich = isRich(frame)
  const accent = textTone(frame.appearance).accent
  const { level, mode, why } = view.effort
  const idx = effortIndex(level)
  const quiet = mode === 'off' || mode === 'paused'
  const glyph: Run =
    mode === 'deciding' ? { text: '◌', color: accent } : mode === 'paused' ? { text: '‖', dim: true } : { text: idx >= 0 ? RIPPLE_CHAR[idx]! : '○', ...(mode === 'auto' ? { color: accent } : quiet ? { dim: true } : {}) }
  // Paused or off with no level known: a dash; the glyph, the Auto toggle and the card say why.
  const word = mode === 'deciding' ? t(frame.lang, 'band.deciding') : level ? effortName(level, frame.lang) : '—'
  const label = rich ? word : word.toLowerCase()
  const value: Run = mode === 'deciding' ? { text: label, color: accent } : quiet ? { text: label, dim: true } : { text: label, bold: !rich }
  const tag = t(frame.lang, mode === 'auto' || mode === 'deciding' ? 'band.auto' : mode === 'manual' ? 'band.manual' : mode === 'paused' ? 'band.paused' : 'band.autoOff')
  const hint =
    mode === 'paused' ? t(frame.lang, 'band.pausedHint') : mode === 'off' ? t(frame.lang, 'band.offHint') : mode === 'deciding' ? t(frame.lang, 'band.decidingHint') : why && !view.hide.includes('reason') ? why : ''
  // Terminal: glyph, a cell, the label. Desktop: the glyph, then the label's button, whose own
  // padding is the air on both sides.
  // The desktop names the slot instead of a glyph: a ripple a few pixels across read as noise, not
  // as a level. A cell to spare: a host font a little wider than the estimate must not wrap it.
  const name = t(frame.lang, 'band.effortShort')
  const width = rich ? Math.ceil(chOf(name) + PAD + 1 + Math.max(...effortWords(frame.lang, rich).map(chOf))) : 2 + widest(frame, effortWords(frame.lang, rich))
  return {
    key: 'effort',
    width,
    ...(rich ? { label: { text: name, dim: true } } : { glyph }),
    value,
    ...(rich ? { onPress } : {}),
    card: [[view.model, tag].filter(Boolean).join(' · '), t(frame.lang, 'band.effortTitle', { value: word, hint: hint ? ' — ' + hint : '' })],
  }
}

/** Cells a mode's name may take in the band; a longer one is cut with an ellipsis. */
export const MODE_CELLS = 12

/** The active mode's name as the band shows it: whole, or cut to its slot. */
export function modeLabel(name: string): string {
  return clip(name, MODE_CELLS)
}

/**
 * The active operating mode, when one is on: "Mode Burn GPT" in the accent, its slot the same
 * width whatever the name (cut past MODE_CELLS), the whole name in the hover card.
 */
function modeFact(frame: Frame, view: DashboardView): Fact | null {
  if (!view.mode) return null
  const rich = isRich(frame)
  const name = t(frame.lang, 'band.mode')
  const value: Run = { text: rich ? modeLabel(view.mode) : name + ' ' + modeLabel(view.mode), color: textTone(frame.appearance).accent }
  const card = [t(frame.lang, 'band.modeTip', { name: view.mode })]
  // Desktop: a cell is about a ch; Latin capitals run a little wider, so the slot takes 1.1 ch each.
  if (rich) return { key: 'mode', width: Math.ceil(chOf(name) + 1 + MODE_CELLS * 1.1), label: { text: name, dim: true }, value, card }
  return { key: 'mode', width: cells(frame, name) + 1 + MODE_CELLS, value, card }
}

/** The pie a share of the cache's life reads as. */
function pie(frac: number): string {
  return frac > 0.875 ? '●' : frac > 0.625 ? '◕' : frac > 0.375 ? '◑' : frac > 0.125 ? '◔' : '○'
}

function cacheFact(frame: Frame, view: DashboardView): Fact | null {
  if (view.hide.includes('timer')) return null
  const accent = textTone(frame.appearance).accent
  const cache = view.cache
  const left = cache ? cache.expiresAt - frame.now : 0
  // Whole minutes, as shown: the slot changes once a minute and no more.
  const shown = cache && left > 0 ? Math.ceil(left / 60_000) : 0
  const warm = view.warm
  const lit = warm.on && !warm.stopped
  const last = shown === 1
  const glyph: Run = { text: shown > 0 && cache ? pie(Math.min(1, (shown * 60_000) / cache.ttlMs)) : '○', ...(last ? { color: WARN } : lit && shown > 0 ? { color: accent } : { dim: true }) }
  const text = cache ? minutesLeft(left, frame.lang) : '—'
  const value: Run = last ? { text, color: WARN } : { text, dim: shown === 0 }
  const tip = cache
    ? t(frame.lang, 'band.cacheTip', {
        state: shown > 0 ? t(frame.lang, 'band.warmFor', { time: text }) : t(frame.lang, 'band.expired'),
        warm: warm.on ? (warm.stopped ? t(frame.lang, 'band.warmStoppedTip', { reason: warm.stopped }) : t(frame.lang, 'band.warmOnTip', { count: warm.pings })) : '',
      })
    : t(frame.lang, 'band.noReply')
  const words = [t(frame.lang, 'units.minutes', { n: 60 }), t(frame.lang, 'band.cold'), '—']
  if (!isRich(frame)) return { key: 'cache', width: 2 + widest(frame, words), glyph, value, card: [tip] }
  // Desktop: "Cache 58 min", the last minute in the warning colour; the pie read as a status dot.
  const name = t(frame.lang, 'band.cache')
  return { key: 'cache', width: Math.ceil(chOf(name) + 1 + Math.max(...words.map(chOf))), label: { text: name, dim: true }, value, card: [tip] }
}

function contextFact(frame: Frame, view: DashboardView): Fact | null {
  const ctx = view.context
  if (!ctx || !view.extras.includes('context')) return null
  const tone = contextTone(ctx.percent, view.swampAt)
  const rich = isRich(frame)
  // Desktop: "Context 38%" in the facts' idiom; the terminal keeps its short "ctx 38%".
  const text = rich ? Math.round(ctx.percent) + '%' : t(frame.lang, 'band.footerContext', { percent: Math.round(ctx.percent) })
  const value: Run = tone === 'ink' ? { text, dim: !rich } : { text, color: tone === 'warn' ? WARN : BAD }
  const name = t(frame.lang, 'band.context')
  const width = rich ? Math.ceil(chOf(name) + 1 + chOf('100%')) : cells(frame, t(frame.lang, 'band.footerContext', { percent: 100 }))
  return { key: 'context', width, ...(rich ? { label: { text: name, dim: true } } : {}), value, card: [t(frame.lang, 'band.contextAlt', { value: Math.round(ctx.percent) + '%', window: compactNumber(ctx.window), tokens: compactNumber(ctx.tokens) })] }
}

function limitFact(frame: Frame, view: DashboardView): Fact | null {
  const limit = view.limit
  if (!limit || !view.extras.includes('limits')) return null
  const tone = limitTone(limit.percent)
  const rich = isRich(frame)
  const save = t(frame.lang, 'band.save')
  const tail: Run[] = limit.save ? [{ text: save, color: textTone(frame.appearance).accent }] : []
  const resets = resetsLabel(limit.resetsAt, frame.now, frame.lang)
  const card = [t(frame.lang, 'band.limitAlt', { window: limitName(limit.kind, frame.lang), value: Math.round(limit.percent) + '%', reset: resets ? ', ' + resets : '' })]
  if (rich) {
    // Desktop: "5h limit 64%", not a bare "5h 64%".
    const names = (['five_hour', 'seven_day'] as const).map(kind => t(frame.lang, 'band.limitCaption', { window: limitName(kind, frame.lang), save: '' }))
    const text = Math.round(limit.percent) + '%'
    const value: Run = tone === 'ink' ? { text } : { text, color: tone === 'warn' ? WARN : BAD }
    const width = Math.ceil(Math.max(...names.map(chOf)) + 1 + chOf('100%') + 1 + chOf(save))
    return { key: 'limit', width, label: { text: names[limit.kind === 'five_hour' ? 0 : 1]!, dim: true }, value, tail, card }
  }
  const text = limitName(limit.kind, frame.lang) + ' ' + Math.round(limit.percent) + '%'
  const value: Run = tone === 'ink' ? { text, dim: true } : { text, color: tone === 'warn' ? WARN : BAD }
  const width = widest(frame, [limitName('five_hour', frame.lang), limitName('seven_day', frame.lang)]) + cells(frame, ' 100%') + 1 + cells(frame, save)
  return { key: 'limit', width, value, tail, card: [t(frame.lang, 'band.limitAlt', { window: limitName(limit.kind, frame.lang), value: Math.round(limit.percent) + '%', reset: resets ? ', ' + resets : '' })] }
}

/** The last route in `room` cells, or the router's notice; null when there is neither or no room. */
function routeFact(frame: Frame, view: DashboardView, room: number, onPress: () => void): Fact | null {
  const rich = isRich(frame)
  if (view.hide.includes('route') || room < (rich ? RICH_ROUTE_MIN : ROUTE_MIN)) return null
  const r = view.route
  if (!r) {
    if (!view.notice) return null
    return { key: 'route', width: room, ...(rich ? { grow: true as const } : {}), value: { text: clip(view.notice.replace(/^ClaudeRipple:\s*/, ''), room), dim: true } }
  }
  const glyph: Run = r.resent ? { text: '↻', dim: true } : r.ok ? { text: rich ? '→' : '↳', dim: true } : { text: '✕', color: BAD }
  // The desktop says what the figure is ("hit 100%"); a bare percentage beside a model name read as anything.
  const hit = r.cachePct !== undefined ? (rich ? t(frame.lang, 'band.hit', { percent: r.cachePct }) : r.cachePct + '%') : ''
  const tail: Run[] = !r.ok
    ? [r.resent ? { text: t(frame.lang, 'band.resent', { status: r.status }), dim: true } : { text: r.status, color: BAD }]
    : r.cachePct !== undefined
      ? [cacheTone(r.cachePct) === 'ok' ? { text: hit, dim: true } : { text: hit, color: cacheTone(r.cachePct) === 'warn' ? WARN : BAD }]
      : []
  const tailCells = tail.reduce((n, run) => n + 1 + cells(frame, run.text), 0)
  const modelRoom = room - 2 - tailCells
  if (!rich && modelRoom < 4) return null
  const secs = seconds(r.seconds, frame.lang)
  const card = [
    t(frame.lang, 'band.routeAlt', { model: r.model, provider: r.provider, effort: r.effort ? ', ' + effortLabel(r.effort, frame.lang) : '', cache: r.cachePct !== undefined ? t(frame.lang, 'band.routeCache', { percent: r.cachePct }) : '', time: secs, status: r.ok ? '' : t(frame.lang, r.resent ? 'band.routeResent' : 'band.routeFailed', { status: r.status }) }),
    ...(r.note ? [r.note] : []),
    t(frame.lang, 'band.logHint'),
  ]
  // The desktop shows the whole name in whatever the row leaves; the host cuts it only past that.
  if (rich) return { key: 'route', width: room, grow: true, glyph, value: { text: r.model, dim: true }, onPress, tail, card }
  return { key: 'route', width: room, glyph, value: { text: clip(r.model, modelRoom) }, tail, card }
}

// ---- Controls ----------------------------------------------------------------------------------

/**
 * A control: its label, the terminal's hotkey, and whether it is on (a toggle that is on, an open
 * pane, the advised Handoff). The desktop draws an on control as a primary Button and the rest
 * plain and dimmed; the terminal says it in the label (● / ○), as its plain Buttons take no colour.
 */
type Control = { key: string; label: string; hotkey: string; onPress: () => void; on: boolean; count?: string }

function controls(frame: Frame, view: DashboardView, actions: BandActions): Control[] {
  const rich = isRich(frame)
  const L = frame.lang
  const mark = (on: boolean) => (rich ? '' : on ? ' ●' : ' ○')
  const out: Control[] = []
  // Handoff comes and goes; first in the row, it moves nothing when it does.
  if (view.handoff !== 'off') {
    const advised = view.handoff === 'advised'
    out.push({ key: 'handoff', label: t(L, 'band.handoff') + (!rich && advised ? ' ◆' : ''), hotkey: 'h', onPress: actions.handoff, on: advised })
  }
  out.push(
    { key: 'auto', label: t(L, 'band.auto') + mark(view.auto), hotkey: 'a', onPress: actions.toggleAuto, on: view.auto },
    { key: 'warm', label: t(L, 'band.warm') + mark(view.warm.on), hotkey: 'w', onPress: actions.toggleWarm, on: view.warm.on },
    // The desktop opens the log from the route itself (its value is that button), so it has no Log of its own.
    ...(rich ? [] : [{ key: 'log', label: t(L, 'band.log') + mark(view.logOpen), hotkey: 'l', onPress: actions.toggleLog, on: view.logOpen }]),
    // The count has a slot of its own (desktop) or is always a number (terminal): no width change.
    { key: 'agents', label: t(L, 'band.agents') + (rich ? '' : ' ' + (view.agents.live || '·')) + mark(view.agentsOpen), hotkey: 'g', onPress: actions.toggleAgents, on: view.agentsOpen, ...(rich ? { count: view.agents.live > 0 ? String(view.agents.live) : '' } : {}) },
    // A word on the desktop: the host's 14 px font draws ⚙ as a small ring that reads as "o".
    { key: 'settings', label: rich ? t(L, 'band.settings') : '⚙', hotkey: 's', onPress: actions.openSettings, on: false },
  )
  return out
}

/** Cells a control takes. Desktop: the label in the button's padding, then the count's slot. */
function controlCells(frame: Frame, c: Control): number {
  if (!isRich(frame)) return cells(frame, c.hotkey) + 2 + cells(frame, c.label)
  return cells(frame, c.label) + PAD + (c.count !== undefined ? COUNT_CELLS : 0)
}

/** Every control's cells, Handoff counted whether shown or not, so the route's room stays put. */
function controlsCells(frame: Frame, view: DashboardView, actions: BandActions): number {
  const list = controls(frame, { ...view, handoff: 'advised' }, actions)
  return list.reduce((n, c) => n + controlCells(frame, c), 0) + CTRL_GAP * (list.length - 1) * (isRich(frame) ? 1 : 2)
}

// ---- Layout ------------------------------------------------------------------------------------

const span = (facts: readonly Fact[]) => facts.reduce((n, f) => n + f.width, 0) + GAP * Math.max(0, facts.length - 1)

/** The facts in order, the route in what the row leaves it. */
function factsFor(frame: Frame, view: DashboardView, actions: BandActions, room: number, drop: readonly string[] = []): Fact[] {
  const fixed = [effortFact(frame, view, actions.toggleEffortMenu), modeFact(frame, view), contextFact(frame, view), cacheFact(frame, view), limitFact(frame, view)].filter(
    (f): f is Fact => f !== null && !drop.includes(f.key),
  )
  const left = room - span(fixed) - (fixed.length ? GAP : 0)
  // The desktop's route is a flex item: it takes what the row really leaves (the room counted here
  // keeps Handoff's place, which it mostly does not need) and the host cuts its name past that.
  const route = drop.includes('route') ? null : routeFact(frame, view, isRich(frame) ? Math.max(left, RICH_ROUTE_MIN) : left, actions.toggleLog)
  return route ? [...fixed, route] : fixed
}

// ---- Desktop -----------------------------------------------------------------------------------

function runText(el: Els, key: string, run: Run): RenderNode {
  const { Text } = el
  return (
    <Text key={key} color={run.color} dimColor={run.dim} bold={run.bold}>
      {run.text}
    </Text>
  )
}

function card(el: Els, f: Fact): RenderNode {
  const { Box, Text } = el
  if (!f.card) return ''
  return (
    <Box position="absolute" left={0} bottom={1} display="none" hover={{ display: 'flex' }} flexDirection="column">
      {f.card.map(line => <Text>{line}</Text>)}
    </Box>
  )
}

function factRich(el: Els, f: Fact): RenderNode {
  const { Box, Button } = el
  // A pressable value brings its button's padding, which is the air after the glyph; a text value
  // is a cell from it.
  const gap = f.onPress ? 0 : 1
  const value = f.onPress ? <Button key={f.key} plain dimColor={f.value.dim} label={f.value.text} onPress={() => f.onPress!()} /> : runText(el, 'value', f.value)
  if (f.grow) {
    // The route: its own width (the reason takes what is left after it), the name cut by the host
    // only when the row has no room for it, its cache figure kept whole after it.
    return (
      <Box key={'fact-' + f.key} flexDirection="row" flexShrink={1} minWidth={0}>
        <Box flexDirection="row" alignItems="center" columnGap={gap} flexShrink={1} minWidth={0} overflow="hidden">
          {f.glyph ? <Box flexShrink={0}>{runText(el, 'glyph', f.glyph)}</Box> : null}
          <Box flexDirection="row" flexShrink={1} minWidth={0}>
            {value}
          </Box>
          {f.tail?.length ? (
            <Box flexDirection="row" columnGap={1} flexShrink={0}>
              {f.tail.map((run, i) => runText(el, 'tail-' + i, run))}
            </Box>
          ) : null}
        </Box>
        {card(el, f)}
      </Box>
    )
  }
  return (
    // Keyed: the hover card's scope. The inner Box holds the slot's width and clips nothing it
    // was sized for; the card is lifted out of the band by the host.
    <Box key={'fact-' + f.key} flexDirection="row" flexShrink={0} width={f.width}>
      <Box flexDirection="row" alignItems="center" columnGap={gap} width={f.width} overflow="hidden">
        {f.label ? <Box flexShrink={0}>{runText(el, 'label', f.label)}</Box> : null}
        {f.glyph ? <Box flexShrink={0}>{runText(el, 'glyph', f.glyph)}</Box> : null}
        {value}
        {(f.tail ?? []).map((run, i) => runText(el, 'tail-' + i, run))}
      </Box>
      {card(el, f)}
    </Box>
  )
}

/** On: the host's primary Button. Off: plain and dimmed. The same box either way. */
function stateButton(el: Els, key: string, label: string, on: boolean, onPress: () => void): RenderNode {
  const { Button } = el
  return on ? <Button key={key} variant="primary" label={label} onPress={() => onPress()} /> : <Button key={key} plain dimColor label={label} onPress={() => onPress()} />
}

function controlRich(el: Els, frame: Frame, c: Control): RenderNode {
  const { Box, Text } = el
  if (c.count === undefined) return stateButton(el, c.key, c.label, c.on, c.onPress)
  return (
    <Box key={'ctl-' + c.key} flexDirection="row" alignItems="center" flexShrink={0}>
      {stateButton(el, c.key, c.label, c.on, c.onPress)}
      <Box width={COUNT_CELLS} flexShrink={0} justifyContent="center">
        <Text color={textTone(frame.appearance).accent} bold>{c.count}</Text>
      </Box>
    </Box>
  )
}

function effortMenu(el: Els, frame: Frame, view: DashboardView, actions: BandActions): RenderNode {
  const { Box } = el
  const current = view.effort.mode === 'manual' || view.effort.mode === 'off' ? view.effort.level : null
  return (
    <Box key="effort-menu" flexDirection="row" alignItems="center" flexWrap="wrap" columnGap={CTRL_GAP}>
      {stateButton(el, 'pick-auto', t(frame.lang, 'band.auto'), view.auto, actions.toggleAuto)}
      {EFFORTS.map((effort, i) => stateButton(el, 'pick-' + effort, RIPPLE_CHAR[i]! + ' ' + effortName(effort, frame.lang), current === effort, () => actions.pickEffort(effort)))}
    </Box>
  )
}

/** Who chose the effort and why, as "Jev: one small fix"; empty unless Auto chose it. */
function reasonText(frame: Frame, view: DashboardView): string {
  const { why, by, mode } = view.effort
  if (!why || mode !== 'auto' || view.hide.includes('reason')) return ''
  const who = by === 'jev' ? 'Jev' : by === 'haiku' ? 'Haiku' : by === 'model' ? t(frame.lang, 'band.router') : ''
  return who ? who + ': ' + why : why
}

function bandRich(el: Els, frame: Frame, view: DashboardView, actions: BandActions): RenderNode {
  const { Box, Text } = el
  const reason = reasonText(frame, view)
  const cols = Math.max(20, frame.columns)
  // Facts, a rule, the controls. The route takes what is left; narrow, the extras give way (by the
  // cells counted here, Handoff's place kept). The facts' group starts from nothing and grows into
  // the row, never below what its slots and a short route need: where the host's real widths leave
  // less, it wraps under the controls rather than overlap them. Widths alone decide, never values.
  const ctrlCells = controlsCells(frame, view, actions)
  const room = cols - ctrlCells - MARK_CELLS
  const mood = bandMood(frame, view)
  const need = (facts: readonly Fact[]) => facts.filter(f => !f.grow).reduce((n, f) => n + f.width, 0) + GAP * Math.max(0, facts.length - 1) + (facts.some(f => f.grow) ? RICH_ROUTE_MIN : 0)
  let facts: Fact[] = []
  for (const drop of [[], ['limit'], ['limit', 'context'], ['limit', 'context', 'mode']]) {
    facts = factsFor(frame, view, actions, room, drop)
    if (need(facts) <= room) break
  }
  return (
    <Box flexDirection="column" width="100%" minWidth={0}>
      <Box key="band-row" flexDirection="row" alignItems="center" width="100%" columnGap={1} flexWrap="wrap">
        <Box key="band-facts" flexDirection="row" alignItems="center" flexGrow={1} flexShrink={1} width={0} minWidth={need(facts) + MARK_CELLS}>
          {/* A slot of fixed width, whatever the mood, so 리플이 never moves the facts; the image
              sits at its start and the slot's spare (about 6 px) is the air before the first
              fact, an icon's gap to its label rather than a whole fact's. */}
          <Box key="band-crest" width={MARK_SLOT} flexShrink={0} alignItems="center" justifyContent="flex-start">
            {'Svg' in el ? (
              <el.Svg key={'band-ripple-' + mood.face + (mood.dim ? '-dim' : '') + '-' + frame.appearance} source={rippleSource(mood.face, BAND_RIPPLE, frame.appearance, undefined, mood.dim)} alt="ClaudeRipple" width={BAND_RIPPLE} height={BAND_RIPPLE} />
            ) : (
              <Text color={mood.dim ? undefined : textTone(frame.appearance).accent} dimColor={mood.dim} bold>
                {CREST}
              </Text>
            )}
          </Box>
          <Box key="band-say" flexDirection="row" alignItems="center" columnGap={GAP} flexGrow={1} flexShrink={1} width={0} minWidth={0}>
            {facts.map(f => factRich(el, f))}
            {/* The reason sits right after the route in only what the facts leave (it starts from no
                width), cut at its end; with no reason the box stays, empty, so nothing else moves.
                Its own air is the gap before the controls: no rule between them. */}
            <Box key="band-why" flexGrow={1} flexShrink={1} width={0} minWidth={0} overflow="hidden">
              {reason ? <Text dimColor wrap="truncate">{reason}</Text> : null}
            </Box>
          </Box>
        </Box>
        <Box key="band-controls" flexDirection="row" alignItems="center" columnGap={CTRL_GAP} flexShrink={0}>
          {controls(frame, view, actions).map(c => controlRich(el, frame, c))}
        </Box>
      </Box>
      {view.effortMenu ? effortMenu(el, frame, view, actions) : null}
    </Box>
  )
}

// ---- Terminal ----------------------------------------------------------------------------------

function factText(el: Els, f: Fact): RenderNode {
  const { Box } = el
  return (
    <Box key={'fact-' + f.key} flexDirection="row" columnGap={1} width={f.width} flexShrink={0}>
      {f.glyph ? runText(el, 'glyph', f.glyph) : null}
      {runText(el, 'value', f.value)}
      {(f.tail ?? []).map((run, i) => runText(el, 'tail-' + i, run))}
    </Box>
  )
}

/**
 * The judge's reason in a slot of its own on a wide terminal, cut to it; the slot stays, blank,
 * while there is no reason, so the route beside it never changes width.
 */
function whyFact(view: DashboardView): Fact | null {
  if (view.hide.includes('reason')) return null
  const why = view.effort.mode === 'auto' ? view.effort.why : undefined
  return { key: 'why', width: WHY_CELLS, value: { text: why ? clip('“' + why + '”', WHY_CELLS) : '', dim: true } }
}

function bandText(el: Els, frame: Frame, view: DashboardView, actions: BandActions): RenderNode {
  const { Box } = el
  const cols = Math.max(20, frame.columns)
  const ctrls = controls(frame, view, actions)
  const ctrlCells = controlsCells(frame, view, actions)
  const budget = Math.max(1, frame.maxRows)
  // One row when the facts (a route at its least) and the controls fit; else facts, then controls.
  // Too tall for the band: the quietest facts go first. Widths alone decide, never values.
  let drop: string[] = []
  const plan = () => {
    const routeCells = view.hide.includes('route') || drop.includes('route') ? 0 : GAP + ROUTE_MIN
    const oneRow = span(factsFor(frame, view, actions, cols, [...drop, 'route'])) + routeCells + GAP + ctrlCells <= cols
    const room = oneRow ? cols - ctrlCells - GAP : cols
    return { oneRow, facts: factsFor(frame, view, actions, room, drop), room }
  }
  let p = plan()
  for (const key of ['limit', 'context', 'route', 'mode', 'cache']) {
    if ((p.oneRow ? 1 : 2) <= budget) break
    drop = [...drop, key]
    p = plan()
  }
  let facts = p.facts
  // The reason only where the row has room for its whole slot and a roomy route beside it.
  const why = whyFact(view)
  const routeNeed = view.hide.includes('route') || drop.includes('route') ? 0 : GAP + 2 * WHY_CELLS
  if (why && p.room - span(factsFor(frame, view, actions, p.room, [...drop, 'route'])) - GAP >= WHY_CELLS + routeNeed) {
    const room = p.room - WHY_CELLS - GAP
    facts = factsFor(frame, view, actions, room, drop)
    const at = facts.findIndex(f => f.key === 'route')
    facts = at < 0 ? [...facts, why] : [...facts.slice(0, at), why, ...facts.slice(at)]
  }
  const factRow = (
    <Box key="facts" flexDirection="row" columnGap={GAP} flexShrink={0}>
      {facts.map(f => factText(el, f))}
    </Box>
  )
  const ctrlRow = (
    <Box key="controls" flexDirection="row" flexWrap="wrap" columnGap={GAP} flexShrink={0}>
      {ctrls.map(c => textButton(el, c.key, c.label, c.onPress, c.hotkey))}
    </Box>
  )
  const menu = view.effortMenu ? (
    <Box key="effort-menu" flexDirection="row" flexWrap="wrap" columnGap={GAP}>
      {textButton(el, 'pick-auto', t(frame.lang, 'band.auto') + ' ' + (view.auto ? '●' : '○'), actions.toggleAuto, '0')}
      {EFFORTS.map((effort: Effort, i) => textButton(el, 'pick-' + effort, RIPPLE_CHAR[i]! + ' ' + effortName(effort, frame.lang).toLowerCase(), () => actions.pickEffort(effort), String(i + 1)))}
    </Box>
  ) : null
  return (
    <Box flexDirection="column" width="100%">
      {p.oneRow ? (
        <Box key="row" flexDirection="row" width="100%">
          {factRow}
          <Box flexGrow={1} minWidth={GAP} />
          {ctrlRow}
        </Box>
      ) : (
        [factRow, ctrlRow]
      )}
      {menu}
    </Box>
  )
}

/**
 * Cells the caller's controls beside the band take (the close control, and the terminal's effort
 * button `e: Effort`), with the gap before them: what to take off the frame's columns.
 */
export function besideBand(frame: Frame): number {
  return isRich(frame) ? 5 : 2 + displayWidth('e: ' + t(frame.lang, 'band.effort')) + 2 + 1
}

/** The dashboard band, `frame.columns` being its own width (see besideBand). */
export function renderBand(el: Els, frame: Frame, view: DashboardView, actions: BandActions): RenderNode {
  return isRich(frame) ? bandRich(el, frame, view, actions) : bandText(el, frame, view, actions)
}

// ---- Minimal: the footer -----------------------------------------------------------------------

export type FooterActions = Pick<BandActions, 'toggleAuto' | 'openSettings'>

/**
 * The minimal layout: one quiet line in the footer's mode area (SessionMode), the engine's own
 * modes kept beside it. `engine` is what `next(e)` drew there.
 */
export function renderFooter(el: Els, frame: Frame, view: DashboardView, actions: FooterActions, engine?: RenderChildren): RenderNode {
  const { Box, Text } = el
  const tone = textTone(frame.appearance)
  const { level, mode } = view.effort
  const idx = effortIndex(level)
  const effortText =
    mode === 'deciding' ? t(frame.lang, 'band.decidingText') : (idx >= 0 ? RIPPLE_CHAR[idx]! : '○') + ' ' + (level ? effortName(level, frame.lang).toLowerCase() : '—') + (mode === 'auto' ? '' : mode === 'paused' ? t(frame.lang, 'band.footerPaused') : mode === 'off' ? t(frame.lang, 'band.footerOff') : t(frame.lang, 'band.footerManual'))
  const left = view.cache ? view.cache.expiresAt - frame.now : 0
  const ctxTone = view.context ? contextTone(view.context.percent, view.swampAt) : 'ink'
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2} alignItems="center">
      <Text color={mode === 'deciding' || mode === 'auto' ? tone.accent : undefined} dimColor={mode === 'paused' || mode === 'off'}>
        {effortText}
      </Text>
      {view.mode ? <Text color={tone.accent}>{t(frame.lang, 'band.mode') + ' ' + modeLabel(view.mode)}</Text> : null}
      {view.context && view.extras.includes('context') ? (
        <Text dimColor color={ctxTone === 'ink' ? undefined : ctxTone === 'warn' ? WARN : BAD}>
          {t(frame.lang, 'band.footerContext', { percent: Math.round(view.context.percent) })}
        </Text>
      ) : null}
      {view.cache && !view.hide.includes('timer') ? <Text dimColor>{'⧗ ' + minutesLeft(left, frame.lang) + (view.warm.on ? ' ≈' : '')}</Text> : null}
      {view.limit && view.extras.includes('limits') ? <Text dimColor>{limitName(view.limit.kind, frame.lang) + ' ' + Math.round(view.limit.percent) + '%'}</Text> : null}
      {textButton(el, 'auto', t(frame.lang, 'band.auto') + (view.auto ? ' ●' : ' ○'), actions.toggleAuto)}
      {textButton(el, 'settings', '⚙', actions.openSettings)}
      {engine ?? null}
    </Box>
  )
}
