// The pictures of the desktop drawings: the backdrop every band, card and panel sits on, and the
// small drawn controls (switch, pill, segment, ring, meter, icons). Pure: SVG strings only.
//
// Why pictures (host facts, see parts.tsx for the rest):
// - The host styles text and native buttons its own way (its primary button is the app's clay
//   orange, which fought the violet of ClaudeRipple). A plain Svg image is ours to the pixel, keeps
//   its CSS motion, does not blink on a redraw, and follows the app's light or dark theme through
//   `prefers-color-scheme` inside it. So the look is drawn here and a blank native button is laid
//   over each drawn control to take the press (kit.tsx).
// - The desktop sets its text at 13 px with 19 px lines; a cell is 1ch, 7.917 px (an Effortless
//   render of the band, 2026-10). Drawn controls are sized in cells and converted with CELL_PX, so
//   a picture and the text beside it share one grid.
// - Every motion loop starts on a pose that reads as "going on" (rings already spread, flakes
//   already falling: negative delays), because a redraw starts the picture over.

import type { Appearance } from './theme'
import { chOf } from './theme'

/** One desktop cell (1ch of the host's 13 px sans), px. */
export const CELL_PX = 7.917
/** One desktop row (the host's line height), px. */
export const ROW_PX = 19

/** The washes a backdrop can take, by what it is about. */
export type Tint = 'violet' | 'ice' | 'amber' | 'ember' | 'red' | 'green'

const TINT: Record<Tint, { dark: string; light: string }> = {
  violet: { dark: '#9483ff', light: '#6a56d6' },
  ice: { dark: '#7cc8ff', light: '#2a86c9' },
  amber: { dark: '#f2b23a', light: '#b8790a' },
  ember: { dark: '#ff8a4c', light: '#d4561c' },
  red: { dark: '#ff6b6b', light: '#c73434' },
  green: { dark: '#4ad08a', light: '#1a8a4a' },
}

/** Mid tones of the tints for native Text, which the host draws on its own background. */
export const TINT_TEXT: Record<Tint, { auto: string; dark: string; light: string }> = {
  violet: { auto: '#8170e8', dark: '#a594f5', light: '#6a56d6' },
  ice: { auto: '#3d9ad8', dark: '#8fd0ff', light: '#2a7fbf' },
  amber: { auto: '#c98a12', dark: '#f2b23a', light: '#a86a07' },
  ember: { auto: '#e2672e', dark: '#ff9a63', light: '#c4501a' },
  red: { auto: '#dc4a4a', dark: '#ff7b7b', light: '#c2362f' },
  green: { auto: '#22a35e', dark: '#5bd896', light: '#17803f' },
}

export function tintText(tint: Tint, appearance: Appearance): string {
  return TINT_TEXT[tint][appearance]
}

/** Light and dark values of the art's colours; `auto` switches on the frame's colour scheme. */
type Shade = { base: string; ink: string; muted: string; faint: string; line: string; grain: string; knob: string; pillInk: string }
const DARK: Shade = { base: '#16151d', ink: '#ecebf2', muted: '#a19fae', faint: 'rgba(236,235,242,0.12)', line: 'rgba(236,235,242,0.16)', grain: 'rgba(255,255,255,0.07)', knob: '#ffffff', pillInk: '#16151d' }
const LIGHT: Shade = { base: '#fcfbff', ink: '#1d1b26', muted: '#64616f', faint: 'rgba(29,27,38,0.10)', line: 'rgba(29,27,38,0.16)', grain: 'rgba(40,30,90,0.05)', knob: '#ffffff', pillInk: '#ffffff' }

function varsOf(shade: Shade, tint: string): string {
  return '--base:' + shade.base + ';--ink:' + shade.ink + ';--muted:' + shade.muted + ';--faint:' + shade.faint + ';--line:' + shade.line + ';--grain:' + shade.grain + ';--knob:' + shade.knob + ';--pill-ink:' + shade.pillInk + ';--tint:' + tint
}

