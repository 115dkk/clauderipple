// The Agents pane: every subagent of this session as a card of its own — what it does, the model it
// ran on and at what effort, the tokens it read and wrote, its tools, how long, who picked it and
// why — and, pressed, its conversation, read in the pane. Running agents first, then the finished
// ones, newest first (the latest few, the rest a press away).
//
// The tokens are the API's own counts, summed over the agent's steps (register.tsx turn.step):
// input is uncached + cache read + cache write, with the share the cache served, and output. The
// weighted `cost` the pick log keeps disagreed with the host's task list a few lines up, so it is
// not shown (2026-10-20).
//
// The host has no call that takes the app to a subagent's own view, so "open" reads the agent's
// conversation (`$.session.messages({ agentId })`, register.tsx) and draws it here, a way back at
// its head.
//
// The desktop draws the list in one capsule (kit.tsx), each agent a tile on it, the whole tile its
// press. The conversation reads on the host's own page under its card's capsule: Markdown takes the
// host's ink and no colour of ours, so on the deep's dark water it would vanish on a light app.
//
// 리플이 only where nothing redraws: the empty pane, and the list's head while nothing runs. Each
// running agent's step and the pane's one-second clock redraw it, and every redraw starts the
// mascot's motion over; so while one runs the water holds still and no mascot is drawn.

import { t } from '../i18n'
import type { RenderNode, SessionMessage } from 'claude-code'

import type { AgentRec, Effort } from '../../types'
import { bareTitle } from '../workers'
import { CELL_PX, CONTROL_PX, METER_H, METER_W } from './art'
import { blank, capsule, pic, pill, ripple, rowsOf } from './kit'
import { lookOf } from './look'
import type { Look } from './look'
import { GREET_SIZE, canDraw, speak, textButton } from './parts'
import type { Els } from './parts'
import { chOf, clip, providerColor, textTone } from './theme'
import type { AgentEntry, AgentTalk, AgentsActions, AgentsView, Frame } from './view'
import { cachePercent, compactNumber, effortIndex, effortLabel, elapsed, modelName, promptTokens, targetLabel } from './view'

// Every `by` a pick can carry: a missing one handed t() no key, which threw and left the whole pane
// undrawn ("Nothing to show yet") once a worker ran on the session's model (2026-10-16).
const BY: Record<NonNullable<AgentRec['pick']>['by'] | 'tier', string> = { haiku: 'settings.haiku', jev: 'settings.jev', model: 'agents.routerModel', marker: 'agents.marker', default: 'agents.default', session: 'agents.session', tier: 'toasts.yourPick' }

/** Finished agents the list shows before "more". */
export const DONE_SHOWN = 4
/** Conversation entries a page shows; "earlier" adds a page. */
export const TALK_PAGE = 30
/** Characters of a text entry drawn: a tree draws 100,000 characters in all (the engine's cut). */
const TEXT_MAX = 3000
const PROMPT_MAX = 2400
const ANSWER_MAX = 12000

function live(agent: AgentRec): boolean {
  return agent.state === 'running' || agent.state === 'waiting'
}

/** A title without the model tag the spawn put in front of it: the card names the model itself. */
function titleOf(agent: AgentRec): string {
  return bareTitle(agent.description)
}

/** A model id without its `@effort`. */
function base(id: string): string {
  return id.replace(/@[^@]*$/, '')
}

/** The model it ran on: what answered, else what it was started on, else the pick's target, else its type. */
export function modelOf(agent: AgentRec, lang: Frame['lang']): string {
  if (agent.answeredBy) return modelName(base(agent.answeredBy))
  if (agent.model && agent.model !== 'inherit') return modelName(base(agent.model))
  return agent.pick ? targetLabel(agent.pick.target, lang) : agent.type
}

/** The effort it ran at: what its last step was sent at, else the pick's, else its model id's `@effort`. */
export function effortOf(agent: AgentRec): string | undefined {
  const value = agent.effort ?? agent.pick?.effort ?? /@([a-z]+)$/.exec(agent.model ?? '')?.[1]
  return value === undefined ? undefined : String(value)
}

/** The type only when it says something the model does not (Explore, Plan, a named agent). */
function typeOf(agent: AgentRec, model: string): string {
  const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!agent.type || agent.type === 'general-purpose' || agent.type === 'ripple:auto' || flat(model).includes(flat(agent.type))) return ''
  return agent.type
}

