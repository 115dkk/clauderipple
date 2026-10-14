// The matrix (2026-10-14): the desktop's third skin, an instrument panel. Near-black ground with a
// faint grid, one phosphor green for everything that is ours, amber and red kept for what they
// mean, square corners everywhere: a capsule and a tile are framed by their four corners (drawn
// here, laid in placed Boxes by kit.tsx) rather than by a border of the host's, whose corners are
// round. Controls are blocks: a lit block is the colour filled with dark words in it, an unlit one
// an outline. One slow scan down the water's old place, a status line along the top in the
// capsule's tone; nothing else drifts. Always dark, like the deep, so every colour is its own, and
// 리플이 is drawn in phosphor through a palette of this skin's. Every size is art.ts's. Pure: SVG only.

import { AGENTS_W, CELL_PX, CLOSE_PX, CONTROL_PX, FLAME, GLYPH, ICON, ICON_PX, METER_H, METER_W, SWITCH_H, SWITCH_W, TILE_PX, esc, labelPx, r, svg } from './art.ts'
import type { Tone } from './art.ts'
import type { Paint } from './look.ts'
import type { Palette } from './theme.ts'

/** The panel's colours: the ground, host Text in three strengths, the rule's green. */
export const MATRIX = { ground: '#070a08', ink: '#c8ffd4', sub: '#86e6a0', mute: '#4f9f68', faint: '#1c3a27', line: '#2fbf63' } as const

type Light = { hi: string; lo: string; glow: string; text: string; on: string }

const LIGHT = {
  green: { hi: '#7dffa0', lo: '#1fbf58', glow: '#4dff86', text: '#8dffad', on: '#04170a' },
  amber: { hi: '#ffd27a', lo: '#e0940f', glow: '#ffbf3f', text: '#ffc96b', on: '#2a1a03' },
  red: { hi: '#ff8a8a', lo: '#e03a3c', glow: '#ff5c5c', text: '#ff8080', on: '#2a0505' },
  cyan: { hi: '#8ff3ff', lo: '#1fb7cc', glow: '#5ee8ff', text: '#8ae8f5', on: '#03222a' },
} as const satisfies Record<string, Light>

const GREEN = LIGHT.green

/** The deep's tones in phosphor: its violet and teal are the green, its ice the cyan; amber and red stay. */
export function matrixTone(tone: Tone): Light {
  if (tone === 'amber' || tone === 'ember') return LIGHT.amber
  if (tone === 'red') return LIGHT.red
  if (tone === 'cyan' || tone === 'ice') return LIGHT.cyan
  return GREEN
}

/** 리플이's palette on the panel (theme.ts `svgDoc`): phosphor ink and tone, amber and red for its worries. */
export const MATRIX_PALETTE: Palette = {
  ink: MATRIX.ink, muted: MATRIX.mute, faint: MATRIX.faint,
  fill: 'rgba(125,255,160,0.06)', stroke: 'rgba(125,255,160,0.3)',
  accent: GREEN.hi, accentWash: 'rgba(125,255,160,0.16)', accentLine: 'rgba(125,255,160,0.6)', primary: GREEN.lo,
  ok: GREEN.hi, warn: LIGHT.amber.hi, bad: LIGHT.red.hi,
}

export type Corner = 'tl' | 'tr' | 'bl' | 'br'

/** A drawn corner's side, px. */
export const CORNER_PX = 10

/** The green at a strength. */
const ga = (alpha: number): string => 'rgba(125,255,160,' + alpha + ')'

const BLUR = '<defs><filter id="f" x="-40%" y="-60%" width="180%" height="220%"><feGaussianBlur stdDeviation="1.8"/></filter></defs>'

/** A label drawn at 12 px, centred on `cx`, on a control `h` high. */
function label(text: string, cx: number, h: number, fill: string, weight: number): string {
  return '<text x="' + r(cx) + '" y="' + r(h / 2 + 12 * 0.36) + '" text-anchor="middle" font-size="12" font-weight="' + weight + '" fill="' + fill + '">' + esc(text) + '</text>'
}

/** An L at one corner of a `size` square, `len` long, inset `in`. */
function bracket(at: Corner, size: number, len: number, inset: number, stroke: string, width: number): string {
  const a = inset
  const b = size - inset
  const d = at === 'tl' ? 'M' + a + ' ' + (a + len) + 'V' + a + 'H' + (a + len)
    : at === 'tr' ? 'M' + (b - len) + ' ' + a + 'H' + b + 'V' + (a + len)
      : at === 'bl' ? 'M' + a + ' ' + (b - len) + 'V' + b + 'H' + (a + len)
        : 'M' + (b - len) + ' ' + b + 'H' + b + 'V' + (b - len)
  return '<path d="' + d + '" fill="none" stroke="' + stroke + '" stroke-width="' + width + '"/>'
}

