// The pieces every drawing is made of: the element table, 리플이, the way it speaks (its face on
// the left, what it says in one column beside it), and the controls of the cards and panels.
//
// One picture per surface, the rest native: 리플이 is the only Svg, every control a host Button.
// Engine and host facts behind that (Claude Code 2.1.293, the desktop app's assets, 2026-10-10):
// - The desktop draws every answer as a new DOM tree: each Svg becomes a new <img> or <iframe>,
//   blank until decoded or loaded, so every redraw blinks the pictures and restarts their
//   animations, identical markup or not (see band.tsx). A card that redraws while it is up blinks
//   all its pictures; with one picture, only 리플이 does, and its motion starts from its rest pose
//   so a restart reads as going on (ripple.ts).
// - A Button's label is text only and its colours are the host's. Styled chips were an Svg with a
//   blank native button laid over it, and that blank label had to be sized against the host's font
//   or the host cut it to an ellipsis (seen 2026-10-10 as "자동 (권장) …"). Native buttons have
//   neither problem, and they sit in the host's own idiom.
// - A plain Button under the pointer turns full ink on a ghost fill, dimmed or not, so a state told
//   by dimness alone looks the same on and off right after the click. A chosen option therefore
//   says so in its shape: ● chosen, ○ not (the terminal's marks too), the unchosen also dimmed.
// - `role="dismiss"` is drawn by the desktop as its native close control at the site's trailing
//   edge (the band's × is one), the label its accessible name; the terminal draws a Button.
// - An Svg needs alt, width and height (an interactive one without both falls back to ~300×150),
//   and animates only with isInteractive.

import type { ElementTable, RenderNode } from 'claude-code'

import type { Frame } from './view'
import { isRich } from './view'
import { GRID, MIN_SIZE, rippleBody, rippleCss } from './ripple'
import type { Face } from './ripple'
import { svgDoc } from './theme'

export type Els = ElementTable

/** 리플이's size wherever it speaks (cards, panels, setup), px: the sheet's card badge. */
export const FACE_SIZE = 44

/**
 * 리플이 with one of its faces (ripple.ts), `size` px square, never below MIN_SIZE. It moves, so it
 * is drawn interactive; the motion starts from the rest pose, so a redraw reads as going on.
 * `percent` fills the ring of a gauge face. Desktop and the editor only.
 */
export function mascot(el: Els, frame: Frame, key: string, face: Face, alt: string, size = FACE_SIZE, percent?: number): RenderNode {
  const s = Math.max(MIN_SIZE, size)
  if (!('Svg' in el)) return ''
  const { Box, Svg } = el
  // Drawn interactive, the document is the frame's page, and a page's body has a margin that
  // pushed the picture 8 px in and cut its right ear (seen in Chromium's srcdoc frames); an image
  // has no body, so the rule is idle there.
  const page = 'html,body{margin:0;padding:0;overflow:hidden;background:transparent}svg{display:block}'
  const source = svgDoc(s, s, frame.appearance, rippleBody(face, percent), page + rippleCss(face), '0 0 ' + GRID + ' ' + GRID)
  // In a Box of its own that never shrinks: beside a column of text it keeps its size.
  return (
    <Box key={'ripple-' + key} flexShrink={0}>
      <Svg source={source} alt={alt} width={s} height={s} isInteractive />
    </Box>
  )
}

/** True where 리플이 can be drawn: the desktop and the editor, with an Svg in the table. */
export function canDraw(el: Els, frame: Frame): boolean {
  return isRich(frame) && 'Svg' in el
}

export type Speech = {
  key: string
  face: Face
  /** What it says: one short sentence, bold. */
  title: string
  /** Quiet words on the title's line after it (a step count, a panel's name). */
  aside?: string
  /** Colour of the title on the terminal, where there is no face to carry it. */
  titleColor?: string
  /** One line of why, dim. */
  line?: string
  /** The ring as a gauge (a percent). */
  percent?: number
  /** What follows, each block a row apart: fields, options, the actions. */
  blocks?: RenderNode[]
  /** The site's close control (desktop: the host's native ×; terminal: in the last block). */
  dismiss?: RenderNode
}

/**
 * 리플이 speaks: on the desktop its face on the left and beside it one column, the title and its
 * line of why held together, then each block a row apart. The terminal draws the same column
 * without the face. Every card and panel uses this, so they share one rhythm.
 */