/** Why this model: who chose it, their reason, and the measured score behind an Auto pick. */
function whyLine(frame: Frame, agent: AgentRec): string {
  const pick = agent.pick
  if (!pick) return ''
  const parts = [t(frame.lang, 'agents.by', { name: t(frame.lang, BY[pick.by]) }) + ' · ' + t(frame.lang, 'agents.domainLevel', { domain: t(frame.lang, 'workers.' + pick.domain), level: t(frame.lang, 'settings.' + pick.level) }) + (pick.rung ? ' · ' + t(frame.lang, 'workers.rung.' + pick.rung) : '')]
  if (pick.why) parts.push('“' + pick.why + '”')
  return parts.join(' · ')
}

/** How long it ran, or has run so far. */
function ranFor(agent: AgentRec, now: number, lang: Frame['lang']): string {
  return elapsed((live(agent) ? now : agent.endedAt ?? agent.startedAt) - agent.startedAt, lang)
}

/** What it is doing now, and for how long. */
function doing(agent: AgentRec, now: number, lang: Frame['lang']): string {
  if (agent.now) return clip(agent.now, 70) + (agent.toolSince ? ' · ' + elapsed(now - agent.toolSince, lang) : '')
  return t(lang, 'agents.thinking')
}

type Figure = { key: string; label: string; value: string; ring?: number }

/** Its numbers: input (all of the prompt), the share the cache served, output, tool calls. */
function figures(frame: Frame, agent: AgentRec): Figure[] {
  const L = frame.lang
  const out: Figure[] = []
  const u = agent.usage
  if (u) {
    out.push({ key: 'in', label: t(L, 'agents.input'), value: compactNumber(promptTokens(u)) })
    const cache = cachePercent(u)
    if (cache !== undefined) out.push({ key: 'cache', label: t(L, 'agents.cache'), value: cache + '%', ring: cache })
    out.push({ key: 'out', label: t(L, 'agents.output'), value: compactNumber(u.output) })
  }
  if (agent.tools) out.push({ key: 'tools', label: t(L, 'agents.toolsLabel'), value: String(agent.tools) })
  return out
}

/** The numbers as one line of text (the terminal's). */
function figureLine(frame: Frame, agent: AgentRec): string {
  return figures(frame, agent).map(f => f.label + ' ' + f.value).join(' · ')
}

/** All agents' input and output, for the list's head. */
function totals(frame: Frame, agents: readonly AgentRec[]): string {
  let input = 0
  let output = 0
  for (const a of agents) if (a.usage) { input += promptTokens(a.usage); output += a.usage.output }
  if (!input && !output) return ''
  return t(frame.lang, 'agents.input') + ' ' + compactNumber(input) + ' · ' + t(frame.lang, 'agents.output') + ' ' + compactNumber(output)
}

// ---- Conversation, read ----------------------------------------------------------------------

/** A tool call's input in a few words: the command, the path, the pattern, the query. */
function toolDetail(input: Readonly<Record<string, unknown>>): string {
  const detail = input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.query ?? input.url ?? input.description ?? input.prompt ?? ''
  return String(typeof detail === 'string' ? detail : JSON.stringify(detail)).split('\n')[0]!.trim()
}

/**
 * An agent's conversation as the pane draws it: each prompt it was given, its words, and each tool
 * call with a line of its input and whether it answered (a call's `text` is there once answered,
 * also in a subagent's transcript, which keeps no `result`; `isError` when it failed).
 */
export function talkOf(messages: readonly SessionMessage[]): AgentEntry[] {
  const out: AgentEntry[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      if (m.text.trim()) out.push({ kind: 'prompt', text: m.text.trim() })
      continue
    }
    if (m.text.trim()) out.push({ kind: 'text', text: m.text.trim() })
    for (const use of m.toolUses) out.push({ kind: 'tool', id: use.tool_use_id, tool: use.tool, detail: toolDetail(use.input), state: use.isError ? 'error' : use.text === undefined && use.result === undefined ? 'running' : 'ok' })
  }
  return out
}

/** Cuts a long text at `max` characters, saying so. */
function cut(text: string, max: number): string {
  return text.length > max ? text.slice(0, max).trimEnd() + ' …' : text
}

type Page = { first?: AgentEntry; hidden: number; shown: AgentEntry[]; answer?: string }

/**
 * What a page of the conversation shows: the first prompt always (what it was asked), the latest
 * entries, how many earlier ones wait behind "earlier", and a finished agent's last words as its
 * answer.
 */
function pageOf(entries: readonly AgentEntry[], earlier: number, finished: boolean): Page {
  const first = entries[0]?.kind === 'prompt' ? entries[0] : undefined
  let rest = first ? entries.slice(1) : [...entries]
  const last = rest.at(-1)
  const answer = finished && last?.kind === 'text' ? last.text : undefined
  if (answer !== undefined) rest = rest.slice(0, -1)
  const shown = rest.slice(-TALK_PAGE * (earlier + 1))
  return { ...(first ? { first } : {}), hidden: rest.length - shown.length, shown, ...(answer !== undefined ? { answer } : {}) }
}

