// The bands that take the dashboard's place when something wants a decision: cold cache, heavy
// context, a hot plan limit, a judge that failed, the compact and handoff bars, and the cards that
// report a compact or handoff in progress and done.
//
// Each one is 리플이 telling you one thing (parts.tsx `speak`): its face of the moment on the left,
// a short title that says what, one line that says why, then at most one main action, the others
// quiet, and the host's own × to let it go. The face is the card's only colour: the title stays in
// ink, so a warning reads from 리플이's face and ring, not from a red headline. Where the card is
// about a figure (context, plan limit), the ring is that gauge.

import { t } from '../i18n'
import type { RenderNode } from 'claude-code'

import type { HandoffKind, Settings } from '../../types'
import { textPx, tintText } from './art'
import type { Motion, Tint } from './art'
import { pill, segments, surface } from './kit'
import type { SegmentOption } from './kit'
import { action, actions, canDraw, dismiss, mascot, segmented, speak } from './parts'
import type { Els } from './parts'
import { FACE_TONE } from './ripple'
import type { Face } from './ripple'
import { chOf, textTone } from './theme'
import type { AlertActions, AlertView, Frame } from './view'
import { compactNumber, isRich, limitName, resetsLabel } from './view'

type Choice = { key: string; label: string; hotkey: string; onPress: () => void }

type Card = {
  key: string
  /** 리플이's face; on the terminal its tone colours the title's mark. */
  face: Face
  /** The ring as a gauge (context or limit percent). */
  percent?: number
  title: string
  body: string
  /** The one thing to press, drawn as the host's primary button. */
  main?: Choice
  /** Other actions, quiet. */
  quiet?: Choice[]
  /** Letting the card go: the host's × on the desktop. */
  close?: Choice
}

const JUDGE_NAME = { haiku: 'settings.haiku', jev: 'settings.jev', model: 'alerts.routerModel' } as const

function cardOf(frame: Frame, alert: AlertView, a: AlertActions): Card {
  const L = frame.lang
  const notNow: Choice = { key: 'dismiss', label: t(L, 'alerts.notNow'), hotkey: 'n', onPress: a.dismiss }
  const cancel: Choice = { key: 'dismiss', label: t(L, 'alerts.cancel'), hotkey: 'x', onPress: a.dismiss }
  const compact: Choice = { key: 'compact', label: t(L, 'band.compact'), hotkey: 'c', onPress: () => a.compact() }
  const handoff: Choice = { key: 'handoff', label: t(L, 'band.handoff'), hotkey: 'h', onPress: a.handoff }
  switch (alert.kind) {
    case 'cold':
      return {
        key: 'cold',
        face: 'sleepy',
        title: t(L, 'alerts.coldTitle'),
        body: t(L, 'alerts.coldBody', { tokens: compactNumber(alert.tokens), minutes: alert.idleMinutes }),
        main: compact,
        quiet: [handoff],
        close: notNow,
      }
    case 'swamp':
      return {
        key: 'swamp',
        face: 'uneasy',
        percent: alert.percent,
        title: t(L, 'alerts.swampTitle', { percent: Math.round(alert.percent) }),
        body: t(L, 'alerts.swampBody', { tokens: compactNumber(alert.tokens) }),
        main: compact,
        quiet: [handoff],
        close: notNow,
      }
    case 'hot': {
      const resets = resetsLabel(alert.resetsAt, frame.now, L)
      const save: Choice = { key: 'save', label: alert.save ? t(L, 'alerts.saveOff') : t(L, 'alerts.save'), hotkey: 's', onPress: a.toggleSave }
      return {
        key: 'hot',
        face: alert.percent >= 95 ? 'alarmed' : 'strained',
        percent: alert.percent,
        title: t(L, 'alerts.hotTitle', { window: limitName(alert.limitKind, L), percent: Math.round(alert.percent) }),
        body: (resets ? resets.charAt(0).toUpperCase() + resets.slice(1) + '. ' : '') + (alert.save ? t(L, 'alerts.saveOnBody') : t(L, 'alerts.saveBody')),
        // Save mode on, there is nothing left to do: turning it off is the quiet way back.
        ...(alert.save ? { quiet: [save] } : { main: save }),
        close: notNow,
      }
    }
    case 'judgeDown':
      return {
        key: 'judge',
        face: 'dazed',
        title: t(L, alert.network ? 'alerts.judgeNetworkTitle' : 'alerts.judgeTitle'),
        body: t(L, 'alerts.judgeBody', { judge: t(L, JUDGE_NAME[alert.judge]), reason: alert.reason, fallback: t(L, alert.judge === 'haiku' ? 'alerts.keepEffort' : 'alerts.askHaiku') }),
        main: { key: 'settings', label: t(L, 'alerts.openSettings'), hotkey: 'o', onPress: a.openSettings },
        close: notNow,
      }
    case 'result':
      return resultCard(frame, alert, a)
    case 'compactNote':
      return {
        key: 'note',
        face: 'asking',
        title: t(L, 'alerts.compactTitle'),
        body: t(L, 'alerts.compactBody'),
        main: { ...compact, onPress: () => a.compact(alert.draft) },
        close: cancel,
      }
    case 'handoffChoice':
      return {
        key: 'handoff',
        face: 'asking',
        title: t(L, 'alerts.handoffTitle'),
        body: alert.handoffKind === 'quick' ? t(L, 'alerts.quickBody') : t(L, 'alerts.fullBody'),
        main: { key: 'go', label: t(L, 'alerts.go'), hotkey: 'g', onPress: a.go },
        close: cancel,
      }
  }
}

