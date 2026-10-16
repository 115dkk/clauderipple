// The matrix's cells (2026-10-15): the pictures of the board, after EqualizerAPO-XT's Signal Matrix
// skin (its constitution, docs/skins/matrix.md there). The screen is a board: a departure board, a
// broadcast routing matrix. Everything sits on a grid, every row is a cell with a coordinate, and
// colour is rationed to state: green = on/active, amber = bypass/caution, red = danger, the accent
// cyan = engaged, selected, addressed, routed signal data; everything else is monochrome, and a
// cancelled row says so by shape (a dashed rule, a hollow amber lamp), not by colour. Radius 0, 1px
// rules, crisp: no curvature, no shadow, no glow. Figures are bold mono in boxed, sunken cells.
//
// The board has a dark face and a light one; every picture takes its colours from CSS variables
// switched by `prefers-color-scheme`, as flat.ts does, so the board follows the app's theme. Host
// Text on the board is the host's own ink: titles in it, the quiet lines dimmed, never coloured,
// since colour belongs to rails, lamps and cells, and those are drawn here. Pure: SVG only.

import { CELL_PX, ICON } from './art.ts'
import type { Icon } from './art.ts'
import type { Palette } from './theme.ts'
import { displayWidth } from './theme.ts'

type Face = Record<'bg' | 'surface' | 'card' | 'cardHover' | 'text' | 'muted' | 'border' | 'sunken' | 'grid' | 'accent' | 'accent2' | 'success' | 'warning' | 'danger' | 'onAccent', string>

/** EqualizerAPO-XT's matrix tokens, dark and light (docs/design-system/project/tokens.json there). */
export const FACE: { dark: Face; light: Face } = {
  dark: { bg: '#060b10', surface: '#0b141c', card: '#101b25', cardHover: '#142432', text: '#dff5ff', muted: '#7fa0ae', border: '#233443', sunken: '#041018', grid: '#183443', accent: '#22d3ee', accent2: '#7cffb2', success: '#22c55e', warning: '#f59e0b', danger: '#ef4444', onAccent: '#06141a' },
  light: { bg: '#dceaef', surface: '#ebebeb', card: '#deeef4', cardHover: '#d7edf4', text: '#10242f', muted: '#5f7782', border: '#d0e0e6', sunken: '#deeef4', grid: '#d0e0e6', accent: '#008eaa', accent2: '#0a8f57', success: '#15803d', warning: '#b45309', danger: '#dc2626', onAccent: '#ebebeb' },
}

/** 리플이 on the board (theme.ts `svgDoc`): board ink, furniture rather than signal, its worries in the rationed colours. */
export const BOARD_PALETTE: { dark: Palette; light: Palette } = {
  dark: { ink: FACE.dark.text, muted: FACE.dark.muted, faint: FACE.dark.border, fill: 'rgba(223,245,255,0.05)', stroke: 'rgba(223,245,255,0.2)', accent: FACE.dark.muted, accentWash: 'rgba(127,160,174,0.15)', accentLine: 'rgba(127,160,174,0.6)', primary: FACE.dark.accent, ok: FACE.dark.success, warn: FACE.dark.warning, bad: FACE.dark.danger },
  light: { ink: FACE.light.text, muted: FACE.light.muted, faint: FACE.light.border, fill: 'rgba(16,36,47,0.04)', stroke: 'rgba(16,36,47,0.15)', accent: FACE.light.muted, accentWash: 'rgba(95,119,130,0.15)', accentLine: 'rgba(95,119,130,0.6)', primary: FACE.light.accent, ok: FACE.light.success, warn: FACE.light.warning, bad: FACE.light.danger },
}

/** The board's grid pitch, px (their `MatrixMetrics::gridPitch`), the rail's width and the lamp's side. */
export const PITCH = 24
export const RAIL = 3
export const LAMP = 5

/** A control's height, px: a port strip, a plate, a power cell (kit.tsx's CONTROL_PX). */
export const CONTROL = 26
/** A boxed readout's and a caption's height, px. */
export const READOUT = 22
/** A type code cell's height, px. */
export const CODE = 20

const V = (name: keyof Face): string => 'var(--' + name + ')'
const MONO = "ui-monospace,'Cascadia Mono',Consolas,'SF Mono',Menlo,'DM Mono','Roboto Mono',monospace"
const r = (x: number): string => String(Math.round(x * 100) / 100)