// ---- Desktop: the cards ------------------------------------------------------------------------

/** Cells of text a card has across: the pane less the capsule's and the tile's air and edges. */
function innerCells(frame: Frame): number {
  return Math.max(20, frame.columns - 9)
}

/** Rows `text` takes at `width` cells, about. */
function linesOf(text: string, width: number): number {
  return text ? Math.max(1, Math.ceil(chOf(text) / Math.max(10, width))) : 0
}

/** Rows a card draws, about: for the presses laid over it and the capsule's water. */
function cardRows(frame: Frame, agent: AgentRec, now: number): number {
  const width = innerCells(frame)
  const head = linesOf(titleOf(agent), width - 14)
  const ident = 1.2 + (chOf(modelOf(agent, frame.lang)) + 24 > width ? 1 : 0)
  const nums = figures(frame, agent).length ? linesOf(figureLine(frame, agent) + '      ', width) : 0
  const act = live(agent) ? linesOf(doing(agent, now, frame.lang), width - 4) : 0
  const why = linesOf(whyLine(frame, agent), width - 2)
  const fall = agent.pick?.fallbackReason ? linesOf(t(frame.lang, 'agents.fallback', { reason: agent.pick.fallbackReason }), width - 2) : 0
  return head + ident + nums + act + why + fall + 1.3
}

/** A state's mark and its colour: running in the accent, waiting amber, done green, failed red. */
function mark(k: Look, agent: AgentRec): { glyph: string; color: string } {
  if (agent.state === 'running') return { glyph: '●', color: k.tone('violet') }
  if (agent.state === 'waiting') return { glyph: '◐', color: k.tone('amber') }
  if (agent.state === 'done') return { glyph: '✓', color: k.tone('green') }
  return { glyph: '✕', color: k.tone('red') }
}

/** The blank presses over a card, one a row: the host's button is one line high, a card several. */
function cardPress(el: Els, frame: Frame, key: string, rows: number, onPress: () => void): RenderNode {
  const { Box, Button } = el
  const label = blank((frame.columns - 4) * CELL_PX)
  const strips: RenderNode[] = []
  for (let i = 0; i < Math.ceil(rows) + 1; i++) {
    strips.push(
      <Box key={'strip-' + i} height={1} flexShrink={0} alignItems="center" justifyContent="center" overflow="hidden">
        <Button key={key + '-' + i} plain label={label} onPress={() => onPress()} />
      </Box>,
    )
  }
  return (
    <Box position="absolute" top={0} bottom={0} left={0} right={0} flexDirection="column" overflow="hidden">
      {strips}
    </Box>
  )
}

/** A card's rows: the head (mark, title, time), the model and effort, the numbers, what it does, why. */
function cardBody(el: Els, frame: Frame, agent: AgentRec, now: number, pressable: boolean): RenderNode[] {
  const { Box, Text } = el
  const k = lookOf(frame)
  const L = frame.lang
  const m = mark(k, agent)
  const model = modelOf(agent, L)
  const effort = effortOf(agent)
  const type = typeOf(agent, model)
  const why = whyLine(frame, agent)
  const nums = figures(frame, agent)
  const auto = agent.pick && ['haiku', 'jev', 'model'].includes(agent.pick.by)
  const rows: RenderNode[] = [
    <Box key="head" flexDirection="row" alignItems="flex-start" columnGap={1} width="100%" minWidth={0}>
      <Box key="mark" flexShrink={0}>
        <Text color={m.color} bold>{m.glyph}</Text>
      </Box>
      <Box key="title" flexGrow={1} flexShrink={1} minWidth={0}>
        <Text bold {...k.ink} wrap="wrap">{titleOf(agent)}</Text>
      </Box>
      <Box key="time" flexDirection="row" columnGap={1} flexShrink={0}>
        {agent.state === 'failed' ? <Text key="failed" color={k.tone('red')}>{t(L, 'agents.failed')}</Text> : null}
        <Text key="elapsed" {...(live(agent) ? k.ink : k.sub)}>{ranFor(agent, now, L)}</Text>
        {pressable ? <Text key="chev" {...k.mute}>›</Text> : null}
      </Box>
    </Box>,
    <Box key="ident" flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={1} paddingLeft={2} minWidth={0}>
      {agent.provider ? <Text key="dot" color={providerColor(agent.provider)}>●</Text> : null}
      <Text key="model" {...k.ink}>{model}</Text>
      {effort ? (
        <Box key="effort" flexDirection="row" alignItems="center" columnGap={1} flexShrink={0} paddingLeft={1}>
          {pic(el, 'meter-' + agent.id, k.art.meter(effortIndex(effort as Effort) + 1, auto ? 'auto' : 'manual'), t(L, 'band.effort'), METER_W, METER_H)}
          <Text key="effort-word" {...k.sub}>{effortLabel(effort, L)}</Text>
        </Box>
      ) : null}
      {type ? <Text key="type" {...k.mute}>{'· ' + type}</Text> : null}
    </Box>,
  ]
  if (nums.length) {
    rows.push(
      <Box key="nums" flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={2} paddingLeft={2} minWidth={0}>
        {nums.map(f => (
          <Box key={'n-' + f.key} flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
            {f.ring !== undefined ? pic(el, 'ring-' + agent.id, k.art.ring(f.ring, 'ink'), f.label, 16, 16) : null}
            <Text key="label" {...k.mute}>{f.label}</Text>
            <Text key="value" {...k.ink}>{f.value}</Text>
          </Box>
        ))}
      </Box>,
    )
  }
  if (live(agent)) {
    rows.push(
      <Box key="doing" flexDirection="row" alignItems="flex-start" columnGap={1} paddingLeft={2} minWidth={0}>
        <Text key="arrow" color={agent.state === 'waiting' ? k.tone('amber') : k.tone('violet')}>▸</Text>
        <Box key="what" flexShrink={1} minWidth={0}>
          <Text {...k.sub} wrap="wrap">{agent.state === 'waiting' ? t(L, 'agents.waiting') + ' · ' + doing(agent, now, L) : doing(agent, now, L)}</Text>
        </Box>
      </Box>,
    )
  }
  if (why) {
    rows.push(
      <Box key="why" paddingLeft={2} minWidth={0}>
        <Text {...k.mute} wrap="wrap">{why}</Text>
      </Box>,
    )
  }
  if (agent.pick?.fallbackReason) {
    rows.push(
      <Box key="fallback" paddingLeft={2} minWidth={0}>
        <Text color={k.tone('amber')} wrap="wrap">{t(L, 'agents.fallback', { reason: agent.pick.fallbackReason })}</Text>
      </Box>,
    )
  }
  return rows
}

