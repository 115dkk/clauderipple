// First run: three short steps (who judges, workers on the dashboard, keep warm) and a
// done card. Shown once, in the band; detailed settings live on the router dashboard.
//
// 리플이 asks each step as a card asks (parts.tsx `speak`): the step's question is the title, the
// step count quiet beside it, one line of why, the step's control, then Next and the quiet ways
// back or out. It asks who should judge, waits calmly, and is pleased when all is set.

import { t } from '../i18n'
import type { RenderNode } from 'claude-code'
import { RUNGS } from '../settings'

import { GREET_SIZE, action, actions, speak } from './parts'
import type { Els } from './parts'
import { judgeRows, keepWarmRow, row } from './settings'
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
  return RUNGS.map(rung => general.mode === 'ladder' && general.rungs[rung] ? targetLabel(general.rungs[rung]!.target, lang) : '—').join(' · ')
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
  return speak(el, frame, {
    key: 'setup',
    face: done ? 'pleased' : view.step === 1 ? 'asking' : 'calm',
    // It greets here, the first thing a new session shows: at its greeting size.
    size: GREET_SIZE,
    // It greets first; the first step's question is its one row (who judges).
    title: done ? t(frame.lang, 'setup.ready') : view.step === 1 ? t(frame.lang, 'setup.welcome') : t(frame.lang, step!.title),
    aside: done ? '' : dots(view.step),
    line: done ? t(frame.lang, 'setup.changeDashboard') : t(frame.lang, step!.blurb),
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