function vars(face: Face): string {
  return (Object.keys(face) as (keyof Face)[]).map(k => '--' + k + ':' + face[k]).join(';')
}

export function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * One board picture, `w` × `h` px. Rules and cells are crisp (no antialiasing under a 1px rule);
 * only type and curves (`.aa`) are smoothed. Nothing moves when less motion is asked for.
 */
export function bsvg(w: number, h: number, body: string, css = ''): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + r(w) + '" height="' + r(h) + '" viewBox="0 0 ' + r(w) + ' ' + r(h) + '"><style>' +
    'svg{' + vars(FACE.light) + '}@media (prefers-color-scheme:dark){svg{' + vars(FACE.dark) + '}}' +
    'rect,line,path{shape-rendering:crispEdges}.aa{shape-rendering:geometricPrecision}' +
    'text{font-family:' + MONO + ';font-variant-numeric:tabular-nums}' +
    '@media (prefers-reduced-motion:reduce){*{animation:none!important}}' + css + '</style>' + body + '</svg>'
  )
}

/** Pixels a run of mono type takes at `size` px: Latin 0.6 em, East Asian wide 1 em, plus letter spacing. */
export function monoPx(text: string, size: number, spacing = 0): number {
  let px = 0
  for (const char of text) px += (displayWidth(char) === 2 ? 1 : 0.6) * size + spacing
  return px
}

/** `text` cut to `maxPx` of mono type at `size`, elided rather than squeezed. */
export function elide(text: string, maxPx: number, size: number, spacing = 0): string {
  if (monoPx(text, size, spacing) <= maxPx) return text
  let out = ''
  for (const char of text) {
    if (monoPx(out + char + '…', size, spacing) > maxPx) break
    out += char
  }
  return out + '…'
}

/** Board type: codes and captions are uppercase (Latin only; other scripts have no case). */
export function caps(text: string): string {
  return text.toUpperCase()
}

/** Mono text at `x`, `y` (baseline), `size` px, in an ink. */
function type(text: string, x: number, y: number, size: number, ink: string, weight: number, anchor: 'start' | 'middle' | 'end' = 'start', spacing = 0): string {
  return '<text x="' + r(x) + '" y="' + r(y) + '" font-size="' + r(size) + '" font-weight="' + weight + '" fill="' + ink + '" text-anchor="' + anchor + '"' + (spacing ? ' letter-spacing="' + spacing + '"' : '') + '>' + esc(text) + '</text>'
}

/** Whole cells a run of px takes. */
export function cellsOf(px: number): number {
  return Math.ceil(px / CELL_PX)
}

// ---- Lamps and rails ---------------------------------------------------------------------------

/**
 * What a row's lamp and rail say: on (solid green), bypass (hollow amber), off (hollow border ink:
 * no signal), busy (the accent, blinking in steps while something is being decided), danger
 * (solid red), done (solid green), remark (no lamp, the rail in border ink).
 */
export type Lamp = 'on' | 'bypass' | 'off' | 'busy' | 'danger' | 'remark'

function lampInk(lamp: Lamp): { fill: string; stroke: string } {
  switch (lamp) {
    case 'on': return { fill: V('success'), stroke: V('success') }
    case 'bypass': return { fill: 'none', stroke: V('warning') }
    case 'busy': return { fill: V('accent'), stroke: V('accent') }
    case 'danger': return { fill: V('danger'), stroke: V('danger') }
    case 'remark': return { fill: 'none', stroke: 'none' }
    default: return { fill: 'none', stroke: V('muted') }
  }
}

function railInk(lamp: Lamp): string {
  return lamp === 'on' ? V('success') : lamp === 'bypass' ? V('warning') : lamp === 'busy' ? V('accent') : lamp === 'danger' ? V('danger') : V('border')
}

/** A lamp, `side` px square, at `x`, `y`. */
function lampAt(lamp: Lamp, x: number, y: number, side = LAMP): string {
  if (lamp === 'remark') return ''
  const ink = lampInk(lamp)
  const blink = lamp === 'busy' ? ' class="bl"' : ''
  return ink.fill === 'none'
    ? '<rect' + blink + ' x="' + r(x + 0.5) + '" y="' + r(y + 0.5) + '" width="' + r(side - 1) + '" height="' + r(side - 1) + '" fill="none" stroke="' + ink.stroke + '"/>'
    : '<rect' + blink + ' x="' + r(x) + '" y="' + r(y) + '" width="' + side + '" height="' + side + '" fill="' + ink.fill + '"/>'
}