/** One agent's tile; pressed, its conversation. */
function card(el: Els, frame: Frame, agent: AgentRec, now: number, onPress?: () => void): RenderNode {
  const { Box } = el
  const k = lookOf(frame)
  return (
    <Box key={'card-' + agent.id} flexDirection="column" width="100%" minWidth={0} paddingX={1.5} paddingY={0.5} {...k.tile}>
      {cardBody(el, frame, agent, now, !!onPress)}
      {onPress ? cardPress(el, frame, 'open-' + agent.id, cardRows(frame, agent, now), onPress) : null}
    </Box>
  )
}

/** The list on the desktop: one capsule, its head, the running agents' tiles, then the finished. */
function listDrawn(el: Els, frame: Frame, view: AgentsView, actions: AgentsActions, running: AgentRec[], done: AgentRec[]): RenderNode {
  const { Box, Text } = el
  const k = lookOf(frame)
  const L = frame.lang
  const idle = running.length === 0
  const shownDone = view.showDone ? done : done.slice(0, DONE_SHOWN)
  const total = totals(frame, view.agents)
  const face = 32
  // The head says what all of them took; each group's count heads the group.
  const head = (
    <Box key="agents-head" flexDirection="row" alignItems="center" columnGap={2} width="100%" minWidth={0}>
      {idle ? ripple(el, frame, 'agents', 'calm', t(L, 'band.brand'), face) : null}
      <Box key="agents-say" flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
        <Box flexDirection="row" alignItems="center" columnGap={1} flexWrap="wrap">
          <Text bold {...k.ink}>{t(L, 'agents.title')}</Text>
          <Text {...k.mute}>{t(L, 'band.brand')}</Text>
        </Box>
        {total ? (
          <Box flexDirection="row" columnGap={1} flexWrap="wrap">
            <Text {...k.mute}>{t(L, 'agents.total')}</Text>
            <Text {...k.sub}>{total}</Text>
          </Box>
        ) : null}
      </Box>
    </Box>
  )
  const section = (key: string, label: string) => (
    <Box key={'section-' + key} paddingLeft={0.5} paddingTop={0.5}>
      <Text {...k.mute}>{label}</Text>
    </Box>
  )
  const children: RenderNode[] = [head]
  if (running.length) children.push(section('live', t(L, 'agents.liveCount', { count: running.length })))
  for (const a of running) children.push(card(el, frame, a, view.now, () => actions.open(a.id)))
  if (done.length) children.push(section('done', t(L, 'agents.doneCount', { count: done.length })))
  for (const a of shownDone) children.push(card(el, frame, a, view.now, () => actions.open(a.id)))
  if (done.length > DONE_SHOWN) {
    children.push(
      <Box key="more-row" flexDirection="row" justifyContent="center" width="100%">
        {view.showDone
          ? pill(el, frame, 'done', t(L, 'agents.less'), 'ghost', actions.toggleDone, 'violet', 'back')
          : pill(el, frame, 'done', t(L, 'agents.more', { count: done.length - DONE_SHOWN }), 'ghost', actions.toggleDone, 'violet', 'next')}
      </Box>,
    )
  }
  const rows = 3 + [...running, ...shownDone].reduce((n, a) => n + cardRows(frame, a, view.now) + 0.6, 0) + (done.length > DONE_SHOWN ? 2 : 0) + 3
  return capsule(el, frame, {
    key: 'agents',
    // While nothing runs 리플이 floats at the head in calm water; while one runs the water holds
    // still, its light where the title is (the pane redraws each second then).
    sea: idle
      ? { tone: 'violet', ripples: 'calm', motes: true, reach: 110, at: { x: 1.5 * CELL_PX + face / 2, y: 9.5 + face / 2 } }
      : { tone: 'violet', reach: 120, at: { x: 1.5 * CELL_PX + 18, y: 20 } },
    rows,
    paddingY: 1,
    gap: 1,
    children,
  })
}

