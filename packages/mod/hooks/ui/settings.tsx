// Quick settings in the band. Each control applies immediately; the router dashboard owns
// the full settings page. Setup reuses the judge and keep-warm rows below.

import { t } from '../i18n'
import type { RenderNode } from 'claude-code'

import type { Settings } from '../../types'
import { action, chip, mascot, segmented, toggle } from './parts'
import type { Els } from './parts'
import { MIN_SIZE } from './ripple'
import { svgDoc, textTone, v } from './theme'
import type { Frame, SettingsActions, SettingsView } from './view'
import { isRich } from './view'

const LABEL_W = 15

/** A labelled row: label column, the control, an optional quiet hint. */
export function row(el: Els, key: string, label: string, control: RenderNode, hint?: string): RenderNode {
  const { Box, Text } = el
  return (
    <Box key={'row-' + key} flexDirection="row" alignItems="center" columnGap={1} flexWrap="wrap">
      <Box width={LABEL_W} flexShrink={0}>
        <Text dimColor>{label}</Text>
      </Box>
      {control}
      {hint ? <Text dimColor wrap="wrap">{hint}</Text> : null}
    </Box>
  )
}

// ---- The bias slider ---------------------------------------------------------------------------

const BIAS: readonly Settings['bias'][] = [-2, -1, 0, 1, 2]

function biasSlider(el: Els, frame: Frame, bias: Settings['bias'], onPick: (bias: Settings['bias']) => void): RenderNode {
  const { Box, Text } = el
  if (!isRich(frame) || !('Svg' in el)) {
    return segmented(
      el,
      frame,
      'bias',
      BIAS.map(b => ({ value: String(b), label: b > 0 ? '+' + b : b < 0 ? '−' + -b : '0' })),
      String(bias),
      picked => onPick(Number(picked) as Settings['bias']),
    )
  }
  // Five adjacent stops, each its own pressable picture of its stretch of the track.
  const w = 34
  const ht = 24
  const stops = BIAS.map((b, i) => {
    const on = b === bias
    const passed = (b <= bias && b >= 0 && bias > 0) || (b >= bias && b <= 0 && bias < 0)
    const y = ht / 2
    const left = i === 0 ? w / 2 : 0
    const right = i === BIAS.length - 1 ? w / 2 : w
    let body = '<line x1="' + left + '" y1="' + y + '" x2="' + right + '" y2="' + y + '" stroke="' + v('faint') + '" stroke-width="2"/>'
    if (passed && b !== 0) {
      const toward = b > 0 ? 0 : w
      body += '<line x1="' + toward + '" y1="' + y + '" x2="' + w / 2 + '" y2="' + y + '" stroke="' + v('accent') + '" stroke-width="2"/>'
    }
    if (passed && b === 0 && bias !== 0) {
      body += '<line x1="' + w / 2 + '" y1="' + y + '" x2="' + (bias > 0 ? w : 0) + '" y2="' + y + '" stroke="' + v('accent') + '" stroke-width="2"/>'
    }
    body += on
      ? '<circle cx="' + w / 2 + '" cy="' + y + '" r="7" fill="' + v('primary') + '"/><circle cx="' + w / 2 + '" cy="' + y + '" r="2.6" fill="#fff"/>'
      : '<circle cx="' + w / 2 + '" cy="' + y + '" r="' + (b === 0 ? 3.6 : 3) + '" fill="' + (passed ? v('accent') : v('faint')) + '"/>'
    return chip(el, {
      key: 'bias-' + b,
      source: svgDoc(w, ht, frame.appearance, body),
      alt: t(frame.lang, 'settings.biasAlt', { value: b > 0 ? '+' + b : String(b), selected: on ? t(frame.lang, 'settings.selected') : '' }),
      width: w,
      height: ht,
      onPress: () => onPick(b),
    })
  })
  return (
    <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={1}>
      <Text dimColor>{t(frame.lang, 'settings.cheaper')}</Text>
      <Box flexDirection="row">{stops}</Box>
      <Text dimColor>{t(frame.lang, 'settings.smarter')}</Text>
    </Box>
  )
}

// ---- Shared quick controls ---------------------------------------------------------------------

export function effortRows(el: Els, frame: Frame, d: Settings, a: SettingsActions): RenderNode[] {
  const out = [row(el, 'auto', t(frame.lang, 'settings.effortAuto'), toggle(el, frame, 'set-auto', d.effortAuto ? t(frame.lang, 'band.on') : t(frame.lang, 'band.off'), d.effortAuto, () => a.patch({ effortAuto: !d.effortAuto })), t(frame.lang, 'settings.autoHint'))]
  if (d.effortAuto) out.push(row(el, 'bias', t(frame.lang, 'settings.lean'), biasSlider(el, frame, d.bias, bias => a.patch({ bias })), t(frame.lang, 'settings.leanHint')))
  return out
}

export function judgeRows(el: Els, frame: Frame, view: SettingsView, a: SettingsActions): RenderNode[] {
  const d = view.settings
  const tone = textTone(frame.appearance)
  const { Box, Text } = el
  const out: RenderNode[] = [
    row(
      el,
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

export function keepWarmRow(el: Els, frame: Frame, d: Settings, a: SettingsActions): RenderNode {
  return row(el, 'warm', t(frame.lang, 'settings.keepWarm'), toggle(el, frame, 'set-warm', d.keepWarm ? t(frame.lang, 'band.on') : t(frame.lang, 'band.off'), d.keepWarm, () => a.patch({ keepWarm: !d.keepWarm })), t(frame.lang, 'settings.keepWarmHint'))
}

// ---- The panel ---------------------------------------------------------------------------------

/** Session-time controls only; the full settings live on the router dashboard. */
export function renderSettings(el: Els, frame: Frame, view: SettingsView, actions: SettingsActions): RenderNode {
  const { Box, Text } = el
  const rich = isRich(frame)
  return (
    <Box flexDirection="column" rowGap={rich ? 1 : 0} width="100%">
      <Box key="head" flexDirection="row" alignItems="center" columnGap={1} flexWrap="wrap">
        {rich ? <Box marginRight={1}>{mascot(el, frame, 'settings', 'calm', t(frame.lang, 'band.brand'), MIN_SIZE)}</Box> : null}
        <Text bold>{t(frame.lang, 'band.brand')}</Text>
        <Text dimColor>{t(frame.lang, 'settings.quick')}</Text>
      </Box>
      <Box key="controls" flexDirection="column" rowGap={rich ? 1 : 0} paddingLeft={rich ? 1 : 0}>
        {effortRows(el, frame, view.settings, actions)}
        {judgeRows(el, frame, view, actions)}
        {keepWarmRow(el, frame, view.settings, actions)}
      </Box>
      <Box key="foot" flexDirection="row" alignItems="center" columnGap={2} flexWrap="wrap" rowGap={1}>
        {action(el, frame, 'all-settings', t(frame.lang, 'settings.openAll'), actions.openAllSettings, { hotkey: 's', primary: true })}
        {action(el, frame, 'close', t(frame.lang, 'settings.close'), actions.close, { hotkey: 'x' })}
      </Box>
    </Box>
  )
}