const BLINK = '.bl{animation:bl 1s steps(2) infinite}@keyframes bl{50%{opacity:.25}}'

/** A lamp on its own, 7 px, for a cell's corner or a reading's side. */
export function lampArt(lamp: Lamp): string {
  return bsvg(7, 7, lampAt(lamp, 0, 0, 7), BLINK)
}

/** The 24 px column grid over `w` × `h` from `x0`: the board's texture, border ink at a strength. */
function grid(x0: number, w: number, y: number, h: number, alpha: number): string {
  let out = '<g stroke="' + V('border') + '" stroke-opacity="' + alpha + '">'
  for (let x = x0 + PITCH; x < w; x += PITCH) out += '<line x1="' + r(x + 0.5) + '" y1="' + r(y) + '" x2="' + r(x + 0.5) + '" y2="' + r(y + h) + '"/>'
  return out + '</g>'
}

/**
 * The board under a capsule, `w` × `h` px from its top left: the ground, its column grid, and the
 * rail along the left in the state's colour with the lamp at `lampY`. `headerPx` is a header band
 * in card ink across the top (the quick settings' masthead); the band has none.
 */
export function groundArt(w: number, h: number, o: { lamp: Lamp; lampY: number; headerPx?: number }): string {
  const header = o.headerPx ?? 0
  let body = '<rect width="' + r(w) + '" height="' + r(h) + '" fill="' + V('bg') + '"/>'
  if (header) body += '<rect width="' + r(w) + '" height="' + header + '" fill="' + V('card') + '"/><line x1="0" y1="' + (header + 0.5) + '" x2="' + r(w) + '" y2="' + (header + 0.5) + '" stroke="' + V('border') + '"/>'
  body += grid(RAIL + 4, w, 0, header || h, header ? 0.6 : 0.35)
  body += '<rect width="' + RAIL + '" height="' + r(h) + '" fill="' + railInk(o.lamp) + '"/>'
  body += lampAt(o.lamp, RAIL + 5, o.lampY)
  return bsvg(w, h, body, BLINK)
}

/** How far a row's content starts from the capsule's left edge: rail, gutter, lamp, coordinate cell. */
export const LEAD_PX = RAIL + 5 + LAMP + 8 + 30

/**
 * One row's board, `w` × `h` px: its top rule, the rail and lamp, the coordinate cell (the kind's
 * letter and the line's number, muted ink; the accent while engaged), a header band in card ink
 * with the column grid behind it, and the body in ground ink. A cancelled row keeps its place with
 * a dashed rule and a hollow amber lamp. The lamp sits at the header's middle.
 */
export function rowArt(w: number, h: number, o: { lamp: Lamp; coordinate: string; headerPx: number; cancelled?: boolean; engaged?: boolean }): string {
  const lamp: Lamp = o.cancelled ? 'bypass' : o.lamp
  let body = '<rect width="' + r(w) + '" height="' + r(h) + '" fill="' + V('bg') + '"/>'
  body += '<rect width="' + r(w) + '" height="' + o.headerPx + '" fill="' + V('card') + '"/>'
  body += grid(LEAD_PX, w, 0, o.headerPx, 0.6)
  body += '<line x1="0" y1="0.5" x2="' + r(w) + '" y2="0.5" stroke="' + V('border') + '"' + (o.cancelled ? ' stroke-dasharray="3 3"' : '') + '/>'
  body += '<line x1="0" y1="' + (o.headerPx + 0.5) + '" x2="' + r(w) + '" y2="' + (o.headerPx + 0.5) + '" stroke="' + V('border') + '" stroke-opacity=".7"/>'
  body += '<rect width="' + RAIL + '" height="' + r(h) + '" fill="' + railInk(lamp) + '"/>'
  const mid = Math.round(o.headerPx / 2)
  body += lampAt(lamp, RAIL + 5, mid - 2)
  body += type(o.coordinate, RAIL + 5 + LAMP + 8, mid + 4.5, 12, o.engaged ? V('accent') : V('muted'), 600, 'start', 2)
  return bsvg(w, h, body, BLINK)
}

