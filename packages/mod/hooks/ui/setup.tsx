// First run: three short steps (who judges, which agent runs each worker tier, keep warm) and a
// done card. Shown once, in the band; every step can be changed later in settings.

import { t } from '../i18n'
import { DOMAINS } from '../settings'
import type { RenderNode } from 'claude-code'
import type { Domain } from '../../types'

import { action, chip } from './parts'
import type { Els } from './parts'
import { cacheCard, judgeCard, row, workersCard } from './settings'
import { svgDoc, textTone, v } from './theme'
import type { Frame, SettingsActions, SettingsView, SetupActions, SetupView } from './view'
import { isRich } from './view'

const STEPS = [
  { title: 'setup.judgeTitle', blurb: 'setup.judgeBlurb' },
  { title: 'setup.workersTitle', blurb: 'workers.setupBlurb' },
  { title: 'setup.cacheTitle', blurb: 'setup.cacheBlurb' },
] as const

/** `Auto · exceptions: Design → Fixed`: the main choice, then only the fields that differ. */
function workersSummary(lang: Frame['lang'], d: SetupView['draft']): string {
  const mode = (domain: Domain) => t(lang, 'workers.' + (d.rules[domain].mode === 'auto' ? 'auto' : 'pin'))
  const exceptions = DOMAINS.filter(domain => domain !== 'general' && d.rules[domain].mode !== 'inherit')
  return mode('general') + (exceptions.length ? ' · ' + t(lang, 'workers.exceptionsSummary', { list: exceptions.map(domain => t(lang, 'workers.' + domain) + ' → ' + mode(domain)).join(', ') }) : '')
}

function dots(el: Els, frame: Frame, step: number): RenderNode {
  const tone = textTone(frame.appearance)
  if (isRich(frame) && 'Svg' in el) {
    const w = 3 * 18
    let body = '<line x1="9" y1="7" x2="' + (w - 9) + '" y2="7" stroke="' + v('faint') + '" stroke-width="1.5"/>'
    for (let i = 0; i < 3; i++) {
      const cx = 9 + i * 18
      const done = i + 1 < step
      const now = i + 1 === step
      body += now
        ? '<circle cx="' + cx + '" cy="7" r="5.5" fill="none" stroke="' + v('accent') + '" stroke-width="1.5"/><circle cx="' + cx + '" cy="7" r="2.6" fill="' + v('accent') + '"/>'
        : '<circle cx="' + cx + '" cy="7" r="' + (done ? 3.4 : 3) + '" fill="' + (done ? v('accent') : v('faint')) + '"/>'
    }
    return chip(el, { key: 'steps', source: svgDoc(w, 14, frame.appearance, body), alt: t(frame.lang, 'setup.stepAlt', { step: Math.min(step, 3) }), width: w, height: 14 })
  }
  const { Text } = el
  return <Text color={tone.accent}>{[1, 2, 3].map(i => (i < step ? '●' : i === step ? '◉' : '○')).join(' ')}</Text>
}

/** The first-run setup in the band. */
export function renderSetup(el: Els, frame: Frame, view: SetupView, actions: SetupActions): RenderNode {
  const { Box, Text } = el
  const rich = isRich(frame)
  const tone = textTone(frame.appearance)
  // The settings cards draw the controls; setup lends them its draft and handlers.
  const asSettings: SettingsView = { tab: 'judge', draft: view.draft, dirty: false, agents: view.agents, routerModels: view.routerModels, workers: view.workers, skills: [], jev: view.jev, workerUi: view.workerUi }
  const noop = () => undefined
  const asActions: SettingsActions = {
    setTab: noop,
    patch: actions.patch,
    setRule: actions.setRule,
    setWorkerUi: actions.setWorkerUi,
    setFallback: noop,
    jevKey: actions.jevKey,
    testJev: actions.testJev,
    save: noop,
    close: noop,
  }
  const d = view.draft
  const done = view.step === 4
  const step = done ? null : STEPS[view.step - 1]!
  const body: RenderNode[] = done
    ? [
        row(el, 'sum-effort', t(frame.lang, 'band.effort'), <Text>{t(frame.lang, 'setup.effortSummary', { state: t(frame.lang, d.effortAuto ? 'band.on' : 'band.off').toLowerCase(), judge: d.judge === 'haiku' ? t(frame.lang, 'settings.haiku') : d.judge === 'jev' ? t(frame.lang, 'settings.jev') : d.judgeModel })}</Text>),
        row(el, 'sum-workers', t(frame.lang, 'settings.workers'), <Text wrap="wrap">{workersSummary(frame.lang, d)}</Text>),
        row(el, 'sum-cache', t(frame.lang, 'band.cache'), <Text>{d.keepWarm ? t(frame.lang, 'setup.cacheSummary', { hours: d.keepWarmHours }) : t(frame.lang, 'setup.cacheOff')}</Text>),
        <Text dimColor>
          {rich ? t(frame.lang, 'setup.changeRich') : t(frame.lang, 'setup.changeText')}
        </Text>,
      ]
    : view.step === 1
      ? judgeCard(el, frame, asSettings, asActions)
      : view.step === 2
        ? workersCard(el, frame, asSettings, asActions).slice(1)
        : cacheCard(el, frame, view.draft, asActions)
  return (
    <Box flexDirection="column" rowGap={rich ? 1 : 0}>
      <Box key="head" flexDirection="row" alignItems="center" columnGap={1} flexWrap="wrap">
        <Text bold>{done ? t(frame.lang, 'setup.ready') : t(frame.lang, 'setup.welcome')}</Text>
        {done ? null : <Text dimColor>{'· ' + t(frame.lang, step!.title)}</Text>}
        <Box marginLeft={2}>{dots(el, frame, view.step)}</Box>
      </Box>
      {step ? (
        <Text dimColor wrap="wrap">
          {t(frame.lang, step.blurb)}
        </Text>
      ) : null}
      <Box key="card" flexDirection="column" rowGap={rich ? 1 : 0} paddingLeft={rich ? 1 : 0}>
        {body}
      </Box>
      <Box key="foot" flexDirection="row" alignItems="center" columnGap={2} flexWrap="wrap" rowGap={1}>
        {done
          ? action(el, frame, 'finish', t(frame.lang, 'setup.start'), actions.finish, { hotkey: 'g', primary: true })
          : action(el, frame, 'next', view.step === 3 ? t(frame.lang, 'setup.finish') : t(frame.lang, 'setup.next'), actions.next, { hotkey: 'n', primary: true })}
        {view.step > 1 ? action(el, frame, 'back', t(frame.lang, 'setup.back'), actions.back, { hotkey: 'b' }) : null}
        {done ? null : action(el, frame, 'skip', t(frame.lang, 'setup.skip'), actions.skip, { hotkey: 'k' })}
      </Box>
    </Box>
  )
}
