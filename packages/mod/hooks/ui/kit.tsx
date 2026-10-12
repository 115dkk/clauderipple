// The desktop's drawn controls, put together: a picture from art.ts, the host's text beside it, and
// a blank native button laid over both to take the press. Desktop and the editor only (an Svg in the
// table); the terminal keeps the text controls of parts.tsx.
//
// The blank button (host facts, 2026-10):
// - Its label is no-break spaces (U+00A0): the host sets a button's label `white-space: nowrap`,
//   which would fold ordinary spaces into one and leave a button nothing wide.
// - A plain Button is drawn at 12 px with no chrome; under the pointer it takes the host's ghost fill
//   over the picture, which is the hover. Too long a label is cut with an ellipsis that shows, so the
//   count is taken a little short of the box (the press area is then a few px narrower than the
//   drawing, never wider).
// - It sits in a Box laid over the control (absolute, all four edges at 0, centred), after the
//   picture and the text, so it is painted over them and takes the pointer.

import type { RenderNode } from 'claude-code'

import type { Els } from './parts'
import type { Frame } from './view'
import { CELL_PX, ROW_PX, backdrop, pillArt, segmentArt, sliderArt, textPx } from './art'
import type { Motion, PillLook, Tint } from './art'

/** Width of one U+00A0 in the host's 12 px button font, px, taken a little wide. */
const NBSP_PX = 3.6
/** The host's padding either side of a plain Button's label, px. */
const BUTTON_PAD = 6

/** Cells a run of px takes, rounded up. */
export function cellsOf(px: number): number {
  return Math.ceil(px / CELL_PX)
}

/** A blank label as wide as a button over `px` should be. */
export function blank(px: number): string {
  return ' '.repeat(Math.max(1, Math.floor((px - BUTTON_PAD * 2) / NBSP_PX)))
}

/** The blank button over a control `px` wide: last child of a `position: relative` Box. */
export function press(el: Els, key: string, px: number, onPress: () => void): RenderNode {
  const { Box, Button } = el
  return (
    <Box position="absolute" top={0} bottom={0} left={0} right={0} alignItems="center" justifyContent="center" overflow="hidden">
      <Button key={key} plain label={blank(px)} onPress={() => onPress()} />
    </Box>
  )
}

/** A picture, `width` × `height` px, in a Box of its own that never shrinks. */
export function pic(el: Els, key: string, source: string, alt: string, width: number, height: number): RenderNode {
  if (!('Svg' in el)) return ''
  const { Box, Svg } = el
  return (
    <Box key={'pic-' + key} flexShrink={0} alignItems="center">
      <Svg source={source} alt={alt} width={width} height={height} />
    </Box>
  )
}

/**
 * A control: a picture, then optionally a word in the host's text, the whole pressable. `pad`
 * cells either side give it a hover box with air around what it shows.
 */
export function control(
  el: Els,
  c: { key: string; source: string; alt: string; width: number; height: number; label?: string; labelColor?: string; dim?: boolean; bold?: boolean; onPress: () => void; pad?: number; after?: RenderNode; afterPx?: number },
): RenderNode {
  const { Box, Text } = el
  const pad = c.pad ?? 1
  const px = pad * 2 * CELL_PX + c.width + (c.label ? CELL_PX + textPx(c.label) : 0) + (c.afterPx ? CELL_PX + c.afterPx : 0)
  return (
    <Box key={'ctl-' + c.key} position="relative" flexDirection="row" alignItems="center" columnGap={1} paddingX={pad} flexShrink={0}>
      {pic(el, c.key, c.source, c.alt, c.width, c.height)}
      {c.label ? (
        <Text color={c.labelColor} dimColor={c.dim} bold={c.bold}>
          {c.label}
        </Text>
      ) : null}
      {c.after ?? null}
      {press(el, c.key, px, c.onPress)}
    </Box>
  )
}

/** A pill with its label drawn in, pressable: a card's main action, a lit Handoff. */
export function pill(el: Els, frame: Frame, key: string, label: string, look: PillLook, onPress: () => void, tint: Tint = 'violet', glow = 0): RenderNode {
  const { Box } = el
  const art = pillArt(label, look, frame.appearance, tint, 24, glow)
  const halo = glow > 0 ? 8 : 0
  return (
    <Box key={'pill-' + key} position="relative" flexShrink={0} alignItems="center" justifyContent="center" width={cellsOf(art.width - halo * 2)} height={1.3}>
      <Box position="absolute" top={-1} bottom={-1} left={-1} right={-1} alignItems="center" justifyContent="center">
        {pic(el, key, art.source, label, art.width, 24 + halo * 2)}
      </Box>
      {press(el, key, art.width - halo * 2, onPress)}
    </Box>
  )
}

