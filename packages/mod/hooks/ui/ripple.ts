// 리플이 (Ripple), the mod's mascot: a ripple ring with a face, a wave crest on top and two
// ripple ears. One drawing per face, on a 56-unit grid, from the approved sheet "리플이 v2 (물마루)"
// (design-drafts/ripple-char-v2.html, 2026-10-11): every number below is that sheet's.
//
// What the host allows, and so what this draws (see parts.tsx, band.tsx):
// - The desktop builds every answer afresh, each Svg a new <img> or <iframe>. So a face is one
//   fixed string; only the gauge's value varies, quantised to 5% so a figure that creeps does not
//   make a new picture every redraw.
// - Motion is CSS inside the document, and every loop starts and ends on the rest pose (the static
//   markup): a redraw restarts it, and a restart from rest reads as going on, not as a jump.
//   Under prefers-reduced-motion nothing moves. No filters, no external references, no script.
// - Colours are the palette variables svgDoc sets (theme.ts): the body takes the state's tone,
//   the face is always ink, so light and dark differ by tokens alone.
//
// Pure: no imports at run time, so node tests can load it.

import type { Palette } from './theme'

export type Face = 'calm' | 'sleepy' | 'uneasy' | 'strained' | 'alarmed' | 'dazed' | 'asking' | 'squeezing' | 'going' | 'pleased' | 'sorry'
export type FaceTone = 'accent' | 'ok' | 'warn' | 'bad'

export const FACES: readonly Face[] = ['calm', 'sleepy', 'uneasy', 'strained', 'alarmed', 'dazed', 'asking', 'squeezing', 'going', 'pleased', 'sorry']

/** The grid every face is drawn on: the SVG's viewBox is `0 0 56 56` at any size. */
export const GRID = 56

/** Below this a face is not legible (the sheet's 34 px floor). */
export const MIN_SIZE = 34

export const FACE_TONE: Record<Face, FaceTone> = {
  calm: 'accent',
  sleepy: 'accent',
  uneasy: 'warn',
  strained: 'warn',
  alarmed: 'bad',
  dazed: 'bad',
  asking: 'accent',
  squeezing: 'accent',
  going: 'accent',
  pleased: 'ok',
  sorry: 'bad',
}

/** The faces whose ring is a gauge when given a value. */
export const GAUGE_FACES: readonly Face[] = ['uneasy', 'strained', 'alarmed']

/** A gauge value as drawn: whole multiples of 5 from 0 to 100. */
export function gaugeStep(percent: number): number {
  if (!Number.isFinite(percent)) return 0
  return Math.min(100, Math.max(0, Math.round(percent / 5) * 5))
}

const v = (key: keyof Palette): string => 'var(--' + key + ')'
const n = (x: number): string => String(Math.round(x * 100) / 100)

// ---- Parts ---------------------------------------------------------------------------------------

/** The crest's variants: its base sits on the outer edge of the ring at −100°…−64°, buried in it. */
const CREST = {
  up: 'M24.7 12.29C24.2 6.2 29.2 2.4 35 2.6C39.6 2.8 42.6 6.2 41.6 9.8C40.6 8 38.6 7 36.8 7.6C35 8.2 35 11 36.33 13.92Z',
  tall: 'M24.7 12.29C24.4 5.6 28.6 0.8 34.2 0.6C37.6 0.5 40.2 2.2 40.8 4.6C39.2 3.8 37.2 4 36.2 5.4C35 7.2 35.2 10.6 36.33 13.92Z',
  short: 'M24.7 12.29C25 8.4 28.4 6.4 32 6.6C34.8 6.8 36.8 8.4 36.8 10.2C36 9.6 35.2 9.8 34.9 10.6C34.7 11.6 35.4 12.8 36.33 13.92Z',
  wind: 'M24.7 12.29C25.6 6.4 31.6 3.6 38 4C42 4.2 44.6 6 45.2 8.4C43.4 7.4 40.8 7.4 38.8 8.4C37.2 9.4 36 11.6 36.33 13.92Z',
  wilt: 'M24.7 12.29C25.4 6 31.4 3.8 36.6 4.6C41.6 5.4 44.4 9.6 43.6 14.6C42.4 12 40.2 10.6 38.2 11C37.2 11.4 36.6 12.6 36.33 13.92Z',
  left: 'M31.3 12.29C31.8 6.2 26.8 2.4 21 2.6C16.4 2.8 13.4 6.2 14.4 9.8C15.4 8 17.4 7 19.2 7.6C21 8.2 21 11 19.67 13.92Z',
} as const