// ---- Cells -------------------------------------------------------------------------------------

export type Made = { source: string; cells: number; width: number }

/** A monochrome type code cell: the kind in mono caps, text ink and a 1px rule, on the ground. */
export function codeArt(code: string, o: { cancelled?: boolean } = {}): Made {
  const text = caps(code)
  const width = Math.round(monoPx(text, 10.5, 1) + 14)
  const cells = cellsOf(width)
  const body =
    '<rect x="0.5" y="0.5" width="' + (width - 1) + '" height="' + (CODE - 1) + '" fill="' + V('bg') + '" stroke="' + (o.cancelled ? V('muted') : V('text')) + '"' + (o.cancelled ? ' stroke-dasharray="1 2"' : '') + '/>' +
    type(text, width / 2, CODE / 2 + 3.8, 10.5, o.cancelled ? V('muted') : V('text'), 700, 'middle', 1)
  return { source: bsvg(width, CODE, body), cells, width }
}

export type Ink = 'text' | 'muted' | 'accent' | 'accent2' | 'success' | 'warning' | 'danger'

/**
 * A boxed readout: the authoritative figure, bold mono in a sunken cell with a 1px rule. `edge`
 * accent while engaged; dashed when cancelled. `widthPx` holds a slot wider than the figure.
 */
export function readoutArt(text: string, o: { ink?: Ink; edge?: 'border' | 'accent' | 'dashed'; widthPx?: number; marker?: boolean } = {}): Made {
  const size = 12
  const shown = o.marker ? '> ' + text : text
  const width = Math.max(o.widthPx ?? 0, Math.round(monoPx(shown, size) + 14))
  const cells = cellsOf(width)
  const w = cells * CELL_PX
  const body =
    '<rect x="0.5" y="0.5" width="' + r(w - 1) + '" height="' + (READOUT - 1) + '" fill="' + V('sunken') + '" stroke="' + (o.edge === 'accent' ? V('accent') : V('border')) + '"' + (o.edge === 'dashed' ? ' stroke-dasharray="3 3"' : '') + '/>' +
    type(elide(shown, w - 12, size), w / 2, READOUT / 2 + 4.3, size, V(o.ink ?? 'text'), 700, 'middle')
  return { source: bsvg(w, READOUT, body), cells, width: w }
}

/** A caption: a name in muted mono caps, no cell of its own, beside a readout or a control. */
export function captionArt(text: string, o: { ink?: Ink } = {}): Made {
  const shown = caps(text)
  const width = Math.round(monoPx(shown, 10.5, 1) + 4)
  const cells = cellsOf(width)
  return { source: bsvg(cells * CELL_PX, READOUT, type(shown, 2, READOUT / 2 + 3.8, 10.5, V(o.ink ?? 'muted'), 600, 'start', 1)), cells, width: cells * CELL_PX }
}

/** The board line's marker and sunken strip, `w` px wide and `h` tall: host Text is laid over it after `> `. */
export function scanArt(w: number, h: number, o: { edge?: 'border' | 'accent' } = {}): string {
  return bsvg(w, h,
    '<rect x="0.5" y="0.5" width="' + r(w - 1) + '" height="' + r(h - 1) + '" fill="' + V('sunken') + '" stroke="' + (o.edge === 'accent' ? V('accent') : V('border')) + '"/>' +
    type('>', 8, h / 2 + 4.3, 12, V('muted'), 700))
}

/** Cells the scan line's marker takes before the host Text starts. */
export const SCAN_LEAD = 3

/**
 * A power cell, 36 × 22: engaged, the accent's LED fill with the power glyph in on-accent ink; off,
 * a 1px rule on the ground with the glyph in muted ink; busy blinks.
 */
