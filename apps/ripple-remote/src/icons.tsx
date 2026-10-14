// The web app's line icons (packages/remote/web/dom.ts), same 24-unit paths and stroke.
import React from 'react';
import Svg, { Path, Rect } from 'react-native-svg';

const circle = (cx: number, cy: number, r: number): string => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

const PATHS = {
  back: ['M15 5l-7 7 7 7'],
  chevron: ['M9 6l6 6-6 6'],
  down: ['M6 9l6 6 6-6'],
  copy: ['M8 8h12v12H8z', 'M16 8V4H4v12h4'],
  folder: ['M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z'],
  model: ['M12 3.5l7.5 4.3v8.4L12 20.5l-7.5-4.3V7.8z', 'M12 12l7.3-4.1M12 12v8.3M12 12L4.7 7.9'],
  send: ['M12 19V5M6 11l6-6 6 6'],
  gear: [circle(12, 12, 3), 'M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z'],
  terminal: ['M5 7l5 5-5 5M12 18h7'],
  file: ['M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z', 'M14 3.5v5h5'],
  pencil: ['M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z', 'M13.5 6.5l4 4'],
  search: [circle(11, 11, 6.5), 'M20 20l-4.2-4.2'],
  globe: [circle(12, 12, 8.5), 'M3.5 12h17M12 3.5c2.4 2.6 3.6 5.4 3.6 8.5s-1.2 5.9-3.6 8.5c-2.4-2.6-3.6-5.4-3.6-8.5s1.2-5.9 3.6-8.5z'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  x: ['M6 6l12 12M18 6L6 18'],
  clock: [circle(12, 12, 8.5), 'M12 7.5V12l3 2'],
  shield: ['M12 3.5l7 2.8v5.2c0 4.4-3 7.8-7 9-4-1.2-7-4.6-7-9V6.3z'],
  task: ['M8 6h11M8 12h11M8 18h11', circle(4.5, 6, 1), circle(4.5, 12, 1), circle(4.5, 18, 1)],
  bell: ['M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z', 'M10 20.5a2 2 0 0 0 4 0'],
  up: ['M12 19V7M7 11l5-5 5 5', 'M5 4.5h14'],
} as const;

export type IconName = keyof typeof PATHS | 'stop';

export function Icon({ name, size = 20, color }: { name: IconName; size?: number; color: string }) {
  if (name === 'stop') return <Svg width={size} height={size} viewBox="0 0 24 24"><Rect x={6.5} y={6.5} width={11} height={11} rx={2.2} fill={color} /></Svg>;
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
    {PATHS[name].map((d, i) => <Path key={i} d={d} />)}
  </Svg>;
}

/** The icon the web shows in front of a tool row (dom.ts toolIcon). */
export function toolIconName(name: string): IconName {
  if (name === 'Bash' || name === 'BashOutput' || name === 'KillShell') return 'terminal';
  if (name === 'Edit' || name === 'Write' || name === 'MultiEdit' || name === 'NotebookEdit') return 'pencil';
  if (name === 'Read') return 'file';
  if (name === 'Glob' || name === 'Grep' || name === 'LS') return 'search';
  if (name === 'WebFetch' || name === 'WebSearch') return 'globe';
  if (name === 'Task' || name === 'Agent') return 'model';
  if (name === 'TodoWrite') return 'task';
  return 'chevron';
}
