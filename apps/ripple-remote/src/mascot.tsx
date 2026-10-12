// The ripple mascot and the state ring, ported from packages/remote/web/mascot.ts. Geometry is
// copied as-is; colours come from the palette so light and dark differ only by tokens.
import React, { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import { usePalette, type Palette } from './theme';

export type Face = 'calm' | 'pleased' | 'sleepy' | 'uneasy' | 'going' | 'sorry';

const CREST_UP = 'M24.7 12.29C24.2 6.2 29.2 2.4 35 2.6C39.6 2.8 42.6 6.2 41.6 9.8C40.6 8 38.6 7 36.8 7.6C35 8.2 35 11 36.33 13.92Z';
const CREST_SHORT = 'M24.7 12.29C25 8.4 28.4 6.4 32 6.6C34.8 6.8 36.8 8.4 36.8 10.2C36 9.6 35.2 9.8 34.9 10.6C34.7 11.6 35.4 12.8 36.33 13.92Z';
const CREST_WIND = 'M24.7 12.29C25.6 6.4 31.6 3.6 38 4C42 4.2 44.6 6 45.2 8.4C43.4 7.4 40.8 7.4 38.8 8.4C37.2 9.4 36 11.6 36.33 13.92Z';
const CREST_WILT = 'M24.7 12.29C25.4 6 31.4 3.8 36.6 4.6C41.6 5.4 44.4 9.6 43.6 14.6C42.4 12 40.2 10.6 38.2 11C37.2 11.4 36.6 12.6 36.33 13.92Z';

type Tone = 'accent' | 'ok' | 'warn' | 'bad' | 'faint' | 'ink' | 'muted';

function Line({ d, color, w, opacity }: { d: string; color: string; w: number; opacity?: number }) {
  return <Path d={d} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" strokeOpacity={opacity} />;
}
function Ears({ color, dim }: { color: string; dim: boolean }) {
  const o = dim ? 0.4 : undefined;
  return <><Line d="M49.47 21.44A23.5 23.5 0 0 1 49.47 40.56" color={color} w={2.4} opacity={o} /><Line d="M6.53 40.56A23.5 23.5 0 0 1 6.53 21.44" color={color} w={2.4} opacity={o} /></>;
}
function Eyes({ x1, x2, y, h, ink }: { x1: number; x2: number; y: number; h: number; ink: string }) {
  return <><Rect x={x1} y={y} width={3.6} height={h} rx={1.8} fill={ink} /><Rect x={x2} y={y} width={3.6} height={h} rx={1.8} fill={ink} /></>;
}
function Ring({ color, dashed }: { color: string; dashed?: boolean }) {
  return <Circle cx={28} cy={31} r={16.5} fill="none" stroke={color} strokeWidth={5} {...(dashed ? { strokeDasharray: '9.2 3.76', rotation: -99, origin: '28, 31' } : {})} />;
}

function face(name: Face, c: Palette): React.ReactNode {
  const tone: Record<Tone, string> = { accent: c.accent, ok: c.ok, warn: c.warn, bad: c.bad, faint: c.faint, ink: c.ink, muted: c.muted };
  const ink = c.ink;
  switch (name) {
    case 'calm':
      return <><Path d={CREST_UP} fill={tone.accent} /><Ring color={tone.accent} /><Ears color={tone.accent} dim={false} /><Eyes x1={20.6} x2={31.8} y={26.2} h={5.6} ink={ink} /><Line d="M24.8 36.2q3.2 2.6 6.4 0" color={ink} w={2.2} /></>;
    case 'pleased':
      return <><Path d={CREST_UP} fill={tone.ok} /><Ring color={tone.ok} /><Ears color={tone.ok} dim={false} /><Line d="M20 30q2.4 -3.4 4.8 0" color={ink} w={2.2} /><Line d="M31.2 30q2.4 -3.4 4.8 0" color={ink} w={2.2} /><Path d="M23.8 35.4h8.4a4.2 4.2 0 0 1 -8.4 0z" fill={ink} /></>;
    case 'sleepy':
      return <><G opacity={0.45}><Path d={CREST_SHORT} fill={tone.accent} /><Ring color={tone.accent} /></G><Line d="M20 29q2.4 2.2 4.8 0" color={ink} w={2.2} /><Line d="M31.2 29q2.4 2.2 4.8 0" color={ink} w={2.2} /><Line d="M26.6 37.2q1.4 1 2.8 0" color={ink} w={2.2} /><Line d="M44.4 4.6h4l-4 4.4h4" color={tone.muted} w={1.6} /><Line d="M50 10.6h2.8l-2.8 3h2.8" color={tone.muted} w={1.3} opacity={0.7} /></>;
    case 'uneasy':
      return <><Path d={CREST_UP} fill={tone.warn} /><Ring color={tone.faint} /><Line d="M28 14.5A16.5 16.5 0 1 1 13.07 23.97" color={tone.warn} w={5} /><Ears color={tone.warn} dim /><Eyes x1={20.6} x2={31.8} y={26.9} h={5} ink={ink} /><Line d="M19.4 24.4L25 22.4" color={ink} w={2} /><Line d="M36.6 24.4L31 22.4" color={ink} w={2} /><Line d="M22.9 37.2q1.275 -1.7 2.55 0t2.55 0t2.55 0t2.55 0" color={ink} w={2.2} /><Path d="M46.6 13.8q-2.3 3.1 -2.3 4.5a2.3 2.3 0 0 0 4.6 0q0 -1.4 -2.3 -4.5z" fill={tone.muted} /></>;
    case 'going':
      return <><Path d={CREST_WIND} fill={tone.accent} /><Ring color={tone.accent} dashed /><Ears color={tone.accent} dim /><Eyes x1={22.2} x2={33.4} y={26.2} h={5.6} ink={ink} /><Line d="M26.6 37.2q1.4 1 2.8 0" color={ink} w={2.2} /></>;
    case 'sorry':
      return <><Path d={CREST_WILT} fill={tone.bad} /><Ring color={tone.bad} /><Eyes x1={20.6} x2={31.8} y={27.6} h={4.4} ink={ink} /><Line d="M19.2 24.8L24.6 22.2" color={ink} w={2} /><Line d="M36.8 24.8L31.4 22.2" color={ink} w={2} /><Line d="M24.8 38.4q3.2 -2.6 6.4 0" color={ink} w={2.2} /><Path d="M36.4 33.2q-1.84 2.48 -1.84 3.6a1.84 1.84 0 0 0 3.68 0q0 -1.12 -1.84 -3.6z" fill={tone.muted} /></>;
  }
}

export function Ripple({ face: name, size }: { face: Face; size: number }) {
  const c = usePalette();
  return <Svg width={size} height={size} viewBox="0 0 56 56">{face(name, c)}</Svg>;
}

/**
 * The small state glyph in lists and headers: the same ring, no face. Dashed = in progress,
 * warn = needs you, ok = done, faint = paused, bad = error.
 */
export function StateRing({ state, size = 22, spin = false }: { state: string; size?: number; spin?: boolean }) {
  const c = usePalette();
  const color = state === 'waiting' ? c.warn : state === 'error' ? c.bad : state === 'idle' ? c.ok : state === 'stopped' ? c.faint : c.accent;
  const dashed = state === 'running' || state === 'starting';
  const turn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!spin) return;
    const loop = Animated.loop(Animated.timing(turn, { toValue: 1, duration: 2400, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [spin, turn]);
  const glyph = <Svg width={size} height={size} viewBox="0 0 56 56">
    <Path d={state === 'stopped' ? CREST_SHORT : CREST_UP} fill={color} />
    <Circle cx={28} cy={31} r={16.5} fill="none" stroke={color} strokeWidth={6} {...(dashed ? { strokeDasharray: '9.2 3.76', rotation: -99, origin: '28, 31' } : {})} />
    {state === 'waiting' ? <Circle cx={28} cy={31} r={6} fill={c.warn} /> : null}
  </Svg>;
  if (!spin) return glyph;
  return <Animated.View style={{ transform: [{ rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }}>{glyph}</Animated.View>;
}