export function powerArt(on: boolean, busy = false): string {
  const w = 36
  const h = 22
  const glyph = (ink: string) => '<g class="aa" fill="none" stroke="' + ink + '" stroke-width="1.6" stroke-linecap="round"><path d="M14.2 7.2A6 6 0 1 0 21.8 7.2"/><path d="M18 4v6"/></g>'
  const body = on
    ? '<rect class="' + (busy ? 'bl' : '') + '" width="' + w + '" height="' + h + '" fill="' + V('accent') + '"/>' + glyph(V('onAccent')) + '<rect x="27" y="3" width="5" height="5" fill="' + V('onAccent') + '"/>'
    : '<rect x="0.5" y="0.5" width="' + (w - 1) + '" height="' + (h - 1) + '" fill="' + V('bg') + '" stroke="' + V('border') + '"/>' + glyph(V('muted')) + '<rect x="27.5" y="3.5" width="4" height="4" fill="none" stroke="' + V('muted') + '"/>'
  return bsvg(w, h, body, BLINK)
}

/** Each port's cells for a strip of `labels`: mono caps with air either side, at least five cells. */
export function portCells(labels: readonly string[]): number[] {
  return labels.map(label => Math.max(5, cellsOf(monoPx(caps(label), 10.5, 0.5) + 20)))
}

/**
 * A port strip (their segmented control): ports in one sunken strip divided by 1px rules, a bus
 * lane along the bottom, the engaged port a block of the accent with its name in ground ink, its
 * footprint on the lane and a 1px drop plugging it in; the rest named in muted caps. `chosen` −1
 * engages none; a cancelled strip keeps every port, dashed, with a hollow block.
 */
export function portsArt(labels: readonly string[], cells: readonly number[], chosen: number, o: { cancelled?: boolean } = {}): string {
  const h = CONTROL
  const w = cells.reduce((n, c) => n + c, 0) * CELL_PX
  const laneY = h - 4
  const top = 2
  const bottom = laneY - 2
  let x = 0
  const starts = cells.map(c => {
    const at = x
    x += c * CELL_PX
    return at
  })
  let body = '<rect width="' + r(w) + '" height="' + h + '" fill="' + V('sunken') + '"/>'
  body += '<g stroke="' + V('border') + '">'
  for (let i = 1; i < labels.length; i++) body += '<line x1="' + r(Math.round(starts[i]!) + 0.5) + '" y1="1" x2="' + r(Math.round(starts[i]!) + 0.5) + '" y2="' + (laneY + 2) + '"/>'
  body += '<line x1="1" y1="' + (laneY + 0.5) + '" x2="' + r(w - 1) + '" y2="' + (laneY + 0.5) + '"/></g>'
  const live = chosen >= 0 && chosen < labels.length
  if (live) {
    const left = Math.round(starts[chosen]!) + 2
    const right = Math.round(starts[chosen]! + cells[chosen]! * CELL_PX) - 2
    if (o.cancelled) body += '<rect x="' + (left + 0.5) + '" y="' + (top + 0.5) + '" width="' + (right - left - 1) + '" height="' + (bottom - top - 1) + '" fill="none" stroke="' + V('muted') + '"/>'
    else body += '<rect x="' + left + '" y="' + top + '" width="' + (right - left) + '" height="' + (bottom - top) + '" fill="' + V('accent') + '"/>'
    const cx = Math.round((left + right) / 2) + 0.5
    const patch = o.cancelled ? V('muted') : V('accent')
    body += '<line x1="' + cx + '" y1="' + bottom + '" x2="' + cx + '" y2="' + laneY + '" stroke="' + patch + '"/>'
    body += o.cancelled
      ? '<line x1="' + left + '" y1="' + (laneY + 0.5) + '" x2="' + right + '" y2="' + (laneY + 0.5) + '" stroke="' + patch + '"/>'
      : '<rect x="' + left + '" y="' + laneY + '" width="' + (right - left) + '" height="2" fill="' + patch + '"/>'
  }
  labels.forEach((label, i) => {
    const lit = live && i === chosen && !o.cancelled
    const cx = starts[i]! + (cells[i]! * CELL_PX) / 2
    body += type(elide(caps(label), cells[i]! * CELL_PX - 10, 10.5, 0.5), cx, (top + bottom) / 2 + 3.8, 10.5, lit ? V('bg') : V('muted'), 600, 'middle', 0.5)
  })
  body += '<rect x="0.5" y="0.5" width="' + r(w - 1) + '" height="' + (h - 1) + '" fill="none" stroke="' + V('border') + '"' + (o.cancelled ? ' stroke-dasharray="3 3"' : '') + '/>'
  return bsvg(w, h, body)
}

