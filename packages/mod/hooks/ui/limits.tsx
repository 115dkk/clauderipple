// The limits pane: every plan window the router answered — Claude's 5-hour, weekly and per-model
// weeklies, then each ChatGPT account's — with the share used in that window and when it opens
// again. The band's limits row gauges the shares alone; its room went to them, so the reset times
// read here, on the row's press (2026-10-25: the owner asked for them off the band). A window
// close to its reset says the time left ("2시간 뒤"), a further one the weekday and the local clock
// ("목 09:00"), a passed one "초기화 중": view.ts `resetShort`, the same line the router's own
// status label draws.

import { t } from '../i18n'
import type { RenderNode } from 'claude-code'

import type { LimitItem } from '../../types'
import { DISPLAY, displayText } from './display'
import type { Els } from './parts'
import { chOf, displayWidth, limitTone, providerColor, textTone } from './theme'
import { isRich, limitGroupName, limitGroupNumbered, limitGroups, limitItemName, resetShort } from './view'
import type { Frame, LimitsView } from './view'

/** The least room a window's name takes, so the figures line up under each other. */
const NAME_MIN = 7
/** Cells a figure takes: the widest ("100%"), right-aligned in it. */
const FIGURE_CELLS = 4

/** Cells the widest window name takes on this surface, so every figure in the pane starts alike. */
function nameCells(items: readonly LimitItem[], frame: Frame): number {
  const width = (item: LimitItem) => {
    const name = limitItemName(item, frame.lang)
    return isRich(frame) ? Math.ceil(chOf(name)) : displayWidth(name)
  }
  return Math.max(NAME_MIN, ...items.map(width))
}

/**
 * The limits pane body: a group per provider account ("Claude", "GPT 1"), a line per window with
 * its share and its reset. The same on every surface; a text table needs no pictures.
 */
export function renderLimits(el: Els, frame: Frame, view: LimitsView): RenderNode {
  const { Box, Text } = el
  const L = frame.lang
  const tone = textTone(frame.appearance)
  const groups = limitGroups(view.items)
  const head = (
    <Box key="limits-head" flexDirection="column" width="100%" minWidth={0}>
      <Text bold>{t(L, 'limits.title')}</Text>
      <Text dimColor wrap="wrap">{t(L, groups.length ? 'limits.hint' : 'limits.empty')}</Text>
    </Box>
  )
  if (!groups.length) return <Box flexDirection="column" rowGap={1} width="100%">{head}</Box>
  const numbered = limitGroupNumbered(groups)
  const name = nameCells(view.items, frame)
  return (
    <Box flexDirection="column" rowGap={1} width="100%">
      {head}
      {groups.map(group => (
        <Box key={'limit-group-' + group.key} flexDirection="column" rowGap={0.5}>
          <Box key="head" flexDirection="row" alignItems="center" columnGap={1}>
            <Text color={providerColor(group.type ?? group.provider)}>•</Text>
            <Text bold>{limitGroupName(group, numbered(group))}</Text>
          </Box>
          {group.items.map((item, i) => {
            const reset = resetShort(item.resetsAt, frame.now, L)
            const percent = limitTone(item.percent)
            return (
              <Box key={'window-' + i} flexDirection="row" alignItems="center" columnGap={2} paddingLeft={2}>
                <Box width={name} flexShrink={0}>
                  <Text dimColor wrap="truncate">{limitItemName(item, L)}</Text>
                </Box>
                <Box width={FIGURE_CELLS} justifyContent="flex-end" flexShrink={0}>
                  <Text color={percent === 'ink' ? undefined : percent === 'warn' ? tone.warn : tone.bad}>{Math.round(item.percent) + '%'}</Text>
                </Box>
                {reset ? <Text dimColor wrap="wrap">{reset}</Text> : null}
              </Box>
            )
          })}
        </Box>
      ))}
    </Box>
  )
}

/** The render boundary's last resort: the error in plain words and the way out, nothing to fail again. */
export function renderLimitsFallback(el: Els, frame: Frame, error: string, close: () => void): RenderNode {
  const { Box, Text, Button } = el
  return (
    <Box flexDirection="column" rowGap={1} width="100%">
      <Box flexDirection="row" columnGap={2}>
        <Text bold>{t(frame.lang, 'limits.title')}</Text>
        <Button key="limits-close" plain role="dismiss" label={t(frame.lang, 'settings.close')} onPress={() => close()} />
      </Box>
      <Text dimColor wrap="wrap">{displayText(error, DISPLAY.preview)}</Text>
    </Box>
  )
}