const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Apple SD Gothic Neo','Segoe UI',system-ui,sans-serif"

/** One SVG document whose colours follow `appearance` (auto: the frame's prefers-color-scheme). */
export function doc(width: number, height: number, appearance: Appearance, tint: Tint, body: string, css = '', extra = ''): string {
  const t = TINT[tint]
  const vars =
    appearance === 'dark'
      ? 'svg{' + varsOf(DARK, t.dark) + '}'
      : appearance === 'light'
        ? 'svg{' + varsOf(LIGHT, t.light) + '}'
        : 'svg{' + varsOf(LIGHT, t.light) + '}@media (prefers-color-scheme:dark){svg{' + varsOf(DARK, t.dark) + '}}'
  const base = ':root{color-scheme:light dark}svg{display:block;background:transparent}text{font-family:' + FONT + ';font-variant-numeric:tabular-nums}' +
    '@media (prefers-reduced-motion:reduce){*{animation:none!important}}'
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + r(width) + '" height="' + r(height) + '" viewBox="0 0 ' + r(width) + ' ' + r(height) + '"' + extra + '><style>' + vars + base + css + '</style>' + body + '</svg>'
}

const r = (x: number): string => String(Math.round(x * 100) / 100)

/** Pixels a run of host text takes, from its estimate in ch. */
export function textPx(text: string): number {
  return chOf(text) * CELL_PX
}

// ---- Backdrop ------------------------------------------------------------------------------------

/**
 * What moves in a backdrop: ripples spreading from the right end (the brand's own motion), their
 * pace, a sheen sweeping across (something is being worked out), or the weather of an alert.
 */
export type Motion = {
  ripples?: 'slow' | 'calm' | 'busy'
  sheen?: boolean
  weather?: 'snow' | 'bubbles' | 'embers' | 'sparkles' | 'static'
  /** A large tick at the right, drawn in (done). */
  tick?: boolean
  /** The wash's strength, 0..1 (Auto off dims the band). */
  strength?: number
}

const RIPPLE_PACE = { slow: 11, calm: 7, busy: 3.4 }

/**
 * The backdrop of a band or card, `width` × `height` px, anchored at its right end: a base of the
 * theme's own surface, the tint washing in from the right, grain, and the motion.
 */