const TILE_FLAME = 'M22 35.5c6.4 0 10-4.2 10-9.6 0-6-5.2-9-6.1-15.4-3.6 2.4-5.6 6-5.4 9.3-2.2-.9-3.3-3-3.5-4.9-3 2.9-4.4 6.4-4.4 11.3 0 5.4 3.6 9.3 9.4 9.3z'

export function matrixPictures(): Paint {
  return {
    // The ground and its grid, a status line along the top in the capsule's tone (blinking while a
    // request is out), one slow scan down; the judge's sounding a line sweeping across, work a
    // dash running along the floor, done a tick at the right.
    sea: (width, height, sea) => {
      const w = Math.max(80, Math.round(width))
      const full = Math.max(20, Math.round(height))
      const h = Math.min(full, Math.max(20, Math.round(sea.visible ?? full)))
      const k = sea.strength ?? 1
      const t = matrixTone(sea.tone)
      let body =
        '<defs><pattern id="g" width="16" height="16" patternUnits="userSpaceOnUse"><path d="M16 0H0V16" fill="none" stroke="' + GREEN.hi + '" stroke-opacity=".055"/></pattern></defs>' +
        '<rect width="' + w + '" height="' + full + '" fill="' + MATRIX.ground + '"/>' +
        '<rect width="' + w + '" height="' + full + '" fill="url(#g)"/>' +
        '<rect class="st" width="' + w + '" height="2" fill="' + t.hi + '" fill-opacity="' + r(0.55 * k) + '"/>'
      let css = ''
      if (sea.ripples === 'busy') css += '.st{animation:st .9s steps(2) infinite}@keyframes st{50%{opacity:.35}}'
      const strong = sea.weather === 'static'
      body += '<rect class="sc" width="' + w + '" height="6" fill="' + t.hi + '" fill-opacity="' + (strong ? '.1' : '.045') + '"/>'
      css += '.sc{animation:sc ' + (strong ? 3.2 : 7) + 's linear infinite}@keyframes sc{0%{transform:translateY(-8px)}100%{transform:translateY(' + (h + 8) + 'px)}}'
      if (sea.sweep) {
        body += '<rect class="sw" x="-2" width="2" height="' + full + '" fill="' + t.hi + '" fill-opacity=".5"/>'
        css += '.sw{animation:sw 2.2s linear infinite}@keyframes sw{0%{transform:translateX(0)}100%{transform:translateX(' + (w + 4) + 'px)}}'
      }
      if (sea.current) {
        body += '<rect class="cu" x="-120" y="' + (h - 2) + '" width="120" height="1.5" fill="' + t.hi + '" fill-opacity=".7"/>'
        css += '.cu{animation:cu 1.7s linear infinite}@keyframes cu{0%{transform:translateX(0)}100%{transform:translateX(' + (w + 120) + 'px)}}'
      }
      if (sea.tick) {
        const s = Math.min(h * 0.8, 44)
        const x = w - s * 2.2
        const y = (h - s) / 2
        body += '<path d="M' + r(x) + ' ' + r(y + s * 0.55) + 'L' + r(x + s * 0.38) + ' ' + r(y + s * 0.9) + 'L' + r(x + s * 1.1) + ' ' + r(y + s * 0.08) + '" fill="none" stroke="' + t.hi + '" stroke-opacity=".35" stroke-width="' + r(s * 0.14) + '" stroke-linecap="square"/>'
      }
      return svg(w, full, body, css)
    },

    corner: at => svg(CORNER_PX, CORNER_PX, bracket(at, CORNER_PX, 8.5, 0.75, GREEN.hi, 1.5)),

    plate: (width, height) => svg(width, height, '<rect width="' + r(width) + '" height="' + r(height) + '" fill="' + MATRIX.ground + '"/>'),

    // A rocker: the lit block at the right when on, a quiet one at the left when off.
    switch: (on, busy = false) =>
      svg(SWITCH_W, SWITCH_H, on
        ? BLUR + '<rect x="2" y="5" width="32" height="12" fill="' + ga(0.2) + '" stroke="' + GREEN.hi + '" stroke-opacity=".9"/><rect x="21" y="7" width="11" height="8" fill="' + GREEN.hi + '" filter="url(#f)" opacity=".6"/><rect class="' + (busy ? 'kn' : '') + '" x="21" y="7" width="11" height="8" fill="' + GREEN.hi + '"/>'
        : '<rect x="2" y="5" width="32" height="12" fill="none" stroke="' + MATRIX.line + '" stroke-opacity=".6"/><rect x="4" y="7" width="11" height="8" fill="' + MATRIX.mute + '"/>',
      '.kn{animation:kn 1.1s steps(2) infinite}@keyframes kn{50%{opacity:.4}}'),

    word: (text, on, busy = false) => {
      const cells = Math.ceil((labelPx(text, 12) + 22) / CELL_PX)
      const w = cells * CELL_PX
      const h = CONTROL_PX
      const frame = on
        ? '<rect class="' + (busy ? 'pu' : '') + '" x="1" y="1" width="' + r(w - 2) + '" height="' + (h - 2) + '" fill="' + ga(0.14) + '" stroke="' + GREEN.hi + '" stroke-opacity=".85"/>'
        : '<rect x="1" y="1" width="' + r(w - 2) + '" height="' + (h - 2) + '" fill="none" stroke="' + MATRIX.line + '" stroke-opacity=".45"/>'
      return { source: svg(w, h, frame + label(text, w / 2, h, on ? GREEN.hi : MATRIX.mute, on ? 650 : 500), '.pu{animation:pu 1.1s steps(2) infinite}@keyframes pu{50%{stroke-opacity:.3}}'), cells }
    },

    extraHover: widthPx => svg(widthPx, CONTROL_PX, '<rect x="0" y="1" width="' + r(widthPx) + '" height="' + (CONTROL_PX - 2) + '" fill="' + ga(0.08) + '"/>'),

    // A block: the one thing to press filled in its tone with dark words, a quiet one an outline.
    pill: (text, look, tone = 'violet', glyph) => {
      const t = matrixTone(tone)
      const gw = glyph ? 18 : 0
      const cells = Math.ceil((labelPx(text, 12) + 26 + gw) / CELL_PX)
      const w = cells * CELL_PX
      const h = CONTROL_PX
      const ink = look === 'primary' ? t.on : t.hi
      let body = look === 'primary'
        ? BLUR + '<rect x="1" y="1" width="' + r(w - 2) + '" height="' + (h - 2) + '" fill="' + t.hi + '" filter="url(#f)" opacity=".45"/><rect x="1" y="1" width="' + r(w - 2) + '" height="' + (h - 2) + '" fill="' + t.hi + '"/>'
        : '<rect x="1" y="1" width="' + r(w - 2) + '" height="' + (h - 2) + '" fill="' + ga(0.05) + '" stroke="' + t.hi + '" stroke-opacity=".7"/>'
      const textW = labelPx(text, 12)
      const x0 = (w - textW - gw) / 2
      if (glyph) body += '<g transform="translate(' + r(x0) + ' ' + (h / 2 - 6) + ')" fill="none" stroke="' + ink + '" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' + GLYPH[glyph] + '</g>'
      body += label(text, x0 + gw + textW / 2, h, ink, look === 'primary' ? 650 : 550)
      return { source: svg(w, h, body), cells }
    },

    // Cells in one outlined row, the chosen one a filled block with dark words.
    segmented: (labels, cells, chosen, tone = 'violet') => {
      const t = matrixTone(tone)
      const h = CONTROL_PX
      const w = cells.reduce((n, c) => n + c, 0) * CELL_PX
      let body = '<rect x=".5" y=".5" width="' + r(w - 1) + '" height="' + (h - 1) + '" fill="' + ga(0.04) + '" stroke="' + MATRIX.line + '" stroke-opacity=".5"/>'
      let x = 0
      const starts = cells.map(c => {
        const at = x
        x += c * CELL_PX
        return at
      })
      for (let i = 1; i < labels.length; i++) {
        if (i === chosen || i - 1 === chosen) continue
        body += '<rect x="' + r(starts[i]! - 0.5) + '" y="1" width="1" height="' + (h - 2) + '" fill="' + MATRIX.line + '" fill-opacity=".4"/>'
      }
      if (chosen >= 0 && chosen < labels.length) {
        body += '<rect x="' + r(starts[chosen]! + 1) + '" y="1.5" width="' + r(cells[chosen]! * CELL_PX - 2) + '" height="' + (h - 3) + '" fill="' + t.hi + '"/>'
      }
      labels.forEach((text, i) => {
        const lit = i === chosen
        body += label(text, starts[i]! + (cells[i]! * CELL_PX) / 2, h, lit ? t.on : MATRIX.sub, lit ? 650 : 500)
      })
      return svg(w, h, body)
    },

    // A fader: a rail of ticks, the middle one taller, the chosen stop a lit block.
    slider: (count, cellsPerStop, chosen) => {
      const part = cellsPerStop * CELL_PX
      const w = count * part
      const h = 22
      const at = (i: number) => part * (i + 0.5)
      const y = h / 2
      const mid = Math.floor(count / 2)
      const lo = Math.min(mid, chosen)
      const hi = Math.max(mid, chosen)
      let body = BLUR + '<rect x="' + r(at(0)) + '" y="' + (y - 1) + '" width="' + r(at(count - 1) - at(0)) + '" height="2" fill="' + MATRIX.line + '" fill-opacity=".5"/>'
      if (hi > lo) body += '<rect x="' + r(at(lo)) + '" y="' + (y - 1) + '" width="' + r(at(hi) - at(lo)) + '" height="2" fill="' + GREEN.hi + '"/>'
      for (let i = 0; i < count; i++) {
        if (i === chosen) continue
        body += i === mid
          ? '<rect x="' + r(at(i) - 1) + '" y="' + (y - 6) + '" width="2" height="12" fill="' + GREEN.hi + '" fill-opacity=".8"/>'
          : '<rect x="' + r(at(i) - 1) + '" y="' + (y - 4) + '" width="2" height="8" fill="' + MATRIX.line + '" fill-opacity=".8"/>'
      }
      const c = at(chosen)
      body += '<rect x="' + r(c - 4) + '" y="' + (y - 7) + '" width="8" height="14" fill="' + GREEN.hi + '" filter="url(#f)" opacity=".6"/><rect x="' + r(c - 4) + '" y="' + (y - 7) + '" width="8" height="14" fill="' + GREEN.hi + '"/>'
      return svg(w, h, body)
    },

    // The one picture that follows the app's theme: the host's own field text must read in it.
    well: (width, height) =>
      svg(width, height, '<rect class="w" x=".5" y=".5" width="' + r(width - 1) + '" height="' + r(height - 1) + '"/>',
        '.w{fill:#fdfcfa;stroke:' + MATRIX.line + ';stroke-opacity:.8}@media (prefers-color-scheme:dark){.w{fill:#0b120d;stroke:' + MATRIX.line + ';stroke-opacity:.6}}'),

    close: (lit = false) =>
      svg(CLOSE_PX, CLOSE_PX,
        '<rect x="1.5" y="1.5" width="19" height="19" fill="' + (lit ? ga(0.12) : 'none') + '" stroke="' + (lit ? GREEN.hi : MATRIX.line) + '" stroke-opacity="' + (lit ? '.7' : '.35') + '"/>' +
        '<path d="M7.6 7.6l6.8 6.8M14.4 7.6l-6.8 6.8" stroke="' + (lit ? GREEN.hi : MATRIX.sub) + '" stroke-width="1.6" stroke-linecap="square"/>'),

    // Five LED bars: phosphor when Auto chose, ink when the person did, quiet when Auto is off.
    meter: (lit, look) => {
      let bars = ''
      let glow = ''
      for (let i = 0; i < 5; i++) {
        const bh = 5 + i * 2.75
        const on = look === 'deciding' || i < lit
        const fill = !on ? ga(0.14) : look === 'manual' ? MATRIX.ink : look === 'quiet' ? MATRIX.mute : GREEN.hi
        const wave = look === 'deciding' ? ' class="wa" style="animation-delay:' + r(i * 0.13) + 's"' : ''
        const shape = ' x="' + r(i * 4.8 + 0.5) + '" y="' + r(METER_H - bh) + '" width="3.4" height="' + r(bh) + '" fill="' + fill + '"'
        bars += '<rect' + shape + wave + '/>'
        if (on && (look === 'auto' || look === 'deciding')) glow += '<rect' + shape + ' filter="url(#f)" opacity=".6"' + wave + '/>'
      }
      return svg(METER_W, METER_H, BLUR + glow + bars, '.wa{animation:wa 1.15s steps(2) infinite;opacity:.3}@keyframes wa{0%,100%{opacity:.25}40%{opacity:1}}')
    },

    ring: (percent, tone) => {
      const rad = 6
      const c = 2 * Math.PI * rad
      const share = Math.max(0, Math.min(1, percent / 100))
      const dash = r((c * Math.round(share * 100)) / 100)
      return svg(16, 16,
        '<circle cx="8" cy="8" r="' + rad + '" fill="none" stroke="' + ga(0.18) + '" stroke-width="2.4"/>' +
        '<circle cx="8" cy="8" r="' + rad + '" fill="none" stroke="' + (tone === 'ink' ? GREEN.hi : matrixTone(tone).hi) + '" stroke-width="2.4" stroke-dasharray="' + dash + ' ' + r(c) + '" transform="rotate(-90 8 8)"/>')
    },

    clock: (share, tone) => {
      const c = 8
      const rad = 6.4
      const left = Math.max(0, Math.min(1, share))
      const fill = tone === 'soft' ? MATRIX.mute : matrixTone(tone).hi
      const pr = rad - 1.8
      let pie = ''
      if (left >= 0.999) pie = '<circle cx="' + c + '" cy="' + c + '" r="' + r(pr) + '" fill="' + fill + '"/>'
      else if (left > 0.001) {
        const a = (2 * Math.PI * Math.round(left * 12)) / 12
        pie = '<path d="M' + c + ' ' + c + 'V' + r(c - pr) + 'A' + r(pr) + ' ' + r(pr) + ' 0 ' + (a > Math.PI ? 1 : 0) + ' 1 ' + r(c + pr * Math.sin(a)) + ' ' + r(c - pr * Math.cos(a)) + 'Z" fill="' + fill + '"/>'
      }
      return svg(16, 16, '<circle cx="' + c + '" cy="' + c + '" r="' + rad + '" fill="none" stroke="' + fill + '" stroke-opacity=".75" stroke-width="1.3"/>' + pie)
    },

    gauge: kind =>
      svg(16, 16,
        '<path d="M1.8 11.4A6.2 6.2 0 0 1 14.2 11.4" fill="none" stroke="' + MATRIX.sub + '" stroke-opacity=".8" stroke-width="1.3"/>' +
        '<path d="' + (kind === 'seven_day' ? 'M8 11.4L11.4 7.6' : 'M8 11.4L8 6.5') + '" fill="none" stroke="' + MATRIX.sub + '" stroke-width="1.4"/><rect x="6.8" y="10.2" width="2.4" height="2.4" fill="' + MATRIX.sub + '"/>'),

    icon: (icon, on, tone = 'violet') => {
      const t = matrixTone(tone)
      if (icon === 'flame' && on) return svg(ICON_PX, ICON_PX, BLUR + '<path fill="' + t.hi + '" filter="url(#f)" opacity=".6" d="' + FLAME + '"/><path fill="' + t.hi + '" d="' + FLAME + '"/>')
      return svg(ICON_PX, ICON_PX, '<g fill="none" stroke="' + (on ? t.hi : MATRIX.sub) + '" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round">' + ICON[icon] + '</g>')
    },

    agents: (count, on) => {
      const text = count > 9 ? '9+' : String(count)
      const badge = count > 0
        ? '<rect x="14.5" y="0" width="11" height="11" fill="' + GREEN.hi + '"/><text x="20" y="8.6" text-anchor="middle" font-size="' + (text.length > 1 ? 7 : 8.5) + '" font-weight="750" fill="' + GREEN.on + '">' + text + '</text>'
        : ''
      return svg(AGENTS_W, 16, '<g transform="translate(0 .5)" fill="none" stroke="' + (on ? GREEN.hi : MATRIX.sub) + '" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round">' + ICON.agents + '</g>' + badge)
    },

    rule: () => svg(9, 16, '<rect x="4" y="1" width="1" height="3" fill="' + MATRIX.line + '" fill-opacity=".7"/><rect x="4" y="6.5" width="1" height="3" fill="' + MATRIX.line + '" fill-opacity=".7"/><rect x="4" y="12" width="1" height="3" fill="' + MATRIX.line + '" fill-opacity=".7"/>'),

    // A tile's picture: a square module with its four corners ticked, the setting drawn in phosphor
    // while on (or chosen), in the quiet green while off.
    tile: art => {
      const s = TILE_PX
      const module =
        '<rect x="1.5" y="1.5" width="' + (s - 3) + '" height="' + (s - 3) + '" fill="' + ga(0.045) + '" stroke="' + MATRIX.line + '" stroke-opacity=".45"/>' +
        (['tl', 'tr', 'bl', 'br'] as const).map(at => bracket(at, s, 5, 1.5, GREEN.hi, 1.3)).join('')
      const on = (lit: boolean) => (lit ? GREEN.hi : MATRIX.mute)
      if (art.kind === 'effort') {
        let bars = ''
        for (let i = 0; i < 5; i++) {
          const bh = 7 + i * 4.2
          bars += '<rect x="' + r(9.2 + i * 5.4) + '" y="' + r(34 - bh) + '" width="3.6" height="' + r(bh) + '" fill="' + on(art.on) + '"/>'
        }
        return svg(s, s, module + (art.on ? BLUR + bars.replace(/<rect/g, '<rect filter="url(#f)" opacity=".5"') : '') + bars)
      }
      if (art.kind === 'judge') {
        const mark = art.judge === 'model'
          ? '<g fill="none" stroke="' + GREEN.hi + '" stroke-width="2.4" stroke-linecap="square"><rect x="10" y="26" width="6" height="6"/><rect x="28" y="12" width="6" height="6"/><path d="M16 29h6V15h6"/></g>'
          : '<text x="22" y="29.5" text-anchor="middle" font-size="21" font-weight="760" fill="' + GREEN.hi + '">' + (art.judge === 'haiku' ? 'H' : 'J') + '</text>'
        return svg(s, s, module + mark)
      }
      if (art.kind === 'mode') {
        const card = (y: number, top: boolean) =>
          '<rect x="11" y="' + y + '" width="22" height="9" fill="' + (top && art.on ? GREEN.hi : 'none') + '" stroke="' + on(art.on) + '" stroke-opacity="' + (top ? 1 : 0.55) + '" stroke-width="1.4"/>'
        const face = art.on ? '<rect x="14" y="18" width="3" height="3" fill="' + GREEN.on + '"/><rect x="19" y="18.6" width="10" height="1.8" fill="' + GREEN.on + '" fill-opacity=".7"/>' : ''
        return svg(s, s, module + card(28, false) + card(21.5, false) + card(15, true) + face)
      }
      if (art.kind === 'skin') {
        return svg(s, s, module +
          '<rect x="10.5" y="12.5" width="23" height="19" fill="' + ga(0.1) + '" stroke="' + GREEN.hi + '" stroke-width="1.6"/>' +
          '<rect x="14" y="16.5" width="4" height="4" fill="' + GREEN.hi + '"/>' +
          '<path d="M20.5 18.5h8M15 24h12M15 27.5h8" fill="none" stroke="' + GREEN.hi + '" stroke-width="1.6"/>')
      }
      if (art.on) return svg(s, s, module + BLUR + '<path d="' + TILE_FLAME + '" fill="' + LIGHT.amber.hi + '" filter="url(#f)" opacity=".6"/><path d="' + TILE_FLAME + '" fill="' + LIGHT.amber.hi + '"/>')
      const arm = (a: number) => '<g transform="rotate(' + a + ' 22 22)"><path d="M22 9v26M22 13l-3-3M22 13l3-3M22 31l-3 3M22 31l3 3"/></g>'
      return svg(s, s, module + '<g fill="none" stroke="' + MATRIX.mute + '" stroke-width="2" stroke-linecap="square">' + arm(0) + arm(60) + arm(120) + '</g>')
    },

    beads: (step, total) => {
      const gap = 16
      const w = gap * (total - 1) + 16
      let body = BLUR + '<rect x="8" y="7.4" width="' + (w - 16) + '" height="1.2" fill="' + MATRIX.line + '" fill-opacity=".5"/>'
      for (let i = 1; i <= total; i++) {
        const cx = 8 + (i - 1) * gap
        if (i < step) body += '<rect x="' + (cx - 3.5) + '" y="4.5" width="7" height="7" fill="' + GREEN.hi + '"/>'
        else if (i === step) body += '<rect x="' + (cx - 4.5) + '" y="3.5" width="9" height="9" fill="' + GREEN.hi + '" filter="url(#f)" opacity=".6"/><rect x="' + (cx - 4.5) + '" y="3.5" width="9" height="9" fill="' + GREEN.hi + '"/>'
        else body += '<rect x="' + (cx - 3) + '" y="5" width="6" height="6" fill="' + MATRIX.ground + '" stroke="' + MATRIX.line + '" stroke-opacity=".8"/>'
      }
      return { source: svg(w, 16, body), width: w }
    },
  }
}