function resultCard(frame: Frame, alert: Extract<AlertView, { kind: 'result' }>, a: AlertActions): Card {
  const L = frame.lang
  const close: Choice = { key: 'dismiss', label: t(L, 'alerts.dismiss'), hotkey: 'x', onPress: a.dismiss }
  switch (alert.stage) {
    case 'handingOff':
      return { key: 'result', face: 'going', title: t(L, 'alerts.handingOff'), body: alert.detail ?? (alert.handoffKind === 'full' ? t(L, 'alerts.fullProgress') : t(L, 'alerts.quickProgress')) }
    case 'handoffDone':
      return { key: 'result', face: 'pleased', title: t(L, 'alerts.handoffDone'), body: alert.detail ?? t(L, 'alerts.summaryReady'), quiet: [{ key: 'copy', label: t(L, 'alerts.copyAgain'), hotkey: 'y', onPress: a.copy }], close }
    case 'compacting':
      return { key: 'result', face: 'squeezing', title: t(L, 'alerts.compacting'), body: alert.detail ?? t(L, 'alerts.compactingBody') }
    case 'compacted':
      return { key: 'result', face: 'pleased', title: t(L, 'alerts.compacted'), body: alert.detail ?? t(L, 'alerts.compactedBody'), close }
    case 'failed':
      return { key: 'result', face: 'sorry', title: t(L, 'alerts.failed'), body: alert.detail ?? t(L, 'alerts.unchanged'), close }
  }
}

function extras(el: Els, frame: Frame, alert: AlertView, a: AlertActions): RenderNode[] {
  const { Box, Text } = el
  if (alert.kind === 'compactNote' && 'Input' in el) {
    const Field = el.Input
    return [
      <Field
        key="note"
        label={t(frame.lang, 'alerts.keep')}
        placeholder={t(frame.lang, 'alerts.keepPlaceholder')}
        value={alert.draft}
        submitLabel={t(frame.lang, 'alerts.compactSubmit')}
        autoFocus
        onInput={(text: string) => a.noteInput(text)}
        onSubmit={(text: string) => a.compact(text)}
      />,
    ]
  }
  if (alert.kind === 'handoffChoice') {
    const kinds: { value: HandoffKind; label: string; hotkey: string }[] = [
      { value: 'quick', label: t(frame.lang, 'alerts.quick'), hotkey: 'q' },
      { value: 'full', label: t(frame.lang, 'alerts.full'), hotkey: 'f' },
    ]
    const afters: { value: Settings['handoffAfter']; label: string; hotkey: string }[] = [
      { value: 'continue', label: t(frame.lang, 'alerts.continue'), hotkey: '1' },
      { value: 'confirm', label: t(frame.lang, 'alerts.confirm'), hotkey: '2' },
      { value: 'copy', label: t(frame.lang, 'alerts.copy'), hotkey: '3' },
    ]
    // Two rows of options under one another, their names in a column of their own.
    const line = (key: string, name: string, control: RenderNode) => (
      <Box key={key} flexDirection="row" alignItems="center" columnGap={2}>
        <Box width={8} flexShrink={0}>
          <Text dimColor>{name.trim()}</Text>
        </Box>
        {control}
      </Box>
    )
    return [
      <Box key="choices" flexDirection="column">
        {line('kind', t(frame.lang, 'alerts.kind'), segmented(el, frame, 'kind', kinds, alert.handoffKind, k => a.setHandoffKind(k)))}
        {line('after', t(frame.lang, 'alerts.then'), segmented(el, frame, 'after', afters, alert.after, k => a.setHandoffAfter(k)))}
      </Box>,
    ]
  }
  return []
}