export function backdrop(width: number, height: number, appearance: Appearance, tint: Tint, motion: Motion = {}): string {
  const w = Math.max(80, Math.round(width))
  const h = Math.round(height)
  const k = motion.strength ?? 1
  const cx = w - 34
  const cy = h / 2
  let css = ''
  let body =
    '<defs>' +
    '<linearGradient id="wash" x1="0" x2="1"><stop offset="0" stop-color="var(--tint)" stop-opacity="0"/><stop offset=".5" stop-color="var(--tint)" stop-opacity="' + r(0.05 * k) + '"/><stop offset="1" stop-color="var(--tint)" stop-opacity="' + r(0.2 * k) + '"/></linearGradient>' +
    '<radialGradient id="glow" cx="' + cx + '" cy="' + r(cy) + '" r="' + r(h * 2.4) + '" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="var(--tint)" stop-opacity="' + r(0.3 * k) + '"/><stop offset="1" stop-color="var(--tint)" stop-opacity="0"/></radialGradient>' +
    '<linearGradient id="fade" x1="0" x2="1"><stop offset=".35" stop-color="#fff" stop-opacity="0"/><stop offset=".75" stop-color="#fff" stop-opacity="1"/></linearGradient>' +
    '<mask id="right"><rect width="' + w + '" height="' + h + '" fill="url(#fade)"/></mask>' +
    '<pattern id="grain" width="3" height="3" patternUnits="userSpaceOnUse"><rect width=".8" height=".8" fill="var(--grain)"/><rect x="1.6" y="1.9" width=".7" height=".7" fill="var(--grain)"/></pattern>' +
    '</defs>' +
    '<rect width="' + w + '" height="' + h + '" fill="var(--base)"/>' +
    '<rect width="' + w + '" height="' + h + '" fill="url(#wash)"/>' +
    '<rect class="breathe" width="' + w + '" height="' + h + '" fill="url(#glow)"/>' +
    '<g mask="url(#right)"><rect width="' + w + '" height="' + h + '" fill="url(#grain)"/></g>'
  css += '.breathe{animation:breathe 6s ease-in-out infinite}@keyframes breathe{0%,100%{opacity:.8}50%{opacity:1}}'
  if (motion.ripples) {
    const pace = RIPPLE_PACE[motion.ripples]
    const count = motion.ripples === 'busy' ? 4 : 3
    const radius = h * 1.9
    body += '<g mask="url(#right)" fill="none" stroke="var(--tint)">'
    for (let i = 0; i < count; i++) {
      body += '<circle class="rip" cx="' + cx + '" cy="' + r(cy) + '" r="' + r(radius) + '" stroke-width="' + r(1.4 / (radius / 20)) + '" style="animation-delay:-' + r((pace / count) * (i + 0.5)) + 's"/>'
    }
    body += '</g>'
    css +=
      '.rip{transform-box:fill-box;transform-origin:center;opacity:0;animation:rip ' + pace + 's cubic-bezier(.2,.6,.35,1) infinite}' +
      '@keyframes rip{0%{transform:scale(.06);opacity:0}12%{opacity:' + r(0.75 * k) + '}100%{transform:scale(1);opacity:0}}'
  }
  if (motion.sheen) {
    body +=
      '<defs><linearGradient id="sheen" x1="0" x2="1"><stop offset="0" stop-color="var(--tint)" stop-opacity="0"/><stop offset=".5" stop-color="var(--tint)" stop-opacity=".22"/><stop offset="1" stop-color="var(--tint)" stop-opacity="0"/></linearGradient></defs>' +
      '<rect class="sheen" x="-160" width="160" height="' + h + '" fill="url(#sheen)"/>'
    css += '.sheen{animation:sheen 2.6s ease-in-out infinite;animation-delay:-.4s}@keyframes sheen{0%{transform:translateX(0)}100%{transform:translateX(' + (w + 160) + 'px)}}'
  }
  if (motion.weather) {
    const made = weather(motion.weather, w, h)
    body += '<g mask="url(#right)">' + made.body + '</g>'
    css += made.css
  }
  if (motion.tick) {
    const s = h * 0.9
    const x = w - s * 1.6
    const y = (h - s) / 2
    body +=
      '<path class="tick" d="M' + r(x) + ' ' + r(y + s * 0.55) + 'L' + r(x + s * 0.38) + ' ' + r(y + s * 0.9) + 'L' + r(x + s * 1.1) + ' ' + r(y + s * 0.08) + '" fill="none" stroke="var(--tint)" stroke-opacity=".32" stroke-width="' + r(s * 0.16) + '" stroke-linecap="round" stroke-linejoin="round" pathLength="1"/>'
    css += '.tick{stroke-dasharray:1;stroke-dashoffset:1;animation:tick .9s .15s cubic-bezier(.3,.7,.3,1) forwards}@keyframes tick{to{stroke-dashoffset:0}}'
  }
  return doc(w, h, appearance, tint, body, css, ' preserveAspectRatio="xMaxYMid slice"')
}

/** A plain plate of the backdrop's base, behind words laid over other words (a hover tip). */
export function plate(width: number, height: number, appearance: Appearance): string {
  return doc(width, height, appearance, 'violet', '<rect width="' + r(width) + '" height="' + r(height) + '" fill="var(--base)"/>')
}

/** A pseudo-random but fixed sequence, so one state always draws the same picture. */
function seq(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }
}

