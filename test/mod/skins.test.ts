import { test } from 'node:test'
import assert from 'node:assert/strict'
import { flatPictures } from '../../packages/mod/hooks/ui/flat.ts'
import * as deep from '../../packages/mod/hooks/ui/art.ts'
import * as cells from '../../packages/mod/hooks/ui/cells.ts'
import type { Paint } from '../../packages/mod/hooks/ui/look.ts'
import type { Sea, TileArt } from '../../packages/mod/hooks/ui/art.ts'
import { svgDoc } from '../../packages/mod/hooks/ui/theme.ts'
import { rippleBody, rippleCss } from '../../packages/mod/hooks/ui/ripple.ts'

const DEEP: Paint = {
  sea: deep.seaArt, plate: deep.plateArt, switch: deep.switchArt, word: deep.wordArt, extraHover: deep.extraHoverArt,
  pill: deep.pillArt, segmented: deep.segmentedArt, slider: deep.sliderArt, well: deep.wellArt, close: deep.closeArt,
  meter: deep.meterArt, ring: deep.ringArt, clock: deep.clockArt, gauge: deep.gaugeArt, icon: deep.iconArt,
  agents: deep.agentsArt, rule: deep.ruleArt, tile: deep.tileArt, beads: deep.beadsArt,
}

/** The two skins that share the deep's layout and change paint alone. */
const PAINTS: [string, Paint][] = [['deep', DEEP], ['flat', flatPictures('auto')], ['flat-dark', flatPictures('dark')]]

const SEAS: Sea[] = [
  { tone: 'violet', at: { x: 30, y: 20 }, ripples: 'calm', motes: true, wave: 40, visible: 60 },
  { tone: 'amber', at: { x: 30, y: 20 }, ripples: 'busy', sweep: true, current: true, strength: 0.5 },
  { tone: 'ice', at: { x: 30, y: 20 }, weather: 'snow' },
  { tone: 'red', at: { x: 30, y: 20 }, weather: 'static' },
  { tone: 'green', at: { x: 30, y: 20 }, tick: true, weather: 'sparkles' },
]
const TILES: TileArt[] = [
  { kind: 'effort', on: true }, { kind: 'effort', on: false }, { kind: 'judge', judge: 'haiku' }, { kind: 'judge', judge: 'jev' }, { kind: 'judge', judge: 'model' },
  { kind: 'mode', on: true }, { kind: 'mode', on: false }, { kind: 'warm', on: true }, { kind: 'warm', on: false }, { kind: 'skin', skin: 'flat' },
]

/** A drawing is one SVG document, its figures all numbers. */
function sound(name: string, source: string): void {
  assert.ok(source.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), name + ' starts an svg')
  assert.ok(source.endsWith('</svg>'), name + ' ends it')
  assert.ok(!/NaN|undefined|null|\[object/.test(source), name + ' has no stray value: ' + source.slice(0, 200))
  assert.equal((source.match(/<svg\b/g) ?? []).length, 1, name + ' is one document')
}

