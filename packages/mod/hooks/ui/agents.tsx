// The Agents pane: what each subagent of this session is, who picked it and why, what it is doing
// now. Live ones first, each a small card; finished ones fold into one line until opened.

import { t } from '../i18n'
import type { RenderNode } from 'claude-code'

import type { AgentRec } from '../../types'
import { chip, textButton } from './parts'
import type { Els } from './parts'
import { clip, svgDoc, textTone, v } from './theme'
import type { AgentsActions, AgentsView, Frame } from './view'
import { compactNumber, effortLabel, elapsed, isRich, modelName, targetLabel } from './view'

const BY = { haiku: 'settings.haiku', jev: 'settings.jev', model: 'agents.routerModel', marker: 'agents.marker', default: 'agents.default' } as const

function liveDot(el: Els, frame: Frame, agent: AgentRec, now: number): RenderNode {
  const waiting = agent.state === 'waiting'
  if (isRich(frame) && 'Svg' in el) {
    const paint = waiting ? v('muted') : v('accent')
    // A ring that swells and fades around a steady dot; the phase follows the agent's start.
    const phase = (((now - agent.startedAt) / 1000) % 1.6).toFixed(2)
    const body =
      '<circle cx="8" cy="8" r="3" fill="' + paint + '"/>' +
      (waiting ? '' : '<circle class="p" style="animation-delay:-' + phase + 's" cx="8" cy="8" r="3" fill="none" stroke="' + paint + '" stroke-width="1.4"/>')
    const css = '@keyframes p{0%{r:3px;opacity:.9}100%{r:7.4px;opacity:0}}.p{animation:p 1.6s ease-out infinite}'
    const spec: Parameters<typeof chip>[1] = { key: 'dot-' + agent.id, source: svgDoc(16, 16, frame.appearance, body, css), alt: t(frame.lang, waiting ? 'agents.waiting' : 'agents.running'), width: 16, height: 16 }
    if (!waiting) spec.live = true
    return chip(el, spec)
  }
  const { Text } = el
  const tone = textTone(frame.appearance)
  return <Text color={waiting ? undefined : tone.accent} dimColor={waiting}>{waiting ? '◌' : '◉'}</Text>
}

function who(agent: AgentRec): string {
  const pick = agent.pick
  // The agent a person picked by name; Claude's own agents by their model.
  return pick ? targetLabel(pick.target) : agent.model ? modelName(agent.model.split('@')[0]!) : agent.type
}

function liveCard(el: Els, frame: Frame, agent: AgentRec, now: number): RenderNode {
  const { Box, Text } = el
  const tone = textTone(frame.appearance)
  const pick = agent.pick
  const width = Math.max(30, frame.columns - 4)
  const meta: string[] = [who(agent)]
  if (pick) meta.push(effortLabel(pick.effort, frame.lang))
  if (pick?.why) meta.push('“' + pick.why + '”')
  if (pick) meta.push(t(frame.lang, 'agents.by', { name: t(frame.lang, BY[pick.by]) }))
  const doing = agent.state === 'waiting' ? t(frame.lang, 'agents.waiting') : agent.now ? agent.now + (agent.toolSince ? ' · ' + elapsed(now - agent.toolSince, frame.lang) : '') : t(frame.lang, 'agents.thinking')
  return (
    <Box key={'agent-' + agent.id} flexDirection="column">
      <Box flexDirection="row" alignItems="center" columnGap={1}>
        {liveDot(el, frame, agent, now)}
        {pick ? <Text dimColor>{t(frame.lang, 'agents.domainLevel', { domain: t(frame.lang, 'workers.' + pick.domain), level: t(frame.lang, 'settings.' + pick.level) })}</Text> : <Text dimColor>{agent.type}</Text>}
        <Text bold wrap="truncate-end">
          {clip(agent.description, width)}
        </Text>
      </Box>
      <Text dimColor wrap="truncate-end">
        {meta.join(' · ')}
      </Text>
      <Box flexDirection="row" columnGap={2}>
        <Text color={agent.state === 'waiting' ? undefined : tone.accent} dimColor={agent.state === 'waiting'} wrap="truncate-end">
          {'▸ ' + doing}
        </Text>
        <Text dimColor>{elapsed(now - agent.startedAt, frame.lang)}</Text>
        {agent.cost > 0 ? <Text dimColor>{t(frame.lang, 'agents.tokens', { tokens: compactNumber(agent.cost) })}</Text> : null}
      </Box>
      {pick?.aa ? <Text dimColor wrap="wrap">{t(frame.lang, 'agents.aa', { index: pick.aa.intelligence.toFixed(1), cost: pick.aa.costPerTask.toFixed(2), next: pick.runnerUp ? t(frame.lang, 'agents.aaNext', { name: targetLabel(pick.runnerUp.target), effort: pick.runnerUp.effort, index: pick.runnerUp.intelligence.toFixed(1), cost: pick.runnerUp.costPerTask.toFixed(2) }) : '' })}</Text> : null}
      {pick?.fallbackReason ? <Text color={tone.warn}>{t(frame.lang, 'agents.fallback', { reason: pick.fallbackReason })}</Text> : null}
    </Box>
  )
}