function weather(kind: NonNullable<Motion['weather']>, w: number, h: number): { body: string; css: string } {
  const rnd = seq(kind.length * 7 + 3)
  let body = ''
  let css = ''
  const from = w * 0.45
  if (kind === 'snow') {
    for (let i = 0; i < 14; i++) {
      const x = from + rnd() * (w - from)
      const size = 1.6 + rnd() * 2.6
      const dur = 5 + rnd() * 5
      const flake = rnd() > 0.55
        ? '<path d="M0 -' + r(size) + 'V' + r(size) + 'M-' + r(size * 0.87) + ' -' + r(size / 2) + 'L' + r(size * 0.87) + ' ' + r(size / 2) + 'M-' + r(size * 0.87) + ' ' + r(size / 2) + 'L' + r(size * 0.87) + ' -' + r(size / 2) + '" stroke="var(--tint)" stroke-width=".7" stroke-linecap="round"/>'
        : '<circle r="' + r(size * 0.45) + '" fill="var(--tint)"/>'
      body += '<g transform="translate(' + r(x) + ' 0)"><g class="fall" style="animation-duration:' + r(dur) + 's;animation-delay:-' + r(rnd() * dur) + 's;opacity:' + r(0.35 + rnd() * 0.45) + '">' + flake + '</g></g>'
    }
    css += '.fall{animation:fall linear infinite}@keyframes fall{0%{transform:translate(0,-8px) rotate(0)}50%{transform:translate(5px,' + r(h / 2) + 'px) rotate(90deg)}100%{transform:translate(-2px,' + r(h + 8) + 'px) rotate(180deg)}}'
  } else if (kind === 'bubbles') {
    for (let i = 0; i < 12; i++) {
      const x = from + rnd() * (w - from)
      const size = 1.2 + rnd() * 3.2
      const dur = 4 + rnd() * 5
      body += '<g transform="translate(' + r(x) + ' 0)"><circle class="rise" r="' + r(size) + '" fill="none" stroke="var(--tint)" stroke-width=".8" style="animation-duration:' + r(dur) + 's;animation-delay:-' + r(rnd() * dur) + 's"/></g>'
    }
    css += '.rise{animation:rise ease-in infinite;opacity:0}@keyframes rise{0%{transform:translate(0,' + r(h + 6) + 'px);opacity:0}20%{opacity:.6}100%{transform:translate(4px,-6px);opacity:0}}'
  } else if (kind === 'embers') {
    for (let i = 0; i < 16; i++) {
      const x = from + rnd() * (w - from)
      const size = 0.8 + rnd() * 1.6
      const dur = 2.6 + rnd() * 3
      body += '<g transform="translate(' + r(x) + ' 0)"><circle class="ember" r="' + r(size) + '" fill="var(--tint)" style="animation-duration:' + r(dur) + 's;animation-delay:-' + r(rnd() * dur) + 's"/></g>'
    }
    css += '.ember{animation:ember ease-out infinite;opacity:0}@keyframes ember{0%{transform:translate(0,' + r(h + 4) + 'px);opacity:0}25%{opacity:.9}100%{transform:translate(-6px,-4px);opacity:0}}'
  } else if (kind === 'sparkles') {
    for (let i = 0; i < 9; i++) {
      const x = from + rnd() * (w - from - 10)
      const y = 4 + rnd() * (h - 8)
      const size = 2 + rnd() * 3.2
      const dur = 2.4 + rnd() * 2.4
      body += '<g transform="translate(' + r(x) + ' ' + r(y) + ')"><path class="spark" d="M0 -' + r(size) + 'Q0 0 ' + r(size) + ' 0Q0 0 0 ' + r(size) + 'Q0 0 -' + r(size) + ' 0Q0 0 0 -' + r(size) + 'Z" fill="var(--tint)" style="animation-duration:' + r(dur) + 's;animation-delay:-' + r(rnd() * dur) + 's"/></g>'
    }
    css += '.spark{transform-box:fill-box;transform-origin:center;animation:spark ease-in-out infinite;opacity:0}@keyframes spark{0%,100%{transform:scale(.2) rotate(0);opacity:0}50%{transform:scale(1) rotate(45deg);opacity:.85}}'
  } else {
    for (let y = 1; y < h; y += 3) body += '<rect x="' + r(from) + '" y="' + y + '" width="' + r(w - from) + '" height=".6" fill="var(--tint)" opacity=".12"/>'
    body += '<rect class="scan" x="' + r(from) + '" width="' + r(w - from) + '" height="5" fill="var(--tint)" opacity=".16"/>'
    css += '.scan{animation:scan 3.2s linear infinite}@keyframes scan{0%{transform:translateY(-6px)}100%{transform:translateY(' + (h + 6) + 'px)}}'
  }
  return { body, css }
}