test('the deep and flat draw every picture, each one sound', () => {
  for (const [skin, art] of PAINTS) {
    for (const sea of SEAS) {
      const drawn = art.sea(600, 300, sea)
      if (drawn) sound(skin + ' sea ' + sea.tone, drawn)
    }
    sound(skin + ' plate', art.plate(300, 19))
    for (const on of [true, false]) for (const busy of [true, false]) sound(skin + ' switch', art.switch(on, busy))
    for (const on of [true, false]) for (const busy of [true, false]) sound(skin + ' word', art.word('Auto', on, busy).source)
    sound(skin + ' extraHover', art.extraHover(7.917))
    for (const look of ['primary', 'ghost'] as const) for (const glyph of [undefined, 'open', 'close', 'next'] as const) sound(skin + ' pill', art.pill('열기', look, 'amber', glyph).source)
    sound(skin + ' segmented', art.segmented(['Haiku', 'Jev', '라우터'], [6, 5, 7], 1, 'teal'))
    sound(skin + ' segmented none', art.segmented(['A', 'B'], [5, 5], -1))
    sound(skin + ' segmented colours', art.segmented(['L', 'M', 'H', 'X', 'Max'], [5, 5, 5, 5, 5], 3, 'violet', [...deep.DEPTH]))
    for (const chosen of [0, 2, 4]) sound(skin + ' slider', art.slider(5, 3, chosen))
    sound(skin + ' well', art.well(200, 32))
    for (const lit of [true, false]) sound(skin + ' close', art.close(lit))
    for (const look of ['auto', 'manual', 'quiet', 'deciding'] as const) sound(skin + ' meter', art.meter(3, look))
    for (const tone of ['ink', 'amber', 'red'] as const) sound(skin + ' ring', art.ring(38, tone))
    for (const tone of ['soft', 'violet', 'amber'] as const) for (const share of [0, 0.3, 1]) sound(skin + ' clock', art.clock(share, tone))
    for (const kind of ['five_hour', 'seven_day']) sound(skin + ' gauge', art.gauge(kind))
    for (const icon of ['flame', 'gear', 'agents', 'log', 'compact', 'clear'] as const) for (const on of [true, false]) sound(skin + ' icon', art.icon(icon, on, 'amber'))
    for (const count of [0, 2, 12]) sound(skin + ' agents', art.agents(count, count > 0))
    sound(skin + ' rule', art.rule())
    for (const tile of TILES) sound(skin + ' tile ' + tile.kind, art.tile(tile))
    for (const step of [1, 2, 3]) sound(skin + ' beads', art.beads(step, 3).source)
  }
})

test('flat changes paint, never geometry: pills, words and beads take the deep\'s cells', () => {
  for (const label of ['Auto', '전체 설정 열기', 'Open all settings', 'Matrix']) {
    const sizes = PAINTS.map(([, art]) => [art.pill(label, 'ghost', 'violet', 'open').cells, art.pill(label, 'primary').cells, art.word(label, true).cells, art.beads(2, 3).width])
    for (const other of sizes.slice(1)) assert.deepEqual(other, sizes[0], label)
  }
})

test('flat follows the theme: its pictures paint with palette variables, fixed only when the appearance is', () => {
  const auto = flatPictures('auto')
  assert.ok(auto.switch(true).includes('var(--primary)'))
  assert.ok(auto.plate(100, 19).includes('@media (prefers-color-scheme:dark)'))
  assert.ok(!flatPictures('dark').plate(100, 19).includes('@media (prefers-color-scheme'))
  assert.equal(auto.sea(600, 300, SEAS[0]!), '')
  // One accent: the efforts' depths and the judge's teal are not taken.
  assert.ok(!auto.segmented(['L', 'M'], [5, 5], 0, 'teal', ['#67e8f9', '#7dd3fc']).includes('#67e8f9'))
})