function doneLine(el: Els, frame: Frame, agent: AgentRec): RenderNode {
  const { Box, Text } = el
  const tone = textTone(frame.appearance)
  const ok = agent.state === 'done'
  const tier = agent.pick ? t(frame.lang, 'workers.' + agent.pick.domain) + '/' + t(frame.lang, 'settings.' + agent.pick.level) : agent.type
  return (
    <Box key={'done-' + agent.id} flexDirection="row" columnGap={1}>
      <Text color={ok ? tone.ok : tone.bad}>{ok ? '✓' : '✕'}</Text>
      <Text dimColor>{tier}</Text>
      <Text wrap="truncate-end">{clip(agent.description, Math.max(20, frame.columns - 34))}</Text>
      <Text dimColor>{who(agent)}</Text>
      <Text dimColor>{elapsed((agent.endedAt ?? agent.startedAt) - agent.startedAt, frame.lang)}</Text>
      {agent.cost > 0 ? <Text dimColor>{'≈' + compactNumber(agent.cost)}</Text> : null}
    </Box>
  )
}

/** The Agents pane body. */
export function renderAgents(el: Els, frame: Frame, view: AgentsView, actions: AgentsActions): RenderNode {
  const { Box, Text } = el
  const live = view.agents.filter(a => a.state === 'running' || a.state === 'waiting').sort((a, b) => a.startedAt - b.startedAt)
  const done = view.agents.filter(a => a.state === 'done' || a.state === 'failed').sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
  if (view.agents.length === 0) {
    return (
      <Box flexDirection="column" rowGap={1}>
        <Text bold>{t(frame.lang, 'agents.emptyTitle')}</Text>
        <Text dimColor wrap="wrap">
          {t(frame.lang, 'agents.emptyBody')}
        </Text>
      </Box>
    )
  }
  return (
    <Box flexDirection="column" rowGap={1}>
      <Box flexDirection="row" columnGap={1}>
        <Text bold>{live.length ? t(frame.lang, 'agents.liveCount', { count: live.length }) : t(frame.lang, 'agents.noneRunning')}</Text>
        {done.length ? <Text dimColor>{'· ' + t(frame.lang, 'agents.doneCount', { count: done.length })}</Text> : null}
      </Box>
      {live.map(agent => liveCard(el, frame, agent, view.now))}
      {done.length ? (
        <Box flexDirection="column">
          <Box flexDirection="row">{textButton(el, 'done', (view.showDone ? '▾ ' : '▸ ') + t(frame.lang, 'agents.doneCount', { count: done.length }), actions.toggleDone, isRich(frame) ? undefined : 'f')}</Box>
          {view.showDone ? done.map(agent => doneLine(el, frame, agent)) : null}
        </Box>
      ) : null}
    </Box>
  )
}
