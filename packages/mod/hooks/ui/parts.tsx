// The pieces every drawing is made of: the element table, the desktop chip (an SVG with a
// transparent native button laid over it), the terminal's hotkey button, the mascot's chip, and
// the controls of the cards and panels.
//
// Engine facts these follow (Claude Code 2.1.293):
// - A Button's label is text only and its colours are the host's, so a styled control is an Svg
//   in the flow with an absolutely placed Box after it holding a plain Button whose label is
//   no-break spaces. The hit layer comes after the picture so it paints, and takes the pointer,
//   above it. Braille blanks are not used: some fonts draw them as dots.
// - The desktop's native button truncates a label wider than its room with an ellipsis, drawn in
//   the host's ink: seen 2026-10-10 as "자동 (권장) …" on every chip, the blank label (sized at
//   3.4 px a space) being wider than the chip in the host's 14 px font. So the blank label is
//   sized at HIT_SPACE_PX, above a no-break space's width in any sans-serif up to 16 px (system-ui
//   16 px measures 4.19, Hiragino Sans 15 px 4.99 / 16 px 5.33 is not a UI font), minus the
//   button's own padding, and the button sits in a Box that does not shrink: should a host font
//   still be wider, the button is clipped by the chip, never shortened to an ellipsis.
// - An Svg needs alt, width and height (an interactive one without both falls back to ~300×150),
//   and animates only with isInteractive.
// - The desktop draws every answer as a new DOM tree: each Svg becomes a new <img> or <iframe>,
//   blank until decoded or loaded, so every redraw blinks the pictures and restarts their
//   animations, identical markup or not (see band.tsx). A drawing that redraws while idle (the
//   band) uses native text; motion is CSS inside the SVG, looping from and back to its rest pose
//   so a restart does not jump (ripple.ts).

import { t } from '../i18n'
import type { ElementTable, RenderNode } from 'claude-code'

import type { Frame } from './view'
import { GRID, MIN_SIZE, rippleBody, rippleCss } from './ripple'
import type { Face } from './ripple'
import { esc, svgDoc, textWidth, v } from './theme'
import type { Palette } from './theme'

export type Els = ElementTable

const NBSP = ' '

/** The widest a no-break space is taken to draw in the host's button font, px. */
export const HIT_SPACE_PX = 4.5
/** Room left for the native button's own padding and border, px. */
export const HIT_PAD_PX = 8

/**
 * A label of no-break spaces that fits a chip `width` px across: at HIT_SPACE_PX a space, with the
 * button's padding, it is never wider than the chip, so the host has nothing to cut.
 */
export function hitLabel(width: number): string {
  return NBSP.repeat(Math.max(1, Math.floor((width - HIT_PAD_PX) / HIT_SPACE_PX)))
}

/** The widest a blank hit label can draw, padding included: what the tests hold to the chip. */
export function hitLabelWidth(label: string): number {
  return [...label].length * HIT_SPACE_PX + HIT_PAD_PX
}

export type ChipSpec = {
  key: string
  /** The SVG document, from svgDoc. */
  source: string
  alt: string
  width: number
  height: number
  /** True for markup that animates or carries a <title> tooltip. */
  live?: boolean
  onPress?: () => void
}

/** A picture, and a hit button over it when it is pressable. Desktop and the editor only. */
export function chip(el: Els, spec: ChipSpec): RenderNode {
  if (!('Svg' in el)) return ''
  const { Box, Button, Svg } = el
  const picture = spec.live ? (
    <Svg source={spec.source} alt={spec.alt} width={spec.width} height={spec.height} isInteractive />
  ) : (
    <Svg source={spec.source} alt={spec.alt} width={spec.width} height={spec.height} />
  )
  const onPress = spec.onPress
  if (!onPress) return picture
  return (
    // flexShrink 0: an overflow-hidden flex item may shrink below its content, cutting the label.
    // The hit button is centred, so what its blank label leaves uncovered is split between the
    // chip's two ends, and sits in a Box that never shrinks (see the note at the top).
    <Box key={'chip-' + spec.key} position="relative" overflow="hidden" flexShrink={0}>
      {picture}
      <Box position="absolute" top={0} left={0} right={0} bottom={0} overflow="hidden" flexDirection="row" justifyContent="center">
        <Box flexShrink={0}>
          <Button key={spec.key} plain label={hitLabel(spec.width)} onPress={() => onPress()} />
        </Box>
      </Box>
    </Box>
  )
}

/** A terminal (or mobile) control: `k: Label` with a hotkey, the label alone without one. */
export function textButton(el: Els, key: string, label: string, onPress: () => void, hotkey?: string, primary?: boolean): RenderNode {
  const { Button } = el
  // A bracketed button hides its hotkey on the terminal, so one with a hotkey stays plain (`s: Save`).
  if (primary && !hotkey) return <Button key={key} variant="primary" label={label} onPress={() => onPress()} />
  return hotkey ? <Button key={key} plain hotkey={hotkey} label={label} onPress={() => onPress()} /> : <Button key={key} plain label={label} onPress={() => onPress()} />
}

