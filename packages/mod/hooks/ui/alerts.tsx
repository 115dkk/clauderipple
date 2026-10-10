// The bands that take the dashboard's place when something wants a decision: cold cache, heavy
// context, a hot plan limit, a judge that failed, the compact and handoff bars, and the cards that
// report a compact or handoff in progress and done. One layout for all: a tinted badge, a title
// and one line of why, then the choices — the main one filled.

import { t } from '../i18n'
import type { RenderNode } from 'claude-code'

import type { HandoffKind, Settings } from '../../types'
import { WAVE_CSS, action, chip, icon, segmented } from './parts'
import type { Els } from './parts'
import { svgDoc, textTone, v } from './theme'
import type { Palette } from './theme'
import type { AlertActions, AlertView, Frame } from './view'
import { compactNumber, isRich, limitName, resetsLabel } from './view'

type Tone = 'accent' | 'ok' | 'warn' | 'bad'
type IconName = Parameters<typeof icon>[0]

type Choice = { key: string; label: string; hotkey: string; onPress: () => void; primary?: boolean; lit?: boolean }

type Card = {
  key: string
  tone: Tone
  glyph: IconName | 'wave'
  title: string
  body: string
  choices: Choice[]
  /** Controls drawn between the text and the choices (fields, option rows). */
  extra?: RenderNode[]
}

const JUDGE_NAME = { haiku: 'settings.haiku', jev: 'settings.jev', model: 'alerts.routerModel' } as const

function badge(el: Els, frame: Frame, card: Card): RenderNode {
  const s = 34
  const paint = v(card.tone as keyof Palette)
  const plate =
    '<rect x="0.5" y="0.5" width="' + (s - 1) + '" height="' + (s - 1) + '" rx="10" fill="' + paint + '" fill-opacity="0.13" stroke="' + paint + '" stroke-opacity="0.45"/>'
  let body: string
  let css = ''
  if (card.glyph === 'wave') {
    // Work in progress: three dots lighting in turn.
    body = ''
    ;[11, 17, 23].forEach((x, i) => {
      body += '<circle class="wave" style="animation-delay:' + (i * 0.25).toFixed(2) + 's" cx="' + x + '" cy="17" r="2.4" fill="' + paint + '"/>'
    })
    css = WAVE_CSS
  } else {
    body = '<g transform="translate(17 17) scale(1.15) translate(-7 -7)">' + icon(card.glyph, 0, 0, paint) + '</g>'
  }
  const spec: Parameters<typeof chip>[1] = { key: 'badge-' + card.key, source: svgDoc(s, s, frame.appearance, plate + body, css), alt: card.title, width: s, height: s }
  if (css) spec.live = true
  return chip(el, spec)
}

