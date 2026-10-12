// The Agents pane: what the host's own task cards do not say about each subagent of this session:
// the model it ran on, at what effort, who picked it and why. Live ones first, each a small card;
// finished ones fold into one line until opened.
//
// The desktop draws the host's task list right above this pane with the elapsed time, tokens,
// tool count and current activity of every agent. This pane leaves those to it there: its own
// count started at the spawn and summed every step, so the same agent showed two different times
// and totals a few lines apart. The terminal has no such list, so it keeps them.
//
// No pictures while agents run: every step of an agent redraws this pane, and each redraw starts
// 리플이's motion over, so among running agents it would never get past its first second. Only the
// empty pane, which nothing redraws, shows 리플이, waiting at its greeting size.

import { t } from '../i18n'
import type { RenderNode } from 'claude-code'

import type { AgentRec } from '../../types'
import { GREET_SIZE, speak, textButton } from './parts'
import type { Els } from './parts'
import { textTone } from './theme'
import type { AgentsActions, AgentsView, Frame } from './view'
import { compactNumber, effortLabel, elapsed, isRich, modelName, targetLabel } from './view'

const BY = { haiku: 'settings.haiku', jev: 'settings.jev', model: 'agents.routerModel', marker: 'agents.marker', default: 'agents.default', tier: 'toasts.yourPick' } as const

function who(agent: AgentRec, lang: Frame['lang']): string {
  const pick = agent.pick
  // The agent a person picked by name; Claude's own agents by their model.
  return pick ? targetLabel(pick.target, lang) : agent.model ? modelName(agent.model.split('@')[0]!) : agent.type
}

/** The model it ran on, unless that is what the description's own prefix ("Sol·high · …") already says. */
function modelLine(frame: Frame, agent: AgentRec): string[] {
  const out = [who(agent, frame.lang)]
  if (agent.pick) out.push(effortLabel(agent.pick.effort, frame.lang))
  // The type only when it says something the model does not (Explore, Plan, a named agent).
  if (agent.type && !out[0]!.toLowerCase().replace(/[^a-z0-9]/g, '').includes(agent.type.toLowerCase().replace(/[^a-z0-9]/g, ''))) out.push(agent.type)
  return out
}

/** Why this model: who chose it, their reason, and the measured score behind an Auto pick. */
function whyLine(frame: Frame, agent: AgentRec): string {
  const pick = agent.pick
  if (!pick) return ''
  const parts = [t(frame.lang, 'agents.by', { name: t(frame.lang, BY[pick.by]) }) + ' · ' + t(frame.lang, 'agents.domainLevel', { domain: t(frame.lang, 'workers.' + pick.domain), level: t(frame.lang, 'settings.' + pick.level) }) + (pick.rung ? ' · ' + t(frame.lang, 'workers.rung.' + pick.rung) : '')]
  if (pick.why) parts.push('“' + pick.why + '”')
  return parts.join(' · ')
}

