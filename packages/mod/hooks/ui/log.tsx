// The request log pane: the router's records of model requests, newest first, one entry each with
// what matters (model, provider, effort, tokens, cache, time, result). Moved here unchanged in
// content from register.tsx's own drawing.

import { t } from '../i18n'
import type { RenderNode } from 'claude-code'

import type { StatusRequest } from '../../types'
import { textButton } from './parts'
import type { Els } from './parts'
import { cacheTone, providerColor, textTone } from './theme'
import type { Frame, LogActions, LogView } from './view'
import { cachePercent, clockTime, effortLabel, isRich, modelOf, promptTokens, seconds } from './view'

function entry(el: Els, frame: Frame, record: StatusRequest, mineOnly: boolean): RenderNode {
  const { Box, Text } = el
  const tone = textTone(frame.appearance)
  const cache = cachePercent(record.usage)
  return (
    <Box key={record.at + '-' + record.target} flexDirection="column">
      <Box flexDirection="row" columnGap={1}>
        {mineOnly ? null : (
          <Text color={record.mine ? tone.accent : undefined} dimColor={!record.mine}>
            {record.mine ? '●' : '○'}
          </Text>
        )}
        <Text dimColor>{clockTime(record.at)}</Text>
        <Text bold wrap="truncate-end">
          {modelOf(record)}
        </Text>
        <Text color={providerColor(record.provider)}>{record.provider}</Text>
        {record.resent ? (
          <Text dimColor>{t(frame.lang, 'log.resent', { status: String(record.status) })}</Text>
        ) : (
          <Text color={record.ok ? tone.ok : tone.bad} bold={!record.ok}>
            {record.ok ? '✓' : '✕ ' + String(record.status)}
          </Text>
        )}
      </Box>
      <Box flexDirection="row" columnGap={1}>
        <Text dimColor>{record.effort ? effortLabel(record.effort, frame.lang) : '-'}</Text>
        {record.usage ? <Text dimColor>{t(frame.lang, 'log.input', { tokens: tokens(promptTokens(record.usage)) })}</Text> : null}
        {cache !== undefined ? <Text color={tone[cacheTone(cache)]}>{t(frame.lang, 'band.cachePercent', { percent: cache })}</Text> : null}
        {record.usage ? <Text dimColor>{t(frame.lang, 'log.output', { tokens: tokens(record.usage.output) })}</Text> : null}
        <Text dimColor>{seconds(record.ms / 1000, frame.lang)}</Text>
      </Box>
      {!record.ok && record.note ? (
        <Text color={record.resent ? undefined : tone.bad} dimColor={record.resent} wrap="wrap">
          {record.note}
        </Text>
      ) : null}
    </Box>
  )
}

/** The log pane body. */
export function renderLog(el: Els, frame: Frame, view: LogView, actions: LogActions): RenderNode {
  const { Box, Text } = el
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" gap={1}>
        <Text bold>{view.mineOnly ? t(frame.lang, 'log.thisSession') : t(frame.lang, 'log.allSessions')}</Text>
        {textButton(el, 'scope', view.mineOnly ? t(frame.lang, 'log.showAll') : t(frame.lang, 'log.onlySession'), actions.toggleScope, isRich(frame) ? undefined : 'a')}
      </Box>
      {!view.mineOnly && <Text dimColor>{t(frame.lang, 'log.legend')}</Text>}
      {view.rows.length === 0 && <Text dimColor>{t(frame.lang, 'log.empty')}</Text>}
      {view.rows.map(record => entry(el, frame, record, view.mineOnly))}
    </Box>
  )
}

// The log keeps one decimal at every size (12.3k), as it always has.
function tokens(n: number): string {
  return n >= 1_000_000 ? (n / 1_000_000).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n)
}