// ---- Desktop: the conversation -----------------------------------------------------------------

/** The page's own words for the conversation: the host's ink, and its quiet text colour for asides. */
function pageLook(frame: Frame): Look {
  return lookOf({ ...frame, skin: 'flat' })
}

/** A tool call's row: its mark, its name, its input in a few words. */
function toolRow(el: Els, frame: Frame, entry: Extract<AgentEntry, { kind: 'tool' }>, agentLive: boolean, since?: string): RenderNode {
  const { Box, Text } = el
  const k = pageLook(frame)
  const state = entry.state === 'running' && !agentLive ? 'unknown' : entry.state
  const glyph = state === 'ok' ? '✓' : state === 'error' ? '✕' : state === 'running' ? '◌' : '·'
  const color = state === 'ok' ? k.tone('green') : state === 'error' ? k.tone('red') : state === 'running' ? k.tone('violet') : undefined
  return (
    <Box key={'tool-' + entry.id} flexDirection="row" alignItems="flex-start" columnGap={1} minWidth={0}>
      <Box key="mark" flexShrink={0}>
        <Text {...(color ? { color } : k.mute)}>{glyph}</Text>
      </Box>
      <Box key="name" flexShrink={0}>
        <Text bold {...k.ink}>{entry.tool}</Text>
      </Box>
      {entry.detail ? (
        <Box key="detail" flexShrink={1} minWidth={0}>
          <Text {...k.sub} wrap="wrap">{clip(entry.detail, 110)}</Text>
        </Box>
      ) : null}
      {since ? <Text key="since" color={k.tone('violet')}>{since}</Text> : null}
    </Box>
  )
}

/** A boxed block on the page: the task it was given, or its answer (edged in its result's colour). */
function block(el: Els, frame: Frame, key: string, label: RenderNode, text: string, edge = 'rgba(128,124,116,0.32)'): RenderNode {
  const { Box, Markdown } = el
  return (
    <Box key={key} flexDirection="column" rowGap={0.5} width="100%" minWidth={0} paddingX={1.5} paddingY={0.5} borderStyle="round" borderColor={edge} backgroundColor="rgba(128,124,116,0.06)">
      {label}
      <Markdown key={key + '-text'} text={text} />
    </Box>
  )
}