/** Every cell of the board, drawn in its states. */
function boardPictures(): [string, string][] {
  const out: [string, string][] = []
  const lamps = ['on', 'bypass', 'off', 'busy', 'danger', 'remark'] as const
  for (const lamp of lamps) {
    out.push(['ground ' + lamp, cells.groundArt(700, 300, { lamp, lampY: 10 })])
    out.push(['ground header ' + lamp, cells.groundArt(700, 300, { lamp, lampY: 10, headerPx: 68 })])
    out.push(['row ' + lamp, cells.rowArt(700, 228, { lamp, coordinate: 'E1', headerPx: 38 })])
    out.push(['lamp ' + lamp, cells.lampArt(lamp)])
  }
  out.push(['row cancelled', cells.rowArt(700, 228, { lamp: 'on', coordinate: 'J2', headerPx: 38, cancelled: true, engaged: true })])
  for (const code of ['AUTO', 'JUDGE', '판정']) out.push(['code ' + code, cells.codeArt(code).source], ['code cancelled', cells.codeArt(code, { cancelled: true }).source])
  for (const ink of ['text', 'muted', 'accent', 'accent2', 'success', 'warning', 'danger'] as const) out.push(['readout ' + ink, cells.readoutArt('41분', { ink, marker: true }).source])
  for (const edge of ['border', 'accent', 'dashed'] as const) out.push(['readout ' + edge, cells.readoutArt('gpt-6.1-sol', { edge, widthPx: 120 }).source])
  out.push(['caption', cells.captionArt('Effort').source], ['caption ko', cells.captionArt('추론 강도', { ink: 'accent' }).source])
  out.push(['scan', cells.scanArt(400, 22)], ['scan accent', cells.scanArt(400, 32, { edge: 'accent' })])
  for (const on of [true, false]) for (const busy of [true, false]) out.push(['power', cells.powerArt(on, busy)])
  const labels = ['Haiku', 'Jev', '라우터 모델']
  const widths = cells.portCells(labels)
  for (const chosen of [-1, 0, 2]) out.push(['ports ' + chosen, cells.portsArt(labels, widths, chosen)])
  out.push(['ports cancelled', cells.portsArt(labels, widths, 1, { cancelled: true })])
  for (const chosen of [0, 2, 4]) out.push(['led ' + chosen, cells.ledStripArt(5, 3, chosen)])
  for (const look of ['auto', 'manual', 'quiet', 'deciding'] as const) out.push(['meter ' + look, cells.meterArt(3, look)])
  for (const kind of ['execute', 'quiet', 'cancelled'] as const) out.push(['plate ' + kind, cells.plateArt('Open all settings', kind).source], ['plate ko ' + kind, cells.plateArt('전체 설정 열기', kind).source])
  for (const lit of [true, false]) out.push(['close', cells.closeArt(lit)])
  for (const icon of ['flame', 'gear', 'agents', 'compact', 'clear'] as const) out.push(['cell ' + icon, cells.cellArt(icon, 5, { on: true, lamp: 'on', count: '9+' })], ['cell off ' + icon, cells.cellArt(icon, 4)])
  for (const step of [1, 2, 3, 4]) out.push(['steps ' + step, cells.stepsArt(step, 3).source])
  out.push(['rule', cells.ruleArt(700)])
  return out
}

test('the board draws every cell sound, follows the theme, and neither glows nor rounds a corner', () => {
  for (const [name, source] of boardPictures()) {
    sound('board ' + name, source)
    assert.ok(source.includes('@media (prefers-color-scheme:dark)'), name + ' has both faces')
    assert.ok(!/feGaussianBlur|filter=|<radialGradient|<linearGradient/.test(source), name + ' glows or shades')
    assert.ok(!/ rx="/.test(source), name + ' rounds a corner')
  }
})

test('board type is measured as mono: wide characters a full em, the rest six tenths', () => {
  assert.equal(cells.monoPx('ab', 10), 12)
  assert.equal(cells.monoPx('가', 10), 10)
  assert.equal(cells.monoPx('a가', 10, 1), 18)
  assert.equal(cells.elide('abcdefgh', 30, 10), 'abcd…')
  assert.equal(cells.elide('abc', 30, 10), 'abc')
  assert.equal(cells.caps('Haiku 판정'), 'HAIKU 판정')
  // A port strip's cells come from its labels in mono caps, never fewer than five.
  assert.deepEqual(cells.portCells(['A', 'Router model']), [5, cells.cellsOf(cells.monoPx('ROUTER MODEL', 10.5, 0.5) + 20)])
})

test('리플이 draws in the board\'s own ink on both faces', () => {
  const face = svgDoc(56, 56, 'auto', rippleBody('calm'), rippleCss('calm'), '0 0 56 56', cells.BOARD_PALETTE)
  assert.ok(face.includes('--accent:' + cells.BOARD_PALETTE.light.accent))
  assert.ok(face.includes('@media (prefers-color-scheme:dark){svg{') && face.includes('--accent:' + cells.BOARD_PALETTE.dark.accent))
  // Furniture, not signal: its tone is the board's muted ink, and only its worries take the rationed colours.
  assert.equal(cells.BOARD_PALETTE.dark.accent, cells.FACE.dark.muted)
  assert.equal(cells.BOARD_PALETTE.dark.bad, cells.FACE.dark.danger)
})