// ---- Controls ------------------------------------------------------------------------------------

/** A switch, 30 × 17 px: the knob right on a tinted track when on, left on a faint one when off. */
export function switchArt(on: boolean, appearance: Appearance, busy = false): string {
  const w = 30
  const h = 17
  const body =
    '<defs><linearGradient id="on" x1="0" x2="1"><stop offset="0" stop-color="var(--tint)" stop-opacity=".85"/><stop offset="1" stop-color="var(--tint)"/></linearGradient></defs>' +
    '<rect x=".5" y=".5" width="' + (w - 1) + '" height="' + (h - 1) + '" rx="' + (h / 2 - 0.5) + '" fill="' + (on ? 'url(#on)' : 'var(--faint)') + '" stroke="' + (on ? 'none' : 'var(--line)') + '"/>' +
    '<circle class="' + (busy ? 'pulse' : '') + '" cx="' + (on ? w - h / 2 : h / 2) + '" cy="' + h / 2 + '" r="' + (h / 2 - 2.5) + '" fill="' + (on ? 'var(--knob)' : 'var(--muted)') + '"/>'
  return doc(w, h, appearance, 'violet', body, '.pulse{animation:pulse 1.4s ease-in-out infinite}@keyframes pulse{50%{opacity:.55}}')
}
export const SWITCH_W = 30
export const SWITCH_H = 17

/** How a pill is drawn: filled (the one thing to press), soft (lit, not urgent), or outline. */
export type PillLook = 'fill' | 'soft' | 'outline' | 'ghost'

/**
 * A pill with its label drawn in: the main action of a card, a lit control. Its width follows the
 * label; returns the source and that width.
 */
export function pillArt(label: string, look: PillLook, appearance: Appearance, tint: Tint = 'violet', height = 24, glow = 0): { source: string; width: number } {
  const size = 12
  const pad = 12
  const textW = textPx(label) * (size / 13)
  const halo = glow > 0 ? 8 : 0
  const w = Math.ceil(textW + pad * 2) + halo * 2
  const h = height + halo * 2
  const x = halo
  const y = halo
  const pw = w - halo * 2
  const fill = look === 'fill' ? 'url(#g)' : look === 'soft' ? 'var(--tint)' : 'transparent'
  const fillOpacity = look === 'soft' ? 0.16 : 1
  const stroke = look === 'outline' ? 'var(--line)' : look === 'soft' ? 'var(--tint)' : 'none'
  const ink = look === 'fill' ? 'var(--pill-ink)' : look === 'soft' ? 'var(--tint)' : 'var(--ink)'
  let body =
    '<defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="var(--tint)" stop-opacity=".88"/><stop offset="1" stop-color="var(--tint)"/></linearGradient>' +
    '<filter id="blur" x="-50%" y="-80%" width="200%" height="260%"><feGaussianBlur stdDeviation="4"/></filter></defs>'
  if (glow > 0) body += '<rect class="glow" x="' + (x + 2) + '" y="' + (y + 2) + '" width="' + (pw - 4) + '" height="' + (height - 4) + '" rx="' + height / 2 + '" fill="var(--tint)" opacity="' + r(0.35 + 0.4 * glow) + '" filter="url(#blur)"/>'
  body +=
    '<rect x="' + (x + 0.5) + '" y="' + (y + 0.5) + '" width="' + (pw - 1) + '" height="' + (height - 1) + '" rx="' + (height / 2 - 0.5) + '" fill="' + fill + '" fill-opacity="' + fillOpacity + '" stroke="' + stroke + '" stroke-opacity="' + (look === 'soft' ? 0.5 : 1) + '"/>' +
    '<text x="' + r(w / 2) + '" y="' + r(y + height / 2 + size * 0.36) + '" text-anchor="middle" font-size="' + size + '" font-weight="' + (look === 'ghost' ? 500 : 600) + '" fill="' + ink + '">' + esc(label) + '</text>'
  const css = glow > 0 ? '.glow{animation:glow ' + r(3.4 - 1.8 * glow) + 's ease-in-out infinite}@keyframes glow{0%,100%{opacity:' + r(0.25 + 0.3 * glow) + '}50%{opacity:' + r(0.5 + 0.45 * glow) + '}}' : ''
  return { source: doc(w, h, appearance, tint, body, css), width: w }
}