/** The conversation under the card: the task, the latest entries, the answer, what it does now. */
function talkDrawn(el: Els, frame: Frame, view: AgentsView, agent: AgentRec, talk: AgentTalk, actions: AgentsActions): RenderNode {
  const { Box, Button, Markdown, Text } = el
  const k = pageLook(frame)
  const L = frame.lang
  if ('deny' in talk) {
    return (
      <Box key="talk" paddingX={1}>
        <Text {...k.sub} wrap="wrap">{t(L, 'agents.deny', { reason: talk.deny })}</Text>
      </Box>
    )
  }
  const page = pageOf(talk.entries, view.open?.earlier ?? 0, !live(agent))
  const items: RenderNode[] = []
  if (page.first?.kind === 'prompt') items.push(block(el, frame, 'task', <Text key="task-label" bold {...k.sub}>{t(L, 'agents.task')}</Text>, cut(page.first.text, PROMPT_MAX)))
  if (page.hidden > 0) {
    items.push(
      <Box key="earlier" flexDirection="row" justifyContent="center">
        <Button key="earlier" plain dimColor label={t(L, 'agents.earlier', { count: Math.min(page.hidden, TALK_PAGE) })} onPress={() => actions.earlier()} />
      </Box>,
    )
  }
  // Tool calls in a run stay together, a row apart from the words around them.
  let run: RenderNode[] = []
  const flush = () => {
    if (!run.length) return
    items.push(<Box key={'run-' + items.length} flexDirection="column" paddingLeft={1} minWidth={0}>{run}</Box>)
    run = []
  }
  // The call it is in now carries its time; with none in flight a last line says what it does.
  const inFlight = live(agent) ? page.shown.findLast(e => e.kind === 'tool' && e.state === 'running') : undefined
  const since = agent.toolSince ? elapsed(view.now - agent.toolSince, L) : undefined
  for (const entry of page.shown) {
    if (entry.kind === 'tool') { run.push(toolRow(el, frame, entry, live(agent), entry === inFlight ? since : undefined)); continue }
    flush()
    if (entry.kind === 'prompt') items.push(block(el, frame, 'prompt-' + items.length, <Text key="label" bold {...k.sub}>{t(L, 'agents.task')}</Text>, cut(entry.text, PROMPT_MAX)))
    else items.push(<Box key={'text-' + items.length} paddingX={1} minWidth={0}><Markdown text={cut(entry.text, TEXT_MAX)} /></Box>)
  }
  flush()
  if (page.answer !== undefined) {
    const ok = agent.state === 'done'
    items.push(block(el, frame, 'answer', (
      <Box key="answer-label" flexDirection="row" columnGap={1}>
        <Text color={ok ? k.tone('green') : k.tone('red')} bold>{ok ? '✓' : '✕'}</Text>
        <Text bold {...k.ink}>{t(L, 'agents.answer')}</Text>
      </Box>
    ), cut(page.answer, ANSWER_MAX), ok ? 'rgba(46,170,100,0.55)' : 'rgba(220,60,60,0.5)'))
  }
  if (live(agent) && !inFlight) {
    items.push(
      <Box key="now" flexDirection="row" columnGap={1} paddingLeft={1} minWidth={0}>
        <Text color={k.tone('violet')}>▸</Text>
        <Box flexShrink={1} minWidth={0}>
          <Text {...k.sub} wrap="wrap">{doing(agent, view.now, L)}</Text>
        </Box>
      </Box>,
    )
  }
  if (!talk.entries.length) items.push(<Box key="nothing" paddingX={1}><Text {...k.sub}>{t(L, 'agents.nothingYet')}</Text></Box>)
  return (
    <Box key="talk" flexDirection="column" rowGap={1} width="100%" minWidth={0}>
      {items}
    </Box>
  )
}

/** The conversation on the desktop: its card in the capsule with the way back, then what it said. */
function openDrawn(el: Els, frame: Frame, view: AgentsView, actions: AgentsActions, agent: AgentRec | undefined, talk: AgentTalk): RenderNode {
  const { Box, Text } = el
  const k = lookOf(frame)
  const L = frame.lang
  const back = pill(el, frame, 'back', t(L, 'agents.back'), 'ghost', actions.back, 'violet', 'back')
  if (!agent) {
    return capsule(el, frame, {
      key: 'agent-open',
      sea: { tone: 'violet', reach: 100 },
      rows: 4,
      paddingY: 1,
      gap: 1,
      children: [
        <Box key="open-head" flexDirection="row" alignItems="center" columnGap={2} width="100%" minWidth={0}>
          {back}
          <Box flexShrink={1} minWidth={0}>
            <Text {...k.sub} wrap="wrap">{t(L, 'agents.gone')}</Text>
          </Box>
        </Box>,
      ],
    })
  }
  const head = capsule(el, frame, {
    key: 'agent-open',
    sea: { tone: 'violet', reach: 120, at: { x: 1.5 * CELL_PX + 30, y: 20 } },
    rows: rowsOf(CONTROL_PX) + cardRows(frame, agent, view.now) + 3,
    paddingY: 1,
    gap: 1,
    children: [
      <Box key="open-head" flexDirection="row" alignItems="center" columnGap={2} width="100%" minWidth={0}>
        {back}
        <Box flexGrow={1} />
        <Text key="open-brand" {...k.mute}>{t(L, 'agents.title')}</Text>
      </Box>,
      card(el, frame, agent, view.now),
    ],
  })
  return (
    <Box flexDirection="column" rowGap={1} width="100%" minWidth={0}>
      {head}
      {talkDrawn(el, frame, view, agent, talk, actions)}
    </Box>
  )
}

// ---- Terminal ----------------------------------------------------------------------------------

/** The model line as text: the model, its effort, its type when that says more. */
function modelLine(frame: Frame, agent: AgentRec): string {
  const model = modelOf(agent, frame.lang)
  const effort = effortOf(agent)
  return [model, effort ? effortLabel(effort, frame.lang) : '', typeOf(agent, model)].filter(Boolean).join(' · ')
}

