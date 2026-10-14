// Design tokens, ported 1:1 from packages/remote/web/style.css (light :root, dark under
// prefers-color-scheme). Nothing else in the app carries a colour, radius or font literal.
import { useColorScheme, type TextStyle, type ViewStyle } from 'react-native';

export interface Palette {
  bg: string; surface: string; surface2: string; sunk: string;
  ink: string; ink2: string; muted: string; faint: string;
  line: string; line2: string;
  accent: string; accentStrong: string; accentSoft: string; accentInk: string;
  userBg: string;
  warn: string; warnSoft: string; warnLine: string; warnRing: string;
  bad: string; badSoft: string; badLine: string;
  ok: string; okSoft: string;
  /** tints behind the timeline's two-part +/− line-count pill (green add, red remove) */
  addTint: string; delTint: string;
  scrim: string;
  /** colour of the shadow in `shadow`, and how heavy it is */
  shadowColor: string; shadowOpacity: number;
  dark: boolean;
}

export const light: Palette = {
  bg: '#f5f4f1', surface: '#ffffff', surface2: '#eceae5', sunk: '#e7e5df',
  ink: '#1d1b26', ink2: '#3b3946', muted: '#64616f', faint: '#c9c6d2',
  line: 'rgba(29, 27, 38, 0.1)', line2: 'rgba(29, 27, 38, 0.16)',
  accent: '#6a56d6', accentStrong: '#5b47c9', accentSoft: 'rgba(106, 86, 214, 0.1)', accentInk: '#ffffff',
  userBg: '#ebe7fb',
  warn: '#b5820a', warnSoft: 'rgba(181, 130, 10, 0.12)', warnLine: 'rgba(181, 130, 10, 0.35)', warnRing: 'rgba(181, 130, 10, 0.55)',
  bad: '#c73434', badSoft: 'rgba(199, 52, 52, 0.1)', badLine: 'rgba(199, 52, 52, 0.35)',
  ok: '#1a8a4a', okSoft: 'rgba(26, 138, 74, 0.1)',
  addTint: 'rgba(26, 138, 74, 0.14)', delTint: 'rgba(199, 52, 52, 0.12)',
  scrim: 'rgba(20, 18, 28, 0.32)',
  shadowColor: '#1d1b26', shadowOpacity: 0.08,
  dark: false,
};

export const dark: Palette = {
  bg: '#141413', surface: '#1e1e1d', surface2: '#2a2a28', sunk: '#232322',
  ink: '#ecebf2', ink2: '#cfcdd8', muted: '#a19fae', faint: '#55535f',
  line: 'rgba(236, 235, 242, 0.09)', line2: 'rgba(236, 235, 242, 0.15)',
  accent: '#a594f5', accentStrong: '#6f5bdc', accentSoft: 'rgba(165, 148, 245, 0.13)', accentInk: '#ffffff',
  userBg: '#2c2840',
  warn: '#e0b436', warnSoft: 'rgba(224, 180, 54, 0.13)', warnLine: 'rgba(224, 180, 54, 0.35)', warnRing: 'rgba(224, 180, 54, 0.55)',
  bad: '#ef5a5a', badSoft: 'rgba(239, 90, 90, 0.13)', badLine: 'rgba(239, 90, 90, 0.35)',
  ok: '#3ecb7d', okSoft: 'rgba(62, 203, 125, 0.12)',
  addTint: 'rgba(62, 203, 125, 0.18)', delTint: 'rgba(239, 90, 90, 0.18)',
  scrim: 'rgba(0, 0, 0, 0.5)',
  shadowColor: '#000000', shadowOpacity: 0.35,
  dark: true,
};

export const radius = { lg: 20, md: 14, sm: 10 } as const;
export const tap = 48;
export const MAX_WIDTH = 640;

/** The web stack is system-ui first; iOS maps that to SF with Apple SD Gothic Neo for Hangul. */
export const mono = 'Menlo';

export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}

/** `--shadow` (0 1px 2px + 0 8px 24px): one soft layer is what RN can draw. */
export function shadow(c: Palette): ViewStyle {
  return { shadowColor: c.shadowColor, shadowOpacity: c.shadowOpacity, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } };
}

export const tnum: TextStyle = { fontVariant: ['tabular-nums'] };