/** The question's tail: two points on the ring's outer edge meeting at (8.6, 53.4). */
const TAIL = 'M18.5 47.45Q15.4 51.2 8.6 53.4Q11.8 48.2 13.03 42.7Z'

const RING = '<circle cx="28" cy="31" r="16.5" fill="none"'
const EAR_R = 'M49.47 21.44A23.5 23.5 0 0 1 49.47 40.56'
const EAR_L = 'M6.53 40.56A23.5 23.5 0 0 1 6.53 21.44'
const OUTER_R = 'M53.86 23.59A26.9 26.9 0 0 1 53.86 38.41'
const OUTER_L = 'M2.14 38.41A26.9 26.9 0 0 1 2.14 23.59'

function stroke(d: string, paint: string, width: number, extra = ''): string {
  return '<path d="' + d + '" fill="none" stroke="' + paint + '" stroke-width="' + width + '" stroke-linecap="round"' + extra + '/>'
}

/** A line of the face: always ink, round caps and joins. */
function ink(d: string, width = 2.2): string {
  return stroke(d, v('ink'), width, ' stroke-linejoin="round"')
}

function capsules(x: number, y: number, h: number): string {
  return [x, x + 11.2].map(cx => '<rect x="' + n(cx) + '" y="' + n(y) + '" width="3.6" height="' + n(h) + '" rx="1.8" fill="' + v('ink') + '"/>').join('')
}

/** A water drop (sweat, tear) at its top point, scaled; always muted. */
function drop(x: number, y: number, s: number): string {
  const r = 2.3 * s
  return (
    '<path d="M' + n(x) + ' ' + n(y) + 'q' + n(-r) + ' ' + n(3.1 * s) + ' ' + n(-r) + ' ' + n(4.5 * s) + 'a' + n(r) + ' ' + n(r) + ' 0 0 0 ' + n(2 * r) +
    ' 0q0 ' + n(-1.4 * s) + ' ' + n(-r) + ' ' + n(-4.5 * s) + 'z" fill="' + v('muted') + '"/>'
  )
}

type Ears = 'on' | 'dim' | 'double' | 'none' | 'left'

function ears(kind: Ears, paint: string): string {
  switch (kind) {
    case 'none':
      return ''
    case 'left':
      return stroke(EAR_L, paint, 2.4, ' stroke-opacity="0.55"')
    case 'dim':
      return stroke(EAR_R, paint, 2.4, ' stroke-opacity="0.4"') + stroke(EAR_L, paint, 2.4, ' stroke-opacity="0.4"')
    case 'on':
      return stroke(EAR_R, paint, 2.4) + stroke(EAR_L, paint, 2.4)
    case 'double':
      return (
        stroke(EAR_R, paint, 2.4) + stroke(EAR_L, paint, 2.4) +
        stroke(OUTER_R, paint, 2, ' stroke-opacity="0.55"') + stroke(OUTER_L, paint, 2, ' stroke-opacity="0.55"')
      )
  }
}

/** The ring as a gauge: a faint track and the value from twelve o'clock, clockwise. */
function gauge(percent: number, paint: string): string {
  const p = gaugeStep(percent)
  const track = RING + ' stroke="' + v('faint') + '" stroke-width="5"/>'
  if (p === 0) return track
  if (p === 100) return RING + ' stroke="' + paint + '" stroke-width="5"/>'
  const a = ((-90 + 3.6 * p) * Math.PI) / 180
  const x = 28 + 16.5 * Math.cos(a)
  const y = 31 + 16.5 * Math.sin(a)
  return track + stroke('M28 14.5A16.5 16.5 0 ' + (p > 50 ? 1 : 0) + ' 1 ' + n(x) + ' ' + n(y), paint, 5)
}

/** The ring in progress: eight dashes, the first under the crest. It turns by whole dashes. */
function dashed(paint: string): string {
  return '<g class="spin">' + RING + ' stroke="' + paint + '" stroke-width="5" stroke-dasharray="9.2 3.76" transform="rotate(-99 28 31)"/></g>'
}

// ---- Faces ---------------------------------------------------------------------------------------