// ---- SVG building blocks -----------------------------------------------------------------------

export const PILL_H = 28

/** A chip's body: translucent ink, or the accent wash when lit. */
export function plate(w: number, ht: number, lit: boolean, r = 9): string {
  return (
    '<rect x="0.5" y="0.5" width="' + (w - 1) + '" height="' + (ht - 1) + '" rx="' + r + '" fill="' +
    (lit ? v('accentWash') : v('fill')) + '" stroke="' + (lit ? v('accentLine') : v('stroke')) + '"/>'
  )
}

/** A filled accent plate: the one primary action of a card. */
export function primaryPlate(w: number, ht: number, r = 9): string {
  return '<rect x="0" y="0" width="' + w + '" height="' + ht + '" rx="' + r + '" fill="' + v('primary') + '"/>'
}

export function text(x: number, y: number, cls: string, content: string, fill?: string, anchor?: 'end' | 'middle'): string {
  return (
    '<text x="' + x + '" y="' + y + '" class="' + cls + '"' + (fill ? ' style="fill:' + fill + '"' : '') +
    (anchor ? ' text-anchor="' + anchor + '"' : '') + '>' + esc(content) + '</text>'
  )
}

/**
 * 리플이 with one of its faces (ripple.ts), `size` px square, never below MIN_SIZE. It moves, so it
 * is drawn interactive; the motion starts from the rest pose, so a redraw reads as going on.
 * `percent` fills the ring of a gauge face. Desktop and the editor only.
 */
export function mascot(el: Els, frame: Frame, key: string, face: Face, alt: string, size = 44, percent?: number): RenderNode {
  const s = Math.max(MIN_SIZE, size)
  if (!('Svg' in el)) return ''
  const { Box } = el
  // Drawn interactive, the document is the frame's page, and a page's body has a margin that
  // pushed the picture 8 px in and cut its right ear (seen in Chromium's srcdoc frames); an image
  // has no body, so the rule is idle there.
  const page = 'html,body{margin:0;padding:0;overflow:hidden;background:transparent}svg{display:block}'
  const source = svgDoc(s, s, frame.appearance, rippleBody(face, percent), page + rippleCss(face), '0 0 ' + GRID + ' ' + GRID)
  // In a Box of its own that never shrinks: beside a column of text it keeps its size.
  return (
    <Box key={'ripple-' + key} flexShrink={0}>
      {chip(el, { key: 'ripple-' + key, source, alt, width: s, height: s, live: true })}
    </Box>
  )
}

/** A small switch: track and knob, lit in the accent; `mixed` (a group partly on) centres the knob. */
export function switchGlyph(x: number, y: number, on: boolean | 'mixed'): string {
  if (on === 'mixed') {
    return (
      '<rect x="' + x + '" y="' + y + '" width="22" height="12" rx="6" fill="' + v('accentWash') + '" stroke="' + v('accent') + '" stroke-width="1.2"/>' +
      '<rect x="' + (x + 7) + '" y="' + (y + 5.2) + '" width="8" height="1.6" rx="0.8" fill="' + v('accent') + '"/>'
    )
  }
  return (
    '<rect x="' + x + '" y="' + y + '" width="22" height="12" rx="6" fill="' + (on ? v('accent') : 'none') + '" stroke="' +
    (on ? v('accent') : v('muted')) + '" stroke-width="1.2"/>' +
    '<circle cx="' + (on ? x + 16 : x + 6) + '" cy="' + (y + 6) + '" r="' + (on ? 4 : 3.4) + '" fill="' + (on ? '#fff' : v('muted')) + '"/>'
  )
}

// ---- Generic desktop controls ------------------------------------------------------------------

export type PillOptions = {
  key: string
  label: string
  onPress: () => void
  /** Lit: the accent wash (a selected segment, an active toggle). */
  lit?: boolean
  /** The card's main action: filled accent. */
  primary?: boolean
  /** Leading glyph, drawn in a 14px box whose top-left is (x, y). */
  glyph?: (x: number, y: number) => string
  /** A switch before the label: on, off, or mixed (a group partly on). */
  toggle?: boolean | 'mixed'
  /** A small count badge after the label. */
  badge?: string
  /** A quiet second line under the label (a candidate's provider and score). */
  sub?: string
  /** At least this wide, so a list of pills lines up. */
  minWidth?: number
  height?: number
  alt?: string
}