function cardOf(frame: Frame, alert: AlertView, a: AlertActions): Card {
  switch (alert.kind) {
    case 'cold':
      return {
        key: 'cold',
        tone: 'accent',
        glyph: 'snow',
        title: t(frame.lang, 'alerts.coldTitle'),
        body:
          t(frame.lang, 'alerts.coldBody', { tokens: compactNumber(alert.tokens), minutes: alert.idleMinutes }),
        choices: [
          { key: 'compact', label: t(frame.lang, 'band.compact'), hotkey: 'c', onPress: () => a.compact(), primary: true },
          { key: 'handoff', label: t(frame.lang, 'band.handoff'), hotkey: 'h', onPress: a.handoff },
          { key: 'dismiss', label: t(frame.lang, 'alerts.notNow'), hotkey: 'n', onPress: a.dismiss },
        ],
      }
    case 'swamp':
      return {
        key: 'swamp',
        tone: 'warn',
        glyph: 'alert',
        title: t(frame.lang, 'alerts.swampTitle', { percent: Math.round(alert.percent) }),
        body: t(frame.lang, 'alerts.swampBody', { tokens: compactNumber(alert.tokens) }),
        choices: [
          { key: 'compact', label: t(frame.lang, 'band.compact'), hotkey: 'c', onPress: () => a.compact(), primary: true },
          { key: 'handoff', label: t(frame.lang, 'band.handoff'), hotkey: 'h', onPress: a.handoff },
          { key: 'dismiss', label: t(frame.lang, 'alerts.notNow'), hotkey: 'n', onPress: a.dismiss },
        ],
      }
    case 'hot': {
      const resets = resetsLabel(alert.resetsAt, frame.now, frame.lang)
      return {
        key: 'hot',
        tone: alert.percent >= 95 ? 'bad' : 'warn',
        glyph: 'clock',
        title: t(frame.lang, 'alerts.hotTitle', { window: limitName(alert.limitKind, frame.lang), percent: Math.round(alert.percent) }),
        body:
          (resets ? resets.charAt(0).toUpperCase() + resets.slice(1) + '. ' : '') +
          (alert.save ? t(frame.lang, 'alerts.saveOnBody') : t(frame.lang, 'alerts.saveBody')),
        choices: [
          { key: 'save', label: alert.save ? t(frame.lang, 'alerts.saveOn') : t(frame.lang, 'alerts.save'), hotkey: 's', onPress: a.toggleSave, primary: !alert.save, lit: alert.save },
          { key: 'dismiss', label: t(frame.lang, 'alerts.notNow'), hotkey: 'n', onPress: a.dismiss },
        ],
      }
    }
    case 'judgeDown':
      return {
        key: 'judge',
        tone: 'bad',
        glyph: 'alert',
        title: t(frame.lang, 'alerts.judgeTitle'),
        body: t(frame.lang, 'alerts.judgeBody', { judge: t(frame.lang, JUDGE_NAME[alert.judge]), reason: alert.reason, fallback: t(frame.lang, alert.judge === 'haiku' ? 'alerts.keepEffort' : 'alerts.askHaiku') }),
        choices: [
          { key: 'settings', label: t(frame.lang, 'alerts.openSettings'), hotkey: 'o', onPress: a.openSettings, primary: true },
          { key: 'dismiss', label: t(frame.lang, 'alerts.notNow'), hotkey: 'n', onPress: a.dismiss },
        ],
      }
    case 'result':
      return resultCard(frame, alert, a)
    case 'compactNote':
      return {
        key: 'note',
        tone: 'accent',
        glyph: 'compact',
        title: t(frame.lang, 'alerts.compactTitle'),
        body: t(frame.lang, 'alerts.compactBody'),
        choices: [
          { key: 'compact', label: t(frame.lang, 'band.compact'), hotkey: 'c', onPress: () => a.compact(alert.draft), primary: true },
          { key: 'dismiss', label: t(frame.lang, 'alerts.cancel'), hotkey: 'x', onPress: a.dismiss },
        ],
      }
    case 'handoffChoice':
      return {
        key: 'handoff',
        tone: 'accent',
        glyph: 'handoff',
        title: t(frame.lang, 'alerts.handoffTitle'),
        body:
          alert.handoffKind === 'quick'
            ? t(frame.lang, 'alerts.quickBody')
            : t(frame.lang, 'alerts.fullBody'),
        choices: [
          { key: 'go', label: t(frame.lang, 'alerts.go'), hotkey: 'g', onPress: a.go, primary: true },
          { key: 'dismiss', label: t(frame.lang, 'alerts.cancel'), hotkey: 'x', onPress: a.dismiss },
        ],
      }
  }
}