type Spec = {
  crest: keyof typeof CREST
  ring: 'solid' | 'gauge' | 'dashed' | 'broken'
  ears: Ears
  /** Eyes, drawn in a group of their own so they can blink. */
  eyes: string
  /** Brows and mouth. */
  face: string
  /** Muted props (z, sweat, tear), drawn last. */
  prop?: string
  /** Crest and ring at 45%, in one group so their overlap does not darken. */
  faded?: boolean
  tail?: boolean
}

const SPECS: Record<Face, Spec> = {
  calm: { crest: 'up', ring: 'solid', ears: 'on', eyes: capsules(20.6, 26.2, 5.6), face: ink('M24.8 36.2q3.2 2.6 6.4 0') },
  sleepy: {
    crest: 'short',
    ring: 'solid',
    ears: 'none',
    faded: true,
    eyes: ink('M20 29q2.4 2.2 4.8 0') + ink('M31.2 29q2.4 2.2 4.8 0'),
    face: ink('M26.6 37.2q1.4 1 2.8 0'),
    prop:
      '<path class="z1" d="M44.4 4.6h4l-4 4.4h4" fill="none" stroke="' + v('muted') + '" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path class="z2" d="M50 10.6h2.8l-2.8 3h2.8" fill="none" stroke="' + v('muted') + '" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" opacity=".7"/>',
  },
  uneasy: {
    crest: 'up',
    ring: 'gauge',
    ears: 'dim',
    eyes: capsules(20.6, 26.9, 5),
    face: ink('M19.4 24.4L25 22.4', 2) + ink('M36.6 24.4L31 22.4', 2) + ink('M22.9 37.2q1.275 -1.7 2.55 0t2.55 0t2.55 0t2.55 0'),
    prop: drop(46.6, 13.8, 1),
  },
  strained: {
    crest: 'tall',
    ring: 'gauge',
    ears: 'on',
    eyes: capsules(20.6, 27.6, 4.4),
    face: ink('M19.6 23.6h5.4', 2) + ink('M31 23.6h5.4', 2) + ink('M24.9 37.4h6.2'),
  },
  alarmed: {
    crest: 'tall',
    ring: 'gauge',
    ears: 'double',
    eyes: '<circle cx="22.4" cy="29" r="3.3" fill="' + v('ink') + '"/><circle cx="33.6" cy="29" r="3.3" fill="' + v('ink') + '"/>',
    face: ink('M18.8 22.4q3.2 -2.2 6.6 -0.8', 2) + ink('M37.2 22.4q-3.2 -2.2 -6.6 -0.8', 2) + '<ellipse cx="28" cy="37.8" rx="2.6" ry="3.1" fill="' + v('ink') + '"/>',
  },
  dazed: {
    crest: 'short',
    ring: 'broken',
    ears: 'left',
    eyes: '<g class="e1">' + ink('M20.2 26.8l4.4 4.4m0 -4.4l-4.4 4.4') + '</g><g class="e2">' + ink('M31.4 26.8l4.4 4.4m0 -4.4l-4.4 4.4') + '</g>',
    face: ink('M23.6 37.8l2.2 -1.8l2.2 1.8l2.2 -1.8l2.2 1.8'),
  },
  asking: {
    crest: 'left',
    ring: 'solid',
    ears: 'dim',
    tail: true,
    eyes: capsules(21.4, 25, 5.6),
    face: ink('M30.4 22.2q2.6 -1.8 5.4 -0.6', 2) + '<ellipse cx="28" cy="37.2" rx="1.7" ry="2" fill="' + v('ink') + '"/>',
  },
  squeezing: {
    crest: 'up',
    ring: 'dashed',
    ears: 'dim',
    eyes: ink('M20.4 26.6l3.4 2.4l-3.4 2.4') + ink('M35.6 26.6l-3.4 2.4l3.4 2.4'),
    face: ink('M25.6 37.4h4.8'),
  },
  going: { crest: 'wind', ring: 'dashed', ears: 'dim', eyes: capsules(22.2, 26.2, 5.6), face: ink('M26.6 37.2q1.4 1 2.8 0') },
  pleased: {
    crest: 'up',
    ring: 'solid',
    ears: 'on',
    eyes: ink('M20 30q2.4 -3.4 4.8 0') + ink('M31.2 30q2.4 -3.4 4.8 0'),
    face: '<path d="M23.8 35.4h8.4a4.2 4.2 0 0 1 -8.4 0z" fill="' + v('ink') + '"/>',
  },
  sorry: {
    crest: 'wilt',
    ring: 'solid',
    ears: 'none',
    eyes: capsules(20.6, 27.6, 4.4),
    face: ink('M19.2 24.8L24.6 22.2', 2) + ink('M36.8 24.8L31.4 22.2', 2) + ink('M24.8 38.4q3.2 -2.6 6.4 0'),
    prop: drop(36.4, 33.2, 0.8),
  },
}