export function speak(el: Els, frame: Frame, s: Speech): RenderNode {
  const { Box, Text } = el
  const rich = isRich(frame)
  const head = (
    <Box key="say" flexDirection="column">
      <Box flexDirection="row" flexWrap="wrap" columnGap={2} alignItems="center">
        <Text bold color={rich ? undefined : s.titleColor} wrap="wrap">{s.title}</Text>
        {s.aside ? <Text dimColor>{s.aside}</Text> : null}
      </Box>
      {s.line ? <Text dimColor wrap="wrap">{s.line}</Text> : null}
    </Box>
  )
  const blocks = (s.blocks ?? []).filter(b => b !== '' && b !== null && b !== undefined)
  const column = (
    // The text takes the width the face leaves and wraps in it (a row that wraps sizes its items
    // to their whole line, which ran a body past the card: seen 2026-10-10).
    <Box key="column" flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0} rowGap={rich ? 1 : 0}>
      {head}
      {blocks}
    </Box>
  )
  if (!canDraw(el, frame)) {
    return (
      <Box key={'say-' + s.key} flexDirection="column" width="100%">
        {column}
        {s.dismiss ?? null}
      </Box>
    )
  }
  return (
    <Box key={'say-' + s.key} flexDirection="row" alignItems="flex-start" columnGap={2} width="100%">
      {mascot(el, frame, s.key, s.face, s.title, FACE_SIZE, s.percent)}
      {column}
      {s.dismiss ?? null}
    </Box>
  )
}

// ---- Controls ----------------------------------------------------------------------------------

/** A terminal (or mobile) control: `k: Label` with a hotkey, the label alone without one. */
export function textButton(el: Els, key: string, label: string, onPress: () => void, hotkey?: string, primary?: boolean): RenderNode {
  const { Button } = el
  // A bracketed button hides its hotkey on the terminal, so one with a hotkey stays plain (`s: Save`).
  if (primary && !hotkey) return <Button key={key} variant="primary" label={label} onPress={() => onPress()} />
  return hotkey ? <Button key={key} plain hotkey={hotkey} label={label} onPress={() => onPress()} /> : <Button key={key} plain label={label} onPress={() => onPress()} />
}

/**
 * A button. The one main action of a card or panel is the host's primary button on the desktop;
 * every other action is quiet, dim text until the pointer is on it. The terminal keeps its hotkeys.
 */
export function action(el: Els, frame: Frame, key: string, label: string, onPress: () => void, opts: { hotkey?: string; primary?: boolean } = {}): RenderNode {
  const { Button } = el
  if (isRich(frame)) {
    return opts.primary ? <Button key={key} variant="primary" label={label} onPress={() => onPress()} /> : <Button key={key} plain dimColor label={label} onPress={() => onPress()} />
  }
  return textButton(el, key, label, onPress, opts.hotkey, opts.primary)
}

/** The site's close control: the desktop's native ×, named `label`; a button on the terminal. */
export function dismiss(el: Els, frame: Frame, key: string, label: string, onPress: () => void, hotkey?: string): RenderNode {
  const { Button } = el
  if (isRich(frame)) return <Button key={key} plain role="dismiss" label={label} onPress={() => onPress()} />
  return textButton(el, key, label, onPress, hotkey)
}

/** The main action, then the quiet ones, in one row that wraps whole buttons. */
export function actions(el: Els, frame: Frame, buttons: RenderNode[]): RenderNode {
  const { Box } = el
  const shown = buttons.filter(b => b !== '' && b !== null && b !== undefined)
  if (!shown.length) return ''
  return (
    <Box key="actions" flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={isRich(frame) ? 1 : 2}>
      {shown}
    </Box>
  )
}

/** One option of several: `● Label` chosen, `○ Label` dim otherwise, on every surface. */
export function option(el: Els, key: string, label: string, chosen: boolean, onPress: () => void, hotkey?: string): RenderNode {
  const { Button } = el
  const text = (chosen ? '● ' : '○ ') + label
  if (hotkey) return <Button key={key} plain hotkey={hotkey} dimColor={!chosen} label={text} onPress={() => onPress()} />
  return <Button key={key} plain dimColor={!chosen} label={text} onPress={() => onPress()} />
}

/** A row of options, one chosen. */
export function segmented<T extends string>(
  el: Els,
  frame: Frame,
  key: string,
  options: readonly { value: T; label: string; hotkey?: string }[],
  value: T,
  onPick: (value: T) => void,
): RenderNode {
  const { Box } = el
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={isRich(frame) ? 1 : 2}>
      {options.map(o => option(el, key + '-' + o.value, o.label, o.value === value, () => onPick(o.value), isRich(frame) ? undefined : o.hotkey))}
    </Box>
  )
}

/** A two-state switch: one button that says its state (`● On` / `○ Off`) and flips it. */
export function toggle(el: Els, frame: Frame, key: string, label: string, on: boolean, onPress: () => void, hotkey?: string): RenderNode {
  return option(el, key, label, on, onPress, isRich(frame) ? undefined : hotkey)
}