/** A terminal card: the dot and title, the model, why, and what it does with its time and tokens. */
function liveLines(el: Els, frame: Frame, agent: AgentRec, now: number, hotkey: string | undefined, onOpen: () => void): RenderNode {
  const { Box, Text } = el
  const tone = textTone(frame.appearance)
  const waiting = agent.state === 'waiting'
  const why = whyLine(frame, agent)
  const nums = figureLine(frame, agent)
  return (
    <Box key={'agent-' + agent.id} flexDirection="column">
      <Box key="title" flexDirection="row" alignItems="center" columnGap={1}>
        <Text color={waiting ? undefined : tone.accent} dimColor={waiting}>{waiting ? '○' : '●'}</Text>
        <Text bold wrap="wrap">{titleOf(agent)}</Text>
        {textButton(el, 'open-' + agent.id, t(frame.lang, 'agents.open'), onOpen, hotkey)}
      </Box>
      <Box key="model" flexDirection="row" flexWrap="wrap" columnGap={1} paddingLeft={2}>
        <Text>{modelLine(frame, agent)}</Text>
      </Box>
      {why ? (
        <Box key="why" paddingLeft={2}>
          <Text dimColor wrap="wrap">{why}</Text>
        </Box>
      ) : null}
      {agent.pick?.fallbackReason ? (
        <Box key="fallback" paddingLeft={2}>
          <Text color={tone.warn} wrap="wrap">{t(frame.lang, 'agents.fallback', { reason: agent.pick.fallbackReason })}</Text>
        </Box>
      ) : null}
      <Box key="doing" flexDirection="row" flexWrap="wrap" columnGap={2} paddingLeft={2}>
        <Text color={waiting ? undefined : tone.accent} dimColor={waiting} wrap="wrap">{'▸ ' + (waiting ? t(frame.lang, 'agents.waiting') + ' · ' : '') + doing(agent, now, frame.lang)}</Text>
        <Text dimColor>{ranFor(agent, now, frame.lang)}</Text>
        {nums ? <Text dimColor>{nums}</Text> : null}
      </Box>
    </Box>
  )
}

function doneLine(el: Els, frame: Frame, agent: AgentRec, now: number, hotkey: string | undefined, onOpen: () => void): RenderNode {
  const { Box, Text } = el
  const tone = textTone(frame.appearance)
  const ok = agent.state === 'done'
  const nums = figureLine(frame, agent)
  return (
    <Box key={'done-' + agent.id} flexDirection="row" flexWrap="wrap" columnGap={1} paddingLeft={1}>
      <Text color={ok ? tone.ok : tone.bad}>{ok ? '✓' : '✕'}</Text>
      <Text wrap="wrap">{titleOf(agent)}</Text>
      <Text dimColor>{modelLine(frame, agent)}</Text>
      <Text dimColor>{ranFor(agent, now, frame.lang)}</Text>
      {nums ? <Text dimColor>{nums}</Text> : null}
      {textButton(el, 'open-' + agent.id, t(frame.lang, 'agents.open'), onOpen, hotkey)}
    </Box>
  )
}

function listText(el: Els, frame: Frame, view: AgentsView, actions: AgentsActions, running: AgentRec[], done: AgentRec[]): RenderNode {
  const { Box, Text } = el
  const shownDone = view.showDone ? done : done.slice(0, DONE_SHOWN)
  // The first nine a digit each, in the order drawn.
  let n = 0
  const key = () => (++n <= 9 ? String(n) : undefined)
  return (
    <Box flexDirection="column" rowGap={1} width="100%">
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        <Text bold>{running.length ? t(frame.lang, 'agents.liveCount', { count: running.length }) : t(frame.lang, 'agents.noneRunning')}</Text>
        {done.length ? <Text dimColor>{t(frame.lang, 'agents.doneCount', { count: done.length })}</Text> : null}
      </Box>
      {running.map(agent => liveLines(el, frame, agent, view.now, key(), () => actions.open(agent.id)))}
      {shownDone.length ? (
        <Box flexDirection="column">
          {shownDone.map(agent => doneLine(el, frame, agent, view.now, key(), () => actions.open(agent.id)))}
        </Box>
      ) : null}
      {done.length > DONE_SHOWN ? (
        <Box flexDirection="row">
          {textButton(el, 'done', view.showDone ? t(frame.lang, 'agents.less') : t(frame.lang, 'agents.more', { count: done.length - DONE_SHOWN }), actions.toggleDone, 'f')}
        </Box>
      ) : null}
    </Box>
  )
}