// ---- Desktop: the drawn card ---------------------------------------------------------------------
//
// The same card on a drawn surface (kit.tsx): its own wash and weather (frost and falling snow for a
// cold cache, amber bubbles for a heavy chat, embers for a hot limit, a scanline for a broken judge,
// sparkles while it asks, a sheen while it works, a tick drawn in when done), 리플이 at the start,
// the title in the wash's colour, the why after it, then the quiet actions, the main one as a filled
// pill, and the host's ×. One row when it all fits; else the why goes under the title.

function lookOf(card: Card, alert: AlertView): { tint: Tint; motion: Motion } {
  switch (card.key) {
    case 'cold':
      return { tint: 'ice', motion: { weather: 'snow' } }
    case 'swamp':
      return { tint: 'amber', motion: { weather: 'bubbles' } }
    case 'hot':
      return { tint: (card.percent ?? 0) >= 95 ? 'red' : 'ember', motion: { weather: 'embers' } }
    case 'judge':
      return { tint: 'red', motion: { weather: 'static' } }
    case 'note':
    case 'handoff':
      return { tint: 'violet', motion: { weather: 'sparkles', ripples: 'calm' } }
    default: {
      const stage = alert.kind === 'result' ? alert.stage : 'failed'
      if (stage === 'handingOff' || stage === 'compacting') return { tint: 'violet', motion: { ripples: 'busy', sheen: true } }
      if (stage === 'failed') return { tint: 'red', motion: { weather: 'static' } }
      return { tint: 'green', motion: { tick: true, weather: 'sparkles' } }
    }
  }
}

/** Mascot size on a drawn card, px. */
const CARD_FACE = 24

function drawnExtras(el: Els, frame: Frame, alert: AlertView, a: AlertActions, tint: Tint): RenderNode[] {
  const { Box, Text } = el
  if (alert.kind === 'compactNote' && 'Input' in el) return extras(el, frame, alert, a)
  if (alert.kind !== 'handoffChoice') return []
  const color = tintText(tint, frame.appearance)
  const kinds: SegmentOption<HandoffKind>[] = [
    { value: 'quick', label: t(frame.lang, 'alerts.quick') },
    { value: 'full', label: t(frame.lang, 'alerts.full') },
  ]
  const afters: SegmentOption<Settings['handoffAfter']>[] = [
    { value: 'continue', label: t(frame.lang, 'alerts.continue') },
    { value: 'confirm', label: t(frame.lang, 'alerts.confirm') },
    { value: 'copy', label: t(frame.lang, 'alerts.copy') },
  ]
  const names = [t(frame.lang, 'alerts.kind'), t(frame.lang, 'alerts.then')].map(n => n.trim())
  const nameCells = Math.ceil(Math.max(...names.map(chOf))) + 1
  const line = (key: string, name: string, control: RenderNode) => (
    <Box key={key} flexDirection="row" alignItems="center" columnGap={2}>
      <Box width={nameCells} flexShrink={0}>
        <Text dimColor>{name}</Text>
      </Box>
      {control}
    </Box>
  )
  return [
    <Box key="choices" flexDirection="column" rowGap={1}>
      {line('kind', names[0]!, segments(el, frame, 'kind', kinds, alert.handoffKind, k => a.setHandoffKind(k), tint, color))}
      {line('after', names[1]!, segments(el, frame, 'after', afters, alert.after, k => a.setHandoffAfter(k), tint, color))}
    </Box>,
  ]
}