/**
 * The face's markup on the 56 grid, in the drawing order of the sheet: crest, tail, ring, ears,
 * eyes, face, props. `percent` draws the ring of uneasy, strained and alarmed as a gauge.
 */
export function rippleBody(face: Face, percent?: number): string {
  const s = SPECS[face]
  const paint = v(FACE_TONE[face])
  let ring: string
  if (s.ring === 'broken') {
    // Broken at 22°…54°; the shard (28°…46°) knocked 6.2 out along 38° and turned 18°.
    ring =
      stroke('M37.7 44.35A16.5 16.5 0 1 1 43.3 37.18', paint, 5) +
      '<g class="shard">' + stroke('M42.57 38.75A16.5 16.5 0 0 1 39.46 42.87', paint, 5, ' transform="translate(4.89 3.82) rotate(18 41.18 40.93)"') + '</g>'
  } else if (s.ring === 'dashed') ring = dashed(paint)
  else if (s.ring === 'gauge' && percent !== undefined) ring = gauge(percent, paint)
  else ring = RING + ' stroke="' + paint + '" stroke-width="5"/>'
  const crest = '<g class="crest"><path d="' + CREST[s.crest] + '" fill="' + paint + '"/></g>' + (s.tail ? '<path d="' + TAIL + '" fill="' + paint + '"/>' : '')
  const body = s.faded ? '<g opacity="0.45">' + crest + ring + '</g>' : crest + ring
  // The done face's ripple: unseen at rest, spreads once from the ring.
  const halo = face === 'pleased' ? '<circle class="halo" cx="28" cy="31" r="19" fill="none" stroke="' + paint + '" stroke-width="1.6" opacity="0"/>' : ''
  return (
    '<g class="fig">' + halo + body + '<g class="ears">' + ears(s.ears, paint) + '</g>' +
    '<g class="face"><g class="eyes">' + s.eyes + '</g>' + s.face + '</g>' +
    (s.prop ? '<g class="prop">' + s.prop + '</g>' : '') + '</g>'
  )
}

// ---- Motion --------------------------------------------------------------------------------------

/**
 * Every keyframes block opens on `0%,100%` with the rest pose, but the turning dashes: a turn of
 * 45° is one dash, which draws the same as no turn.
 */
const KEYFRAMES = {
  bob: '0%,100%{transform:none}50%{transform:translateY(-1.2px)}',
  breathe: '0%,100%{transform:none}50%{transform:translateY(.8px)}',
  blink: '0%,100%{transform:none}91%{transform:none}95%{transform:scaleY(.12)}98%{transform:none}',
  sway: '0%,100%{transform:none}50%{transform:rotate(-5deg)}',
  droop: '0%,100%{transform:none}50%{transform:rotate(4deg)}',
  quiver: '0%,100%{transform:none}15%{transform:rotate(3deg)}30%{transform:rotate(-3deg)}45%{transform:none}',
  drift: '0%,100%{transform:none;opacity:1}50%{transform:translate(1px,-1.6px);opacity:.4}',
  sweat: '0%,100%{transform:none;opacity:1}60%{transform:translateY(2px);opacity:.5}',
  fret: '0%,100%{transform:none}30%{transform:translateX(-.8px)}70%{transform:translateX(.8px)}',
  pulse: '0%,100%{opacity:1}50%{opacity:.3}',
  jolt: '0%,100%{transform:none}10%{transform:translateY(-1px)}22%{transform:none}',
  dizzy: '0%,100%{transform:none}50%{transform:rotate(90deg)}',
  shard: '0%,100%{transform:none}50%{transform:translate(1.2px,1px) rotate(8deg)}',
  tilt: '0%,100%{transform:none}50%{transform:rotate(-5deg)}',
  squeeze: '0%,100%{transform:none}50%{transform:scale(1.04,.95)}',
  lean: '0%,100%{transform:none}50%{transform:translateX(1.4px)}',
  hop: '0%,100%{transform:none}30%{transform:translateY(-3px)}55%{transform:none}72%{transform:translateY(-1px)}',
  halo: '0%,100%{transform:none;opacity:0}12%{opacity:.55}90%{transform:scale(1.42);opacity:0}',
  tear: '0%,100%{transform:none;opacity:1}55%{transform:translateY(2.6px);opacity:0}56%{transform:none;opacity:0}',
  spin: 'from{transform:none}to{transform:rotate(45deg)}',
} as const