/** A segment of a segmented control, `width` × `height` px: lit (chosen) or quiet. */
export function segmentArt(width: number, height: number, lit: boolean, appearance: Appearance, tint: Tint = 'violet'): string {
  const body = lit
    ? '<rect x=".5" y=".5" width="' + r(width - 1) + '" height="' + r(height - 1) + '" rx="7" fill="var(--tint)" fill-opacity=".16" stroke="var(--tint)" stroke-opacity=".7"/>'
    : '<rect x=".5" y=".5" width="' + r(width - 1) + '" height="' + r(height - 1) + '" rx="7" fill="var(--faint)" fill-opacity=".5" stroke="var(--line)" stroke-opacity=".7"/>'
  return doc(width, height, appearance, tint, body)
}

/**
 * A stepped slider, `width` × 22 px: `count` stops on a track, the track filled up to the chosen
 * one and a knob on it. Stop i sits at the centre of the i-th of `count` equal parts.
 */
export function sliderArt(width: number, count: number, chosen: number, appearance: Appearance): string {
  const h = 22
  const part = width / count
  const at = (i: number) => part * (i + 0.5)
  const y = h / 2
  let body =
    '<defs><linearGradient id="fill" x1="0" x2="1"><stop offset="0" stop-color="var(--tint)" stop-opacity=".45"/><stop offset="1" stop-color="var(--tint)"/></linearGradient></defs>' +
    '<rect x="' + r(at(0)) + '" y="' + (y - 2) + '" width="' + r(at(count - 1) - at(0)) + '" height="4" rx="2" fill="var(--faint)"/>' +
    '<rect x="' + r(at(0)) + '" y="' + (y - 2) + '" width="' + r(at(chosen) - at(0)) + '" height="4" rx="2" fill="url(#fill)"/>'
  for (let i = 0; i < count; i++) body += '<circle cx="' + r(at(i)) + '" cy="' + y + '" r="2.6" fill="' + (i <= chosen ? 'var(--tint)' : 'var(--line)') + '"/>'
  body += '<circle cx="' + r(at(chosen)) + '" cy="' + y + '" r="7.5" fill="var(--tint)" fill-opacity=".22"/><circle cx="' + r(at(chosen)) + '" cy="' + y + '" r="5" fill="var(--knob)" stroke="var(--tint)" stroke-width="2"/>'
  return doc(width, h, appearance, 'violet', body)
}