/** A pressable pill (desktop): plate, optional glyph or switch, label, optional badge. */
export function pill(el: Els, frame: Frame, o: PillOptions): RenderNode {
  const ht = o.height ?? (o.sub ? 40 : PILL_H)
  if (!o.label && o.glyph) {
    // An icon alone: a square plate.
    return chip(el, {
      key: o.key,
      source: svgDoc(ht, ht, frame.appearance, plate(ht, ht, o.lit === true) + o.glyph(ht / 2 - 7, ht / 2 - 7)),
      alt: o.alt ?? o.key,
      width: ht,
      height: ht,
      onPress: o.onPress,
    })
  }
  const lw = textWidth(o.label, 12)
  let x = 11
  let body = ''
  if (o.toggle !== undefined) {
    body += switchGlyph(x, ht / 2 - 6, o.toggle)
    x += 29
  } else if (o.glyph) {
    body += o.glyph(x, ht / 2 - 7)
    x += 20
  }
  const labelTone = o.primary ? '#fff' : o.lit ? v('accent') : v('ink')
  if (o.sub) {
    body += text(x, ht / 2 - 2, 'lbl', o.label, labelTone) + text(x, ht / 2 + 11.5, 'sub', o.sub)
    x += Math.max(lw, textWidth(o.sub, 11.5))
  } else {
    body += text(x, ht / 2 + 4.2, 'lbl', o.label, labelTone)
    x += lw
  }
  if (o.badge) {
    const bw = Math.max(16, textWidth(o.badge, 10.5) + 9)
    x += 6
    body +=
      '<rect x="' + x + '" y="' + (ht / 2 - 8) + '" width="' + bw + '" height="16" rx="8" fill="' + v('primary') + '"/>' +
      '<text x="' + (x + bw / 2) + '" y="' + (ht / 2 + 3.8) + '" text-anchor="middle" style="fill:#fff;font-size:10.5px;font-weight:700">' + esc(o.badge) + '</text>'
    x += bw
  }
  const w = Math.max(o.minWidth ?? 0, Math.ceil(x + 11))
  const plateMarkup = o.primary ? primaryPlate(w, ht) : plate(w, ht, o.lit === true)
  return chip(el, {
    key: o.key,
    source: svgDoc(w, ht, frame.appearance, plateMarkup + body),
    alt: o.alt ?? o.label + (o.sub ? ', ' + o.sub : '') + (o.toggle !== undefined ? t(frame.lang, o.toggle === 'mixed' ? 'settings.mixedSuffix' : o.toggle ? 'settings.onSuffix' : 'settings.offSuffix') : o.lit ? t(frame.lang, 'settings.selected') : ''),
    width: w,
    height: ht,
    onPress: o.onPress,
  })
}

/**
 * A row of options, one selected (desktop pills or terminal buttons). Terminal labels carry a
 * ●/○ so the choice reads without colour.
 */
export function segmented<T extends string>(
  el: Els,
  frame: Frame,
  key: string,
  options: readonly { value: T; label: string; hotkey?: string }[],
  value: T,
  onPick: (value: T) => void,
): RenderNode {
  const { Box } = el
  if (frame.surface === 'desktop' || frame.surface === 'vscode') {
    return (
      <Box flexDirection="row" flexWrap="wrap" gap={1}>
        {options.map(o => pill(el, frame, { key: key + '-' + o.value, label: o.label, lit: o.value === value, onPress: () => onPick(o.value), height: 26 }))}
      </Box>
    )
  }
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
      {options.map(o => textButton(el, key + '-' + o.value, (o.value === value ? '● ' : '○ ') + o.label, () => onPick(o.value), o.hotkey))}
    </Box>
  )
}

/** A two-state switch: a desktop pill with a switch, or `● On` / `○ Off` on the terminal. */
export function toggle(el: Els, frame: Frame, key: string, label: string, on: boolean, onPress: () => void, hotkey?: string): RenderNode {
  if (frame.surface === 'desktop' || frame.surface === 'vscode') return pill(el, frame, { key, label, toggle: on, onPress, height: 26 })
  return textButton(el, key, (on ? '● ' : '○ ') + label, onPress, hotkey)
}

/** A button: the desktop pill (primary filled) or a terminal button. */
export function action(el: Els, frame: Frame, key: string, label: string, onPress: () => void, opts: { hotkey?: string; primary?: boolean; lit?: boolean; glyph?: (x: number, y: number) => string } = {}): RenderNode {
  if (frame.surface === 'desktop' || frame.surface === 'vscode') {
    const o: PillOptions = { key, label, onPress }
    if (opts.primary) o.primary = true
    if (opts.lit) o.lit = true
    if (opts.glyph) o.glyph = opts.glyph
    return pill(el, frame, o)
  }
  return textButton(el, key, label, onPress, opts.hotkey, opts.primary)
}

/** Colour of a palette key as SVG paint. */
export function tone(key: keyof Palette): string {
  return v(key)
}