export type SegmentOption<T extends string> = { value: T; label: string; hint?: string }

/**
 * A segmented control: one chip per option, the chosen one lit in the tint, each its own press. A
 * chip is as wide as its label (in whole cells, so the drawing and the text share a grid).
 */
export function segments<T extends string>(el: Els, frame: Frame, key: string, options: readonly SegmentOption<T>[], value: T | null, onPick: (value: T) => void, tint: Tint = 'violet', textColor?: string): RenderNode {
  const { Box, Text } = el
  return (
    <Box key={'seg-' + key} flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1} alignItems="center">
      {options.map(o => {
        const lit = o.value === value
        const width = Math.max(4, cellsOf(textPx(o.label) * 1.04 + 22))
        const px = width * CELL_PX
        const height = 1.35
        return (
          <Box key={'chip-' + key + '-' + o.value} position="relative" width={width} height={height} alignItems="center" justifyContent="center" flexShrink={0}>
            <Box position="absolute" top={0} left={0} right={0} bottom={0} alignItems="center" justifyContent="center">
              {pic(el, key + '-' + o.value, segmentArt(px, height * ROW_PX, lit, frame.appearance, tint), o.label, px, height * ROW_PX)}
            </Box>
            <Text color={lit ? textColor : undefined} dimColor={!lit} bold={lit}>
              {o.label}
            </Text>
            {press(el, key + '-' + o.value, px, () => onPick(o.value))}
          </Box>
        )
      })}
    </Box>
  )
}

/**
 * A stepped slider: `values` as stops on one drawn track, the chosen one lit, each stop the press
 * of an equal part of the track (`cellsPerStop` cells wide).
 */
export function stops<T extends string | number>(el: Els, frame: Frame, key: string, values: readonly T[], value: T, onPick: (value: T) => void, cellsPerStop = 4): RenderNode {
  const { Box } = el
  const width = values.length * cellsPerStop
  const px = width * CELL_PX
  const chosen = Math.max(0, values.indexOf(value))
  return (
    <Box key={'stops-' + key} position="relative" flexDirection="row" width={width} height={1.3} flexShrink={0}>
      <Box position="absolute" top={0} bottom={0} left={0} right={0} alignItems="center">
        {pic(el, key, sliderArt(px, values.length, chosen, frame.appearance), String(value), px, 22)}
      </Box>
      {values.map(v => (
        <Box key={'stop-' + key + '-' + v} position="relative" width={cellsPerStop} height={1.3} flexShrink={0}>
          {press(el, key + '-' + v, cellsPerStop * CELL_PX, () => onPick(v))}
        </Box>
      ))}
    </Box>
  )
}

/** The border every drawn surface takes: the tint at a strength that reads on light and dark. */
export const EDGE: Record<Tint, string> = {
  violet: 'rgba(129,112,232,0.42)',
  ice: 'rgba(80,160,220,0.45)',
  amber: 'rgba(205,145,30,0.45)',
  ember: 'rgba(226,103,46,0.48)',
  red: 'rgba(220,74,74,0.48)',
  green: 'rgba(34,163,94,0.45)',
}

/**
 * A drawn surface: a rounded, bordered Box with the backdrop behind its content, `rows` its usual
 * height in rows (the picture is taken taller than that and centred, so it always covers).
 */
export function surface(el: Els, frame: Frame, s: { key: string; tint: Tint; motion?: Motion; rows: number; column?: boolean; paddingX?: number; gap?: number; children: RenderNode[] }): RenderNode {
  const { Box } = el
  const width = Math.max(40, frame.columns) * CELL_PX + 80
  const height = Math.round(s.rows * ROW_PX + 16 + 2 * ROW_PX + 8)
  return (
    <Box key={s.key} position="relative" flexDirection={s.column ? 'column' : 'row'} alignItems={s.column ? undefined : 'center'} rowGap={s.gap ?? 0} paddingX={s.paddingX ?? 1} overflow="hidden" borderStyle="round" borderColor={EDGE[s.tint]} width="100%" minWidth={0}>
      <Box key={s.key + '-art'} position="absolute" top={-1} bottom={-1} right={0} alignItems="center">
        {pic(el, s.key + '-art', backdrop(width, height, frame.appearance, s.tint, s.motion), 'ClaudeRipple', width, height)}
      </Box>
      {s.children}
    </Box>
  )
}