type Move = { at: string; frames: keyof typeof KEYFRAMES; seconds: number; timing?: 'linear' | 'ease-out'; once?: boolean; delay?: number }

const m = (at: string, frames: Move['frames'], seconds: number, more: Omit<Move, 'at' | 'frames' | 'seconds'> = {}): Move => ({ at, frames, seconds, ...more })

/** What moves on each face: calm loops slow, the alarm quick, work keeps turning, done hops once. */
const MOTION: Record<Face, Move[]> = {
  calm: [m('.fig', 'bob', 3.2), m('.crest', 'sway', 3.2), m('.eyes', 'blink', 4.6)],
  sleepy: [m('.fig', 'breathe', 4), m('.z1', 'drift', 3.6), m('.z2', 'drift', 3.6, { delay: 0.6 })],
  uneasy: [m('.crest', 'sway', 2.8), m('.face', 'fret', 3.2), m('.prop', 'sweat', 2.8), m('.eyes', 'blink', 5)],
  strained: [m('.ears', 'pulse', 2.2), m('.crest', 'quiver', 2.2), m('.eyes', 'blink', 3.6)],
  alarmed: [m('.ears', 'pulse', 1.1), m('.crest', 'quiver', 1.1), m('.face', 'jolt', 1.1)],
  dazed: [m('.e1', 'dizzy', 2.4), m('.e2', 'dizzy', 2.4), m('.shard', 'shard', 3), m('.crest', 'sway', 3)],
  asking: [m('.fig', 'tilt', 3.6), m('.eyes', 'blink', 4.2)],
  squeezing: [m('.spin', 'spin', 1.6, { timing: 'linear' }), m('.fig', 'squeeze', 1.6), m('.ears', 'pulse', 1.6)],
  going: [m('.spin', 'spin', 1.6, { timing: 'linear' }), m('.fig', 'lean', 1.6), m('.crest', 'sway', 1.6)],
  pleased: [m('.fig', 'hop', 0.9, { timing: 'ease-out', once: true }), m('.halo', 'halo', 1.4, { timing: 'ease-out', once: true })],
  sorry: [m('.prop', 'tear', 3.8), m('.crest', 'droop', 3.8)],
}

// Where each part turns: the ring's centre, the crest's base, the middle of the eyes.
const EYES_Y: Partial<Record<Face, number>> = { uneasy: 29.4, strained: 29.8, asking: 27.8, sorry: 29.8 }
const ORIGINS = '.fig,.spin,.halo,.face,.ears{transform-origin:28px 31px}.crest{transform-origin:30.5px 13px}.e1{transform-origin:22.4px 29px}.e2{transform-origin:33.6px 29px}.shard{transform-origin:46px 44px}'

/** The face's motion, for svgDoc's `css`; all of it inside a no-preference reduced-motion query. */
export function rippleCss(face: Face): string {
  const moves = MOTION[face]
  const used = [...new Set(moves.map(move => move.frames))]
  const rules = moves.map(move =>
    move.at + '{animation:' + move.frames + ' ' + move.seconds + 's ' + (move.timing ?? 'ease-in-out') + (move.delay ? ' ' + move.delay + 's' : '') + (move.once ? ' 1' : ' infinite') + '}',
  )
  const eyes = '.eyes{transform-origin:28px ' + (EYES_Y[face] ?? 29) + 'px}'
  return (
    'g,circle{transform-box:view-box}' + ORIGINS + eyes +
    '@media (prefers-reduced-motion:no-preference){' +
    used.map(k => '@keyframes ' + k + '{' + KEYFRAMES[k] + '}').join('') + rules.join('') + '}'
  )
}