/** The conversation as plain text: the way back, the agent, then each entry in a line or a few. */
function openText(el: Els, frame: Frame, view: AgentsView, actions: AgentsActions, agent: AgentRec | undefined, talk: AgentTalk): RenderNode {
  const { Box, Text } = el
  const tone = textTone(frame.appearance)
  const L = frame.lang
  const back = textButton(el, 'back', t(L, 'agents.back'), actions.back, 'b')
  if (!agent) {
    return (
      <Box flexDirection="column" rowGap={1} width="100%">
        {back}
        <Text dimColor wrap="wrap">{t(L, 'agents.gone')}</Text>
      </Box>
    )
  }
  const lines: RenderNode[] = []
  if ('deny' in talk) lines.push(<Text key="deny" dimColor wrap="wrap">{t(L, 'agents.deny', { reason: talk.deny })}</Text>)
  else {
    const page = pageOf(talk.entries, view.open?.earlier ?? 0, !live(agent))
    if (page.first?.kind === 'prompt') lines.push(<Box key="task" flexDirection="column"><Text dimColor>{t(L, 'agents.task')}</Text><Text wrap="wrap">{cut(page.first.text, 600)}</Text></Box>)
    if (page.hidden > 0) lines.push(<Box key="earlier">{textButton(el, 'earlier', t(L, 'agents.earlier', { count: Math.min(page.hidden, TALK_PAGE) }), actions.earlier, 'e')}</Box>)
    page.shown.forEach((entry, i) => {
      if (entry.kind === 'tool') {
        const state = entry.state === 'running' && !live(agent) ? 'unknown' : entry.state
        lines.push(
          <Box key={'e' + i} flexDirection="row" columnGap={1} paddingLeft={1}>
            <Text color={state === 'ok' ? tone.ok : state === 'error' ? tone.bad : state === 'running' ? tone.accent : undefined} dimColor={state === 'unknown'}>{state === 'ok' ? '✓' : state === 'error' ? '✕' : state === 'running' ? '◌' : '·'}</Text>
            <Text bold>{entry.tool}</Text>
            {entry.detail ? <Text dimColor wrap="wrap">{clip(entry.detail, 90)}</Text> : null}
          </Box>,
        )
      } else if (entry.kind === 'prompt') lines.push(<Box key={'e' + i} flexDirection="column"><Text dimColor>{t(L, 'agents.task')}</Text><Text wrap="wrap">{cut(entry.text, 600)}</Text></Box>)
      else lines.push(<Text key={'e' + i} wrap="wrap">{cut(entry.text, 1500)}</Text>)
    })
    if (page.answer !== undefined) lines.push(<Box key="answer" flexDirection="column"><Text bold color={agent.state === 'done' ? tone.ok : tone.bad}>{t(L, 'agents.answer')}</Text><Text wrap="wrap">{cut(page.answer, 4000)}</Text></Box>)
    if (!talk.entries.length) lines.push(<Text key="nothing" dimColor>{t(L, 'agents.nothingYet')}</Text>)
  }
  const nums = figureLine(frame, agent)
  return (
    <Box flexDirection="column" rowGap={1} width="100%">
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {back}
        <Text bold wrap="wrap">{titleOf(agent)}</Text>
      </Box>
      <Box flexDirection="column">
        <Text dimColor wrap="wrap">{[modelLine(frame, agent), ranFor(agent, view.now, L)].join(' · ')}</Text>
        {nums ? <Text dimColor wrap="wrap">{nums}</Text> : null}
        {live(agent) ? <Text color={tone.accent} wrap="wrap">{'▸ ' + doing(agent, view.now, L)}</Text> : null}
      </Box>
      {lines}
    </Box>
  )
}

// ---- The pane ----------------------------------------------------------------------------------

/** The Agents pane body: the list, or one agent's conversation. */
export function renderAgents(el: Els, frame: Frame, view: AgentsView, actions: AgentsActions): RenderNode {
  const drawn = canDraw(el, frame)
  if (view.open) {
    const agent = view.agents.find(a => a.id === view.open!.id)
    return drawn ? openDrawn(el, frame, view, actions, agent, view.open.talk) : openText(el, frame, view, actions, agent, view.open.talk)
  }
  // Empty, the pane has nothing to redraw it, so 리플이 can live out its idle loops here.
  if (view.agents.length === 0) return speak(el, frame, { key: 'agents', face: 'calm', size: GREET_SIZE, title: t(frame.lang, 'agents.emptyTitle'), line: t(frame.lang, 'agents.emptyBody') })
  const running = view.agents.filter(live).sort((a, b) => a.startedAt - b.startedAt)
  const done = view.agents.filter(a => !live(a)).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
  return drawn ? listDrawn(el, frame, view, actions, running, done) : listText(el, frame, view, actions, running, done)
}