function liveCard(el: Els, frame: Frame, agent: AgentRec, now: number): RenderNode {
  const { Box, Text } = el
  const tone = textTone(frame.appearance)
  const rich = isRich(frame)
  const pick = agent.pick
  const waiting = agent.state === 'waiting'
  const why = whyLine(frame, agent)
  const doing = waiting ? t(frame.lang, 'agents.waiting') : agent.now ? agent.now + (agent.toolSince ? ' · ' + elapsed(now - agent.toolSince, frame.lang) : '') : t(frame.lang, 'agents.thinking')
  const body: RenderNode[] = [
      <Box key="title" flexDirection="row" alignItems="center" columnGap={1}>
        <Text color={waiting ? undefined : tone.accent} dimColor={waiting}>{waiting ? '○' : '●'}</Text>
        <Text bold wrap="wrap">{agent.description}</Text>
      </Box>,
      <Box key="model" flexDirection="row" flexWrap="wrap" columnGap={1} paddingLeft={2}>
        <Text>{modelLine(frame, agent).join(' · ')}</Text>
      </Box>,
      why ? (
        <Box key="why" paddingLeft={2}>
          <Text dimColor wrap="wrap">{why}</Text>
        </Box>
      ) : '',
      pick?.fallbackReason ? (
        <Box key="fallback" paddingLeft={2}>
          <Text color={tone.warn} wrap="wrap">{t(frame.lang, 'agents.fallback', { reason: pick.fallbackReason })}</Text>
        </Box>
      ) : '',
      rich ? '' : (
        // The terminal has no task list of its own: what it is doing, for how long, at what cost.
        <Box key="doing" flexDirection="row" flexWrap="wrap" columnGap={2} paddingLeft={2}>
          <Text color={waiting ? undefined : tone.accent} dimColor={waiting} wrap="wrap">{'▸ ' + doing}</Text>
          <Text dimColor>{elapsed(now - agent.startedAt, frame.lang)}</Text>
          {agent.cost > 0 ? <Text dimColor>{t(frame.lang, 'agents.tokens', { tokens: compactNumber(agent.cost) })}</Text> : null}
        </Box>
      ),
  ]
  // No box around it: the dot, the bold name and the rows under it are the card, a row of air
  // the gap to the next.
  return (
    <Box key={'agent-' + agent.id} flexDirection="column">
      {body}
    </Box>
  )
}

function doneLine(el: Els, frame: Frame, agent: AgentRec): RenderNode {
  const { Box, Text } = el
  const tone = textTone(frame.appearance)
  const ok = agent.state === 'done'
  return (
    <Box key={'done-' + agent.id} flexDirection="row" flexWrap="wrap" columnGap={1} paddingLeft={1}>
      <Text color={ok ? tone.ok : tone.bad}>{ok ? '✓' : '✕'}</Text>
      <Text wrap="wrap">{agent.description}</Text>
      <Text dimColor>{modelLine(frame, agent).join(' · ')}</Text>
      {isRich(frame) ? null : <Text dimColor>{elapsed((agent.endedAt ?? agent.startedAt) - agent.startedAt, frame.lang)}</Text>}
      {!isRich(frame) && agent.cost > 0 ? <Text dimColor>{'≈' + compactNumber(agent.cost)}</Text> : null}
    </Box>
  )
}

/** The Agents pane body. */
export function renderAgents(el: Els, frame: Frame, view: AgentsView, actions: AgentsActions): RenderNode {
  const { Box, Text } = el
  const live = view.agents.filter(a => a.state === 'running' || a.state === 'waiting').sort((a, b) => a.startedAt - b.startedAt)
  const done = view.agents.filter(a => a.state === 'done' || a.state === 'failed').sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
  // Empty, the pane has nothing to redraw it, so 리플이 can live out its idle loops here.
  if (view.agents.length === 0) return speak(el, frame, { key: 'agents', face: 'calm', size: GREET_SIZE, title: t(frame.lang, 'agents.emptyTitle'), line: t(frame.lang, 'agents.emptyBody') })
  const { Button } = el
  return (
    <Box flexDirection="column" rowGap={1} width="100%">
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        <Text bold>{live.length ? t(frame.lang, 'agents.liveCount', { count: live.length }) : t(frame.lang, 'agents.noneRunning')}</Text>
        {done.length ? <Text dimColor>{t(frame.lang, 'agents.doneCount', { count: done.length })}</Text> : null}
      </Box>
      {live.map(agent => liveCard(el, frame, agent, view.now))}
      {done.length ? (
        <Box flexDirection="column">
          <Box flexDirection="row">
            {isRich(frame) ? (
              <Button key="done" plain dimColor label={(view.showDone ? '▾ ' : '▸ ') + t(frame.lang, 'agents.doneCount', { count: done.length })} onPress={() => actions.toggleDone()} />
            ) : (
              textButton(el, 'done', (view.showDone ? '▾ ' : '▸ ') + t(frame.lang, 'agents.doneCount', { count: done.length }), actions.toggleDone, 'f')
            )}
          </Box>
          {view.showDone ? done.map(agent => doneLine(el, frame, agent)) : null}
        </Box>
      ) : null}
    </Box>
  )
}