function drawnAlert(el: Els, frame: Frame, alert: AlertView, a: AlertActions): RenderNode {
  const { Box, Button, Text } = el
  const card = cardOf(frame, alert, a)
  const look = lookOf(card, alert)
  const color = tintText(look.tint, frame.appearance)
  const quiet = (card.quiet ?? []).map(c => <Button key={c.key} plain dimColor label={c.label} onPress={() => c.onPress()} />)
  // The note's field has its own submit, which is the main action there.
  const fieldSubmits = alert.kind === 'compactNote' && 'Input' in el
  const main = card.main && !fieldSubmits ? pill(el, frame, card.main.key, card.main.label, 'fill', card.main.onPress, look.tint) : ''
  const close = card.close ? <Button key={card.close.key} plain role="dismiss" label={card.close.label} onPress={() => card.close!.onPress()} /> : ''
  const more = drawnExtras(el, frame, alert, a, look.tint)
  // One row when the face, title, why and actions fit at their estimated widths.
  const actionCells = (card.quiet ?? []).reduce((n, c) => n + Math.ceil(chOf(c.label) * (12 / 13)) + 3, 0) + (card.main ? Math.ceil(textPx(card.main.label) / 7.917 + 4) : 0) + (card.close ? 3 : 0)
  const oneRow = !more.length && 4 + chOf(card.title) * 1.12 + 2 + chOf(card.body) + 2 + actionCells <= frame.columns - 2
  const face = mascot(el, frame, card.key, card.face, card.title, CARD_FACE, card.percent)
  const title = (
    <Box key="title" flexShrink={0}>
      <Text bold color={color}>{card.title}</Text>
    </Box>
  )
  const body = <Text key="body" wrap="wrap">{card.body}</Text>
  const buttons = (
    <Box key="actions" flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
      {quiet}
      {main}
      {close}
    </Box>
  )
  const top = (
    <Box key="top" flexDirection="row" alignItems="center" columnGap={2} width="100%" minWidth={0}>
      {face}
      {title}
      <Box key="say" flexDirection="row" flexGrow={1} flexShrink={1} width={0} minWidth={0} overflow="hidden">
        {oneRow ? body : null}
      </Box>
      {buttons}
    </Box>
  )
  const indent = Math.ceil(CARD_FACE / 7.917) + 2
  const below = oneRow ? [] : [
    <Box key="below" flexDirection="column" rowGap={1} paddingLeft={indent} width="100%" minWidth={0}>
      {body}
      {more}
    </Box>,
  ]
  return surface(el, frame, { key: 'alert-' + card.key, tint: look.tint, motion: look.motion, rows: oneRow ? 1.3 : 2.6 + (more.length ? 2.4 : 0), column: true, gap: oneRow ? 0 : 1, children: [top, ...below] })
}

/** One alert band, chosen by register.tsx from the priority list in the spec (§5 Bands). */
export function renderAlert(el: Els, frame: Frame, alert: AlertView, a: AlertActions): RenderNode {
  if (canDraw(el, frame)) return drawnAlert(el, frame, alert, a)
  const card = cardOf(frame, alert, a)
  const rich = isRich(frame)
  const tone = FACE_TONE[card.face]
  const text = textTone(frame.appearance)
  const press = (c: Choice, primary = false) => action(el, frame, c.key, c.label, c.onPress, { hotkey: c.hotkey, primary })
  const close = card.close ? dismiss(el, frame, card.close.key, card.close.label, card.close.onPress, card.close.hotkey) : ''
  const buttons = [card.main ? press(card.main, true) : '', ...(card.quiet ?? []).map(c => press(c)), rich ? '' : close]
  // The terminal has no face: a text mark says it instead (work going on, done, failed or broken,
  // a warning, a question).
  const mark = card.face === 'squeezing' || card.face === 'going' ? '…' : tone === 'ok' ? '✓' : tone === 'bad' ? '✕' : tone === 'warn' ? '▲' : '◉'
  return speak(el, frame, {
    key: 'alert-' + card.key,
    face: card.face,
    title: rich ? card.title : mark + ' ' + card.title,
    titleColor: tone === 'accent' ? text.accent : text[tone],
    line: card.body,
    ...(card.percent !== undefined ? { percent: card.percent } : {}),
    blocks: [...extras(el, frame, alert, a), actions(el, frame, buttons)],
    ...(rich && close ? { dismiss: close } : {}),
  })
}