/** The context ring, 16 px: the share filled, coloured by its tone. */
export function ringArt(percent: number, tint: Tint | 'ink', appearance: Appearance): string {
  const s = 16
  const rad = 6
  const c = 2 * Math.PI * rad
  const share = Math.max(0, Math.min(1, percent / 100))
  // Whole percents only: the same figure is the same picture.
  const dash = r(c * Math.round(share * 100) / 100)
  const stroke = tint === 'ink' ? 'var(--ink)' : 'var(--tint)'
  const body =
    '<circle cx="8" cy="8" r="' + rad + '" fill="none" stroke="var(--faint)" stroke-width="2.4"/>' +
    '<circle cx="8" cy="8" r="' + rad + '" fill="none" stroke="' + stroke + '" stroke-opacity="' + (tint === 'ink' ? 0.85 : 1) + '" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="' + dash + ' ' + r(c) + '" transform="rotate(-90 8 8)"/>'
  return doc(s, s, appearance, tint === 'ink' ? 'violet' : tint, body)
}

/**
 * The effort meter, 5 bars rising left to right, `lit` of them on (0 none): violet when Auto
 * chose it, ink when it is the person's, a wave across them while the judge is deciding.
 */
export function meterArt(lit: number, look: 'auto' | 'manual' | 'quiet' | 'deciding', appearance: Appearance): string {
  const w = 21
  const h = 14
  let body = ''
  for (let i = 0; i < 5; i++) {
    const bh = 4 + i * 2.5
    const on = look === 'deciding' || i < lit
    const fill = look === 'auto' || look === 'deciding' ? 'var(--tint)' : look === 'manual' ? 'var(--ink)' : 'var(--muted)'
    body += '<rect class="' + (look === 'deciding' ? 'wave' : '') + '" x="' + i * 4.3 + '" y="' + r(h - bh) + '" width="3" height="' + r(bh) + '" rx="1" fill="' + (on ? fill : 'var(--faint)') + '"' + (look === 'deciding' ? ' style="animation-delay:' + r(i * 0.12) + 's"' : '') + (on && look === 'quiet' ? ' opacity=".7"' : '') + '/>'
  }
  return doc(w, h, appearance, 'violet', body, '.wave{animation:wave 1.1s ease-in-out infinite;opacity:.3}@keyframes wave{0%,100%{opacity:.25}40%{opacity:1}}')
}
export const METER_W = 21
export const METER_H = 14

/** The cache clock, 15 px: the life left as a pie, coloured by its tone. */
export function clockArt(share: number, tint: Tint | 'muted', appearance: Appearance): string {
  const s = 15
  const c = 7.5
  const rad = 6
  const left = Math.max(0, Math.min(1, share))
  const fill = tint === 'muted' ? 'var(--muted)' : 'var(--tint)'
  let pie = ''
  if (left >= 0.999) pie = '<circle cx="' + c + '" cy="' + c + '" r="' + (rad - 1.6) + '" fill="' + fill + '"/>'
  else if (left > 0.001) {
    const a = 2 * Math.PI * Math.round(left * 12) / 12
    const x = c + (rad - 1.6) * Math.sin(a)
    const y = c - (rad - 1.6) * Math.cos(a)
    pie = '<path d="M' + c + ' ' + c + 'V' + r(c - (rad - 1.6)) + 'A' + r(rad - 1.6) + ' ' + r(rad - 1.6) + ' 0 ' + (a > Math.PI ? 1 : 0) + ' 1 ' + r(x) + ' ' + r(y) + 'Z" fill="' + fill + '"/>'
  }
  const body = '<circle cx="' + c + '" cy="' + c + '" r="' + rad + '" fill="none" stroke="' + fill + '" stroke-opacity=".7" stroke-width="1.3"/>' + pie
  return doc(s, s, appearance, tint === 'muted' ? 'violet' : tint, body)
}

/** Line icons, 15 px, in the muted ink or lit in the tint. */
export type Icon = 'gear' | 'agents' | 'flame' | 'log' | 'gauge' | 'judge' | 'layers' | 'open' | 'route' | 'handoff' | 'compact'

