import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FACES, FACE_TONE, GAUGE_FACES, gaugeStep, rippleBody, rippleCss } from '../../packages/mod/hooks/ui/ripple.ts'

test('each face is one fixed drawing in its tone, the face itself in ink', () => {
  for (const face of FACES) {
    const body = rippleBody(face)
    assert.equal(rippleBody(face), body, face)
    assert.ok(body.includes('var(--' + FACE_TONE[face] + ')'), face)
    assert.ok(body.includes('var(--ink)'), face)
    // Faces that are no gauge do not change with a value.
    if (!GAUGE_FACES.includes(face)) assert.equal(rippleBody(face, 37), body, face)
  }
  assert.equal(new Set(FACES.map(face => rippleBody(face))).size, FACES.length)
})

test('nothing the host would refuse or that reaches out: no script, handlers, links, filters, SMIL', () => {
  for (const face of FACES) {
    for (const markup of [rippleBody(face, 50), rippleCss(face)]) {
      assert.doesNotMatch(markup, /<script|\son\w+=|href|url\(|filter|<animate|<set\b|@import/i, face)
    }
  }
})

test('the gauge moves in steps of 5%, so a creeping figure redraws the same picture', () => {
  assert.deepEqual([0, 2.4, 2.5, 61, 62.4, 62.5, 97.4, 97.5, 140, -3, NaN].map(gaugeStep), [0, 0, 5, 60, 60, 65, 95, 100, 100, 0, 0])
  for (const face of GAUGE_FACES) {
    assert.equal(rippleBody(face, 59), rippleBody(face, 61), face)
    assert.notEqual(rippleBody(face, 60), rippleBody(face, 65), face)
    const drawn = new Set(Array.from({ length: 1001 }, (_, i) => rippleBody(face, i / 10)))
    assert.equal(drawn.size, 21, face)
    // A track behind the value; empty, the track alone; full, the whole ring in the tone.
    assert.ok(rippleBody(face, 50).includes('stroke="var(--faint)"'), face)
    assert.doesNotMatch(rippleBody(face, 0), /M28 14\.5A/)
    assert.doesNotMatch(rippleBody(face, 100), /var\(--faint\)|M28 14\.5A/)
    // Past half the arc takes the long way round.
    assert.match(rippleBody(face, 40), /A16\.5 16\.5 0 0 1 /)
    assert.match(rippleBody(face, 70), /A16\.5 16\.5 0 1 1 /)
  }
})

test('every motion is gentle CSS that starts and ends on the rest pose, and none under reduced motion', () => {
  const QUERY = '@media (prefers-reduced-motion:no-preference){'
  for (const face of FACES) {
    const css = rippleCss(face)
    const at = css.indexOf(QUERY)
    assert.ok(at > 0, face)
    // All keyframes and animations sit inside the query, which closes the stylesheet.
    const outside = css.slice(0, at)
    assert.doesNotMatch(outside, /animation|@keyframes/, face)
    assert.ok(css.endsWith('}}'), face)
    const frames = [...css.matchAll(/@keyframes (\w+)\{(.*?\})\}/g)]
    assert.ok(frames.length > 0, face)
    for (const [, name, body] of frames) {
      if (name === 'spin') {
        // The progress ring turns by one dash: eight dashes of 9.2 + 3.76 round a ring of r 16.5.
        assert.equal(body, 'from{transform:none}to{transform:rotate(45deg)}')
        assert.ok(Math.abs(8 * (9.2 + 3.76) - 2 * Math.PI * 16.5) < 0.01)
        continue
      }
      assert.match(body!, /^0%,100%\{(transform:none|opacity:[01]|;)+\}/, face + ' ' + name)
    }
    // Loops last 0.9 to 5 s; the alarm is the quickest loop, done plays once.
    for (const [, seconds, rest] of css.matchAll(/animation:\w+ ([\d.]+)s ([^}]*)\}/g)) {
      assert.ok(Number(seconds) >= 0.9 && Number(seconds) <= 5, face + ' ' + seconds)
      if (face === 'pleased') assert.match(rest!, / 1$/)
    }
  }
})