/**
 * A bipolar LED strip for the lean: `count` stops, the middle a gap with a detent tick, lit from the
 * middle outward, cut (left) in accent2, boost (right) in the accent, the ghost cells always
 * visible in muted ink. Each stop `cellsPerStop` cells wide; the chosen stop carries its tick.
 */
export function ledStripArt(count: number, cellsPerStop: number, chosen: number): string {
  const part = cellsPerStop * CELL_PX
  const w = count * part
  const h = READOUT
  const mid = Math.floor(count / 2)
  const cellW = Math.max(6, Math.round(part - 6))
  let body = ''
  for (let i = 0; i < count; i++) {
    const x = Math.round(part * i + (part - cellW) / 2)
    const lit = i !== mid && ((i < mid && i >= chosen) || (i > mid && i <= chosen))
    const ink = i < mid ? V('accent2') : V('accent')
    if (i === mid) {
      body += '<line x1="' + (x + Math.round(cellW / 2) + 0.5) + '" y1="2" x2="' + (x + Math.round(cellW / 2) + 0.5) + '" y2="6" stroke="' + V('text') + '"/>'
      body += '<rect x="' + (x + 0.5) + '" y="8.5" width="' + (cellW - 1) + '" height="' + (h - 11) + '" fill="none" stroke="' + V('muted') + '" stroke-opacity=".5"/>'
    } else {
      body += lit
        ? '<rect x="' + x + '" y="8" width="' + cellW + '" height="' + (h - 10) + '" fill="' + ink + '"/>'
        : '<rect x="' + (x + 0.5) + '" y="8.5" width="' + (cellW - 1) + '" height="' + (h - 11) + '" fill="none" stroke="' + V('muted') + '" stroke-opacity=".5"/>'
    }
    if (i === chosen) body += '<rect x="' + (x + Math.round(cellW / 2) - 1) + '" y="' + (h - 3) + '" width="3" height="3" fill="' + V('text') + '"/>'
  }
  return bsvg(w, h, body)
}

/**
 * The effort as five LED cells rising shallow to deep, `lit` of them on: the accent when Auto
 * chose, text ink when the person did, muted when Auto is off, and a stepped blink across all
 * five while the judge decides.
 */
export function meterArt(lit: number, look: 'auto' | 'manual' | 'quiet' | 'deciding'): string {
  const w = 24
  const h = 16
  let body = ''
  for (let i = 0; i < 5; i++) {
    const bh = 6 + i * 2.5
    const on = look === 'deciding' || i < lit
    const ink = !on ? V('border') : look === 'manual' ? V('text') : look === 'quiet' ? V('muted') : V('accent')
    body += '<rect' + (look === 'deciding' ? ' class="wa" style="animation-delay:' + r(i * 0.12) + 's"' : '') + ' x="' + (i * 5) + '" y="' + r(h - bh) + '" width="4" height="' + r(bh) + '" fill="' + ink + '"/>'
  }
  return bsvg(w, h, body, '.wa{animation:wa 1.2s steps(2) infinite}@keyframes wa{50%{opacity:.25}}')
}

/**
 * A plate: the one thing to press is an EXECUTE plate, chamfered top-left and bottom-right, the
 * accent filled with a `>` chevron and the label in ground ink; a quiet action is a 1px-rule cell
 * on the ground in text ink; a cancelled one keeps its place, dashed and muted.
 */
export function plateArt(label: string, kind: 'execute' | 'quiet' | 'cancelled'): Made {
  const text = caps(label)
  const size = 10.5
  const chevron = kind === 'execute' ? monoPx('> ', size, 0.5) : 0
  const width = Math.round(monoPx(text, size, 0.5) + chevron + 22)
  const cells = cellsOf(width)
  const w = cells * CELL_PX
  const h = CONTROL
  let body: string
  if (kind === 'execute') {
    const c = 6
    body = '<path class="aa" d="M' + c + ' 1H' + r(w - 1) + 'V' + (h - 1 - c) + 'L' + r(w - 1 - c) + ' ' + (h - 1) + 'H1V' + (1 + c) + 'Z" fill="' + V('accent') + '"/>' +
      type('> ' + text, w / 2, h / 2 + 3.8, size, V('onAccent'), 700, 'middle', 0.5)
  } else {
    body = '<rect x="0.5" y="0.5" width="' + r(w - 1) + '" height="' + (h - 1) + '" fill="' + V('bg') + '" stroke="' + (kind === 'cancelled' ? V('muted') : V('border')) + '"' + (kind === 'cancelled' ? ' stroke-dasharray="3 3"' : '') + '/>' +
      type(text, w / 2, h / 2 + 3.8, size, kind === 'cancelled' ? V('muted') : V('text'), 600, 'middle', 0.5)
  }
  return { source: bsvg(w, h, body), cells, width: w }
}

