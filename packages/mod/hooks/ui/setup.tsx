// First run: three short steps (who judges, workers on the dashboard, keep warm) and a
// done card. Shown once, in the band; detailed settings live on the router dashboard.
//
// 리플이 asks each step as a card asks (parts.tsx `speak`): the step's question is the title, the
// step count quiet beside it, one line of why, the step's control, then Next and the quiet ways
// back or out. It asks who should judge, waits calmly, and is pleased when all is set.

import { t } from '../i18n'
import type { RenderNode } from 'claude-code'
import { RUNGS } from '../settings'

import { tintText } from './art'
import { pill, surface } from './kit'
import { GREET_SIZE, action, actions, canDraw, mascot, speak } from './parts'
import type { Els } from './parts'
import { drawnRows, judgeRows, keepWarmRow, row } from './settings'
import type { Frame, SettingsActions, SettingsView, SetupActions, SetupView } from './view'
import { targetLabel } from './view'

const STEPS = [
  { title: 'setup.judgeTitle', blurb: 'setup.judgeBlurb' },
  { title: 'setup.workersTitle', blurb: 'setup.workersNote' },
  { title: 'setup.cacheTitle', blurb: 'setup.cacheBlurb' },
] as const

/** `Sol · Astra · …`: the four workers' models, lowest first. */
function workersSummary(lang: Frame['lang'], d: SetupView['draft']): string {
  const general = d.rules.general
  return RUNGS.map(rung => general.rungs[rung]?.map(step => targetLabel(step.target, lang)).join(' → ') || '—').join(' · ')
}

/** The steps as rings, the current one filled: ● ○ ○. */
function dots(step: number): string {
  return [1, 2, 3].map(i => (i <= step ? '●' : '○')).join(' ')
}

/** The first-run setup in the band. */
export function renderSetup(el: Els, frame: Frame, view: SetupView, a: SetupActions): RenderNode {
  const { Text } = el
  // Setup lends the same small controls its draft and handlers.
  const asSettings: SettingsView = { settings: view.draft, jev: view.jev }
  const asActions: SettingsActions = { ...a, close: () => undefined }
  const d = view.draft
  const done = view.step === 4
  const step = done ? null : STEPS[view.step - 1]!
  const body: RenderNode[] = done
    ? [
        row(el, frame, 'sum-effort', t(frame.lang, 'band.effort'), <Text wrap="wrap">{t(frame.lang, 'setup.effortSummary', { state: t(frame.lang, d.effortAuto ? 'band.on' : 'band.off').toLowerCase(), judge: d.judge === 'haiku' ? t(frame.lang, 'settings.haiku') : d.judge === 'jev' ? t(frame.lang, 'settings.jev') : d.judgeModel })}</Text>),
        row(el, frame, 'sum-workers', t(frame.lang, 'settings.workers'), <Text wrap="wrap">{workersSummary(frame.lang, d)}</Text>),
        row(el, frame, 'sum-cache', t(frame.lang, 'band.cache'), <Text wrap="wrap">{d.keepWarm ? t(frame.lang, 'setup.cacheSummary', { hours: d.keepWarmHours }) : t(frame.lang, 'setup.cacheOff')}</Text>),
      ]
    : view.step === 1
      ? judgeRows(el, frame, asSettings, asActions)
      : view.step === 2
        ? [] // Its line says it all: workers start on Auto, the rest is on the dashboard.
        : [keepWarmRow(el, frame, view.draft, asActions)]
  const { Box } = el
  const buttons = done
    ? [action(el, frame, 'finish', t(frame.lang, 'setup.start'), a.finish, { hotkey: 'g', primary: true }), action(el, frame, 'back', t(frame.lang, 'setup.back'), a.back, { hotkey: 'b' })]
    : [
        action(el, frame, 'next', view.step === 3 ? t(frame.lang, 'setup.finish') : t(frame.lang, 'setup.next'), a.next, { hotkey: 'n', primary: true }),
        view.step === 2 ? action(el, frame, 'all-settings', t(frame.lang, 'settings.openAll'), a.openAllSettings, { hotkey: 's' }) : '',
        view.step > 1 ? action(el, frame, 'back', t(frame.lang, 'setup.back'), a.back, { hotkey: 'b' }) : '',
        action(el, frame, 'skip', t(frame.lang, 'setup.skip'), a.skip, { hotkey: 'k' }),
      ]
  const face = done ? 'pleased' : view.step === 1 ? 'asking' : 'calm'
  // It greets first; the first step's question is its one row (who judges).
  const title = done ? t(frame.lang, 'setup.ready') : view.step === 1 ? t(frame.lang, 'setup.welcome') : t(frame.lang, step!.title)
  const line = done ? t(frame.lang, 'setup.changeDashboard') : t(frame.lang, step!.blurb)
  if (canDraw(el, frame)) {
    // The desktop: a drawn surface, its controls the quick settings' own (judge chips, the keep-warm
    // switch), Next a filled pill and the rest quiet.
    const rows = done ? body : view.step === 1 ? drawnRows(el, frame, asSettings, asActions, 'judge') : view.step === 3 ? drawnRows(el, frame, asSettings, asActions, 'warm') : []
    const quiet = (key: string, label: string, onPress: () => void) => <el.Button key={key} plain dimColor label={label} onPress={() => onPress()} />
    const next = done ? pill(el, frame, 'finish', t(frame.lang, 'setup.start'), 'fill', a.finish, 'green') : pill(el, frame, 'next', view.step === 3 ? t(frame.lang, 'setup.finish') : t(frame.lang, 'setup.next'), 'fill', a.next)
    return surface(el, frame, {
      key: 'setup',
      tint: done ? 'green' : 'violet',
      motion: done ? { tick: true, weather: 'sparkles' } : { weather: 'sparkles', ripples: 'slow' },
      rows: 6 + rows.length,
      column: true,
      gap: 1,
      children: [
        <Box key="setup-head" flexDirection="row" alignItems="center" columnGap={2} width="100%" minWidth={0}>
          {mascot(el, frame, 'setup', face, title, GREET_SIZE)}
          <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
            <Box flexDirection="row" columnGap={2} flexWrap="wrap">
              <Text bold color={tintText(done ? 'green' : 'violet', frame.appearance)} wrap="wrap">{title}</Text>
              {done ? null : <Text dimColor>{dots(view.step)}</Text>}
            </Box>
            <Text dimColor wrap="wrap">{line}</Text>
          </Box>
        </Box>,
        rows.length ? (
          <Box key="body" flexDirection="column" rowGap={1} paddingX={1}>
            {rows}
          </Box>
        ) : '',
        <Box key="actions" flexDirection="row" alignItems="center" columnGap={1} flexWrap="wrap">
          {next}
          {!done && view.step === 2 ? quiet('all-settings', t(frame.lang, 'settings.openAll'), a.openAllSettings) : null}
          {done || view.step > 1 ? quiet('back', t(frame.lang, 'setup.back'), a.back) : null}
          {done ? null : quiet('skip', t(frame.lang, 'setup.skip'), a.skip)}
        </Box>,
      ],
    })
  }
  return speak(el, frame, {
    key: 'setup',
    face,
    // It greets here, the first thing a new session shows: at its greeting size.
    size: GREET_SIZE,
    title,
    aside: done ? '' : dots(view.step),
    line,
    blocks: [
      body.length ? (
        <Box key="body" flexDirection="column">
          {body}
        </Box>
      ) : '',
      actions(el, frame, buttons),
    ],
  })
}
