// Quick settings in the band. Each control applies immediately; the router dashboard owns
// the full settings page. Setup reuses the judge and keep-warm rows below.
//
// 리플이 holds the panel as it holds a card (parts.tsx `speak`): the panel's name beside its face,
// then one row per setting, a name, its options as ●/○ words, a quiet hint, then the one way out
// to the dashboard. No pictures but the face: every option is a native button.

import { t } from '../i18n'
import type { RenderNode } from 'claude-code'

import type { LadderChoice, Settings } from '../../types'
import { RUNGS } from '../settings'
import { action, actions, dismiss, segmented, speak, toggle } from './parts'
import type { Els } from './parts'
import { chOf, displayWidth, textTone } from './theme'
import type { Frame, SettingsActions, SettingsView } from './view'
import { effortLabel, isRich, targetLabel, targetValue } from './view'

/** Every name a row of quick settings or setup shows: the name column is the widest of them. */
const ROW_NAMES = ['settings.effortAuto', 'settings.lean', 'settings.judge', 'settings.key', 'settings.keepWarm', 'settings.workers', 'band.effort', 'band.cache',
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

/** How a rung choice reads in a Select: `model · provider`, Claude's own as `Claude Sonnet`. */
function choiceLabel(choice: LadderChoice): string {
  return choice.target.model ? targetLabel(choice.target) : choice.model + ' · ' + choice.provider
}

/**
 * The four workers as model Selects (each keeps its effort), offering the ticked models. Native
 * Selects only: the band redraws on every poll, and a picture would blink.
 */
export function ladderRows(el: Els, frame: Frame, view: SettingsView, a: SettingsActions): RenderNode[] {
  const { Box, Text } = el
  const general = view.settings.rules.general
  const options = view.ladder
  const out: RenderNode[] = []
  if (general.mode !== 'ladder' || !options) {
    out.push(row(el, frame, 'ladder-wait', t(frame.lang, 'settings.workers'), <Text dimColor wrap="wrap">{t(frame.lang, 'settings.ladderWaiting')}</Text>))
  } else {
    for (const rung of RUNGS) {
      const step = general.rungs[rung]
      const current = step ? targetValue(step.target) : ''
      const items = options.choices.map(choice => ({ value: targetValue(choice.target), label: choiceLabel(choice) }))
      // A rung on a model that is not offered now keeps showing it rather than a wrong neighbour.
      if (step && !items.some(item => item.value === current)) items.push({ value: current, label: targetLabel(step.target, frame.lang) })
      if (!step) items.unshift({ value: '', label: '—' })
      const effort = step ? effortLabel(step.effort, frame.lang) : ''
      const control = 'Select' in el && a.setRung
        ? <el.Select key={'rung-' + rung} options={items} value={current} onSelect={(value: string) => { if (value) a.setRung!(rung, value) }} />
        : <Text>{items.find(item => item.value === current)?.label ?? '—'}</Text>
      out.push(row(el, frame, 'rung-' + rung, t(frame.lang, 'workers.rung.' + rung), control, effort))
    }
  }
  return out
}

export function keepWarmRow(el: Els, frame: Frame, d: Settings, a: SettingsActions): RenderNode {
  return row(el, frame, 'warm', t(frame.lang, 'settings.keepWarm'), toggle(el, frame, 'set-warm', d.keepWarm ? t(frame.lang, 'band.on') : t(frame.lang, 'band.off'), d.keepWarm, () => a.patch({ keepWarm: !d.keepWarm })), t(frame.lang, 'settings.keepWarmHint'))
}

// ---- The panel ---------------------------------------------------------------------------------

/** Session-time controls only; the full settings live on the router dashboard. */
export function renderSettings(el: Els, frame: Frame, view: SettingsView, a: SettingsActions): RenderNode {
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
        {ladderRows(el, frame, view, a)}
        {keepWarmRow(el, frame, view.settings, a)}
      </Box>,
      actions(el, frame, [action(el, frame, 'all-settings', t(frame.lang, 'settings.openAll'), a.openAllSettings, { hotkey: 's', primary: true }), rich ? '' : close]),
    ],
    ...(rich ? { dismiss: close } : {}),
  })
}