/** The way out: a 22 px cell with a `×` in text ink; addressed, the accent's rule and ink. */
export function closeArt(lit = false): string {
  const ink = lit ? V('accent') : V('text')
  return bsvg(22, 22,
    '<rect x="0.5" y="0.5" width="21" height="21" fill="' + V('bg') + '" stroke="' + (lit ? V('accent') : V('border')) + '"/>' +
    '<g class="aa" stroke="' + ink + '" stroke-width="1.5"><path d="M7 7l8 8M15 7l-8 8"/></g>')
}

/**
 * A control cell on the band, `cells` wide and CONTROL tall: a 1px rule on the ground, one of the
 * band's line icons in text ink (muted while off), a lamp in the top-left corner when `lamp` says
 * the control is on, and a count in a readout cell when there is one. The word, when the band has
 * room, is host Text beside it.
 */
export function cellArt(icon: Icon, cells: number, o: { on?: boolean; lamp?: Lamp; count?: string } = {}): string {
  const w = cells * CELL_PX
  const h = CONTROL
  const ink = o.on ? V('text') : V('muted')
  let body = '<rect x="0.5" y="0.5" width="' + r(w - 1) + '" height="' + (h - 1) + '" fill="' + V('bg') + '" stroke="' + V('border') + '"/>'
  const ix = o.count ? 6 : (w - 16) / 2
  body += '<g class="aa" transform="translate(' + r(ix) + ' ' + ((h - 16) / 2) + ')" fill="none" stroke="' + ink + '" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round">' + ICON[icon] + '</g>'
  if (o.lamp && o.lamp !== 'off') body += lampAt(o.lamp, 2, 2, 4)
  if (o.count) body += type(o.count, w - 7, h / 2 + 4.3, 12, V('accent'), 700, 'end')
  return bsvg(w, h, body, BLINK)
}

/** The setup's steps as coordinate cells: done in text ink, the current one engaged, the rest dotted. */
export function stepsArt(step: number, total: number): Made {
  const cellW = 22
  const gap = 4
  const w = total * cellW + (total - 1) * gap
  let body = ''
  for (let i = 1; i <= total; i++) {
    const x = (i - 1) * (cellW + gap)
    const label = 'S' + i
    if (i === step) body += '<rect x="' + x + '" y="0" width="' + cellW + '" height="' + CODE + '" fill="' + V('accent') + '"/>' + type(label, x + cellW / 2, CODE / 2 + 3.8, 10.5, V('onAccent'), 700, 'middle', 1)
    else if (i < step) body += '<rect x="' + (x + 0.5) + '" y="0.5" width="' + (cellW - 1) + '" height="' + (CODE - 1) + '" fill="' + V('bg') + '" stroke="' + V('text') + '"/>' + type(label, x + cellW / 2, CODE / 2 + 3.8, 10.5, V('text'), 700, 'middle', 1)
    else body += '<rect x="' + (x + 0.5) + '" y="0.5" width="' + (cellW - 1) + '" height="' + (CODE - 1) + '" fill="none" stroke="' + V('muted') + '" stroke-dasharray="1 2"/>' + type(label, x + cellW / 2, CODE / 2 + 3.8, 10.5, V('muted'), 600, 'middle', 1)
  }
  return { source: bsvg(w, CODE, body), cells: cellsOf(w), width: w }
}

/** A 1px rule across `w` px in a `h` px strip: between a card's bands. */
export function ruleArt(w: number, h = 1): string {
  return bsvg(w, h, '<line x1="0" y1="0.5" x2="' + r(w) + '" y2="0.5" stroke="' + V('border') + '"/>')
}

/** The hover tints of a board cell on either face: the accent at the crosspoint's strengths (row, column). */
export const CROSSPOINT = { row: 'rgba(34,211,238,0.07)', column: 'rgba(34,211,238,0.18)' }