const ICON: Record<Icon, string> = {
  gear: '<circle cx="7.5" cy="7.5" r="2.2"/><path d="M7.5 1.6v1.7M7.5 11.7v1.7M1.6 7.5h1.7M11.7 7.5h1.7M3.3 3.3l1.2 1.2M10.5 10.5l1.2 1.2M3.3 11.7l1.2-1.2M10.5 4.5l1.2-1.2"/><circle cx="7.5" cy="7.5" r="4.6"/>',
  agents: '<circle cx="4.4" cy="4.6" r="2"/><circle cx="10.8" cy="4.6" r="2"/><path d="M1.4 12.6c.4-2.3 1.6-3.4 3-3.4s2.6 1.1 3 3.4M7.8 12.6c.4-2.3 1.6-3.4 3-3.4s2.6 1.1 3 3.4"/>',
  flame: '<path d="M7.6 13.4c2.6 0 4.2-1.8 4.2-4.1 0-2.6-2.2-3.9-2.6-6.7-1.6 1-2.4 2.6-2.3 4-.9-.4-1.4-1.3-1.5-2.1C4 5.6 3.4 7.1 3.4 9.3c0 2.3 1.6 4.1 4.2 4.1z"/>',
  log: '<path d="M2.2 3.6h10.6M2.2 7.5h10.6M2.2 11.4h6.4"/>',
  gauge: '<path d="M2 10.6a5.5 5.5 0 1 1 11 0"/><path d="M7.5 10.6l2.8-3.3"/><circle cx="7.5" cy="10.6" r=".9"/>',
  judge: '<path d="M7.5 1.8v11.4M3.2 13.2h8.6M2.2 4.2h10.6"/><path d="M4.2 4.2L2.2 8.6a2 2 0 0 0 4 0zM10.8 4.2l-2 4.4a2 2 0 0 0 4 0z"/>',
  layers: '<path d="M7.5 1.8l5.8 3-5.8 3-5.8-3zM1.7 7.6l5.8 3 5.8-3M1.7 10.4l5.8 3 5.8-3"/>',
  open: '<path d="M8.6 2.2h4.2v4.2M12.8 2.2L7 8M11 9.4v3.4H2.2V4h3.4"/>',
  route: '<path d="M2 7.5h9.4M8.4 4.2l3.3 3.3-3.3 3.3"/>',
  handoff: '<path d="M2.2 7.5h7.6M7 4.4l3.1 3.1L7 10.6M12.8 2.6v9.8"/>',
  compact: '<path d="M4.4 2.2l3.1 3.1 3.1-3.1M4.4 12.8l3.1-3.1 3.1 3.1M2.2 7.5h10.6"/>',
}

export function iconArt(icon: Icon, lit: boolean, appearance: Appearance, tint: Tint = 'violet'): string {
  const body = '<g fill="none" stroke="' + (lit ? 'var(--tint)' : 'var(--muted)') + '" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">' + ICON[icon] + '</g>'
  return doc(15, 15, appearance, tint, body)
}
export const ICON_PX = 15

/**
 * The agents icon with the live count in a disc on its shoulder, 24 × 16 px whatever the count
 * (no disc at 0), so the control never changes width.
 */
export function agentsArt(count: number, lit: boolean, appearance: Appearance): string {
  const icon = '<g transform="translate(0 1)" fill="none" stroke="' + (lit ? 'var(--tint)' : 'var(--muted)') + '" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">' + ICON.agents + '</g>'
  const label = count > 9 ? '9+' : String(count)
  const badge = count > 0
    ? '<circle cx="18.5" cy="5.5" r="5.5" fill="var(--tint)"/><text x="18.5" y="8.6" text-anchor="middle" font-size="' + (label.length > 1 ? 7 : 8.5) + '" font-weight="700" fill="var(--pill-ink)">' + label + '</text>'
    : ''
  return doc(AGENTS_W, 16, appearance, 'violet', icon + badge)
}
export const AGENTS_W = 24

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