function resultCard(frame: Frame, alert: Extract<AlertView, { kind: 'result' }>, a: AlertActions): Card {
  const dismiss: Choice = { key: 'dismiss', label: t(frame.lang, 'alerts.dismiss'), hotkey: 'x', onPress: a.dismiss }
  switch (alert.stage) {
    case 'handingOff':
      return {
        key: 'result',
        tone: 'accent',
        glyph: 'wave',
        title: t(frame.lang, 'alerts.handingOff'),
        body: alert.detail ?? (alert.handoffKind === 'full' ? t(frame.lang, 'alerts.fullProgress') : t(frame.lang, 'alerts.quickProgress')),
        choices: [],
      }
    case 'handoffDone':
      return {
        key: 'result',
        tone: 'ok',
        glyph: 'check',
        title: t(frame.lang, 'alerts.handoffDone'),
        body: alert.detail ?? t(frame.lang, 'alerts.summaryReady'),
        choices: [{ key: 'copy', label: t(frame.lang, 'alerts.copyAgain'), hotkey: 'y', onPress: a.copy }, dismiss],
      }
    case 'compacting':
      return { key: 'result', tone: 'accent', glyph: 'wave', title: t(frame.lang, 'alerts.compacting'), body: alert.detail ?? t(frame.lang, 'alerts.compactingBody'), choices: [] }
    case 'compacted':
      return { key: 'result', tone: 'ok', glyph: 'check', title: t(frame.lang, 'alerts.compacted'), body: alert.detail ?? t(frame.lang, 'alerts.compactedBody'), choices: [dismiss] }
    case 'failed':
      return { key: 'result', tone: 'bad', glyph: 'cross', title: t(frame.lang, 'alerts.failed'), body: alert.detail ?? t(frame.lang, 'alerts.unchanged'), choices: [dismiss] }
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
    return [
      <Box key="kind" flexDirection="row" columnGap={2} alignItems="center">
        <Text dimColor>{t(frame.lang, 'alerts.kind')}</Text>
        {segmented(el, frame, 'kind', kinds, alert.handoffKind, k => a.setHandoffKind(k))}
      </Box>,
      <Box key="after" flexDirection="row" columnGap={2} alignItems="center">
        <Text dimColor>{t(frame.lang, 'alerts.then')}</Text>
        {segmented(el, frame, 'after', afters, alert.after, k => a.setHandoffAfter(k))}
      </Box>,
    ]
  }
  return []
}

/** One alert band, chosen by register.tsx from the priority list in the spec (§5 Bands). */
export function renderAlert(el: Els, frame: Frame, alert: AlertView, actions: AlertActions): RenderNode {
  const { Box, Text } = el
  const card = cardOf(frame, alert, actions)
  const extra = extras(el, frame, alert, actions)
  const tone = textTone(frame.appearance)
  const titleColor = card.tone === 'accent' ? undefined : tone[card.tone]
  if (isRich(frame)) {
    return (
      <Box key={'alert-' + card.key} flexDirection="column" rowGap={1}>
        <Box flexDirection="row" alignItems="center" columnGap={2} flexWrap="wrap" rowGap={1}>
          {badge(el, frame, card)}
          <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={30}>
            <Text bold color={titleColor}>
              {card.title}
            </Text>
            <Text dimColor wrap="wrap">
              {card.body}
            </Text>
          </Box>
          {card.choices.length > 0 ? (
            <Box flexDirection="row" gap={1}>
              {card.choices.map(c => {
                const o: { primary?: boolean; lit?: boolean } = {}
                if (c.primary) o.primary = true
                if (c.lit) o.lit = true
                return action(el, frame, c.key, c.label, c.onPress, o)
              })}
            </Box>
          ) : null}
        </Box>
        {extra.length > 0 ? (
          <Box flexDirection="column" rowGap={1} paddingLeft={6}>
            {extra}
          </Box>
        ) : null}
      </Box>
    )
  }
  const mark = card.glyph === 'wave' ? '…' : card.tone === 'ok' ? '✓' : card.tone === 'bad' ? '✕' : card.tone === 'warn' ? '▲' : '◉'
  return (
    <Box key={'alert-' + card.key} flexDirection="column">
      <Text wrap="wrap">
        <Text bold color={card.tone === 'accent' ? tone.accent : tone[card.tone]}>
          {mark + ' ' + card.title}
        </Text>
        <Text dimColor>{'  ' + card.body}</Text>
      </Text>
      {extra}
      {card.choices.length > 0 ? (
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          {card.choices.map(c => action(el, frame, c.key, c.label + (c.lit ? ' ●' : ''), c.onPress, { hotkey: c.hotkey }))}
        </Box>
      ) : null}
    </Box>
  )
}
