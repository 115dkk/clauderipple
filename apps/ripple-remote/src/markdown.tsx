// The same Markdown subset the web timeline renders (fenced code, inline code, bold/italic,
// headings, lists, quotes, tables), drawn with React Native text. Links stay plain text.
import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { mono } from './theme';
import { useStyles } from './ui';

type Block =
  | { k: 'p'; text: string }
  | { k: 'h'; text: string }
  | { k: 'code'; text: string }
  | { k: 'list'; ordered: boolean; items: string[] }
  | { k: 'quote'; text: string }
  | { k: 'table'; head: string[]; rows: string[][] };

const LIST = /^\s*([-*+]|\d+[.)])\s+/;
const ROW = /^\s*\|.*\|\s*$/;
const cells = (r: string): string[] => r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());

function parse(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const fence = /^\s*(```+|~~~+)/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith(fence[1]!)) body.push(lines[i++]!);
      i++;
      out.push({ k: 'code', text: body.join('\n') });
      continue;
    }
    // The web's rule (md.ts): a pipe row followed by a --- row starts a table.
    if (ROW.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? '')) {
      const rows: string[] = [];
      while (i < lines.length && ROW.test(lines[i]!)) rows.push(lines[i++]!);
      out.push({ k: 'table', head: cells(rows[0]!), rows: rows.slice(2).map(cells) });
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { out.push({ k: 'h', text: h[2]! }); i++; continue; }
    if (LIST.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (i < lines.length && LIST.test(lines[i]!)) {
        let item = lines[i++]!.replace(LIST, '');
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]!) && !LIST.test(lines[i]!)) item += '\n' + lines[i++]!.trim();
        items.push(item);
      }
      out.push({ k: 'list', ordered, items });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!)) quote.push(lines[i++]!.replace(/^\s*>\s?/, ''));
      out.push({ k: 'quote', text: quote.join('\n') });
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^\s*(```|~~~|#{1,4}\s|>|([-*+]|\d+[.)])\s)/.test(lines[i]!) &&
      !(ROW.test(lines[i]!) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? ''))) para.push(lines[i++]!);
    if (!para.length) para.push(lines[i++]!);
    out.push({ k: 'p', text: para.join('\n') });
  }
  return out;
}

function Inline({ text }: { text: string }) {
  const { c } = useStyles();
  const parts = text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\s][^*\n]*[^*\s]\*)/);
  return <>{parts.map((p, i) => {
    if (p.length > 2 && p.startsWith('`') && p.endsWith('`')) return <Text key={i} style={{ fontFamily: mono, fontSize: 13.8, backgroundColor: c.surface2 }}>{p.slice(1, -1)}</Text>;
    if (p.length > 4 && p.startsWith('**') && p.endsWith('**')) return <Text key={i} style={{ fontWeight: '700' }}>{p.slice(2, -2)}</Text>;
    if (p.length > 2 && p.startsWith('*') && p.endsWith('*')) return <Text key={i} style={{ fontStyle: 'italic' }}>{p.slice(1, -1)}</Text>;
    return p;
  })}</>;
}

/** A column's width, px: its longest cell at 14 px (Hangul and CJK about a full em, the rest about half), kept between a word and a third of a wide phone. */
function columnWidth(texts: string[]): number {
  const px = (t: string) => Array.from(t.replace(/\*\*|`/g, '')).reduce((n, ch) => n + (ch.codePointAt(0)! >= 0x1100 ? 14 : 7.6), 0);
  return Math.round(Math.min(220, Math.max(64, Math.max(0, ...texts.map(px)) + 20)));
}

function Table({ head, rows, gap }: { head: string[]; rows: string[][]; gap: object }) {
  const { c } = useStyles();
  const [room, setRoom] = useState(0);
  const n = Math.max(head.length, ...rows.map(r => r.length));
  const natural = Array.from({ length: n }, (_, j) => columnWidth([head[j] ?? '', ...rows.map(r => r[j] ?? '')]));
  // Fit the message's width, cells wrapping, as the app's table does; scroll only when even that is too narrow.
  const total = natural.reduce((a, b) => a + b, 0);
  const widths = room && total > room ? natural.map(w => Math.max(64, Math.floor(w * room / total))) : natural;
  const row = (r: string[], key: string, header: boolean) => <View key={key} style={{ flexDirection: 'row', borderBottomWidth: 1, borderColor: header ? c.line2 : c.line }}>
    {widths.map((w, j) => <Text key={j} style={{ width: w, paddingVertical: 7, paddingRight: 12, fontSize: 14, lineHeight: 20, color: header ? c.muted : c.ink, fontWeight: header ? '600' : '400' }}><Inline text={r[j] ?? ''} /></Text>)}
  </View>;
  return <View style={gap} onLayout={e => setRoom(Math.floor(e.nativeEvent.layout.width))}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View>{row(head, 'h', true)}{rows.map((r, i) => row(r, `r${i}`, false))}</View>
    </ScrollView>
  </View>;
}

/** `.msg-asst`: 16 / 1.6, paragraphs 10 apart, code blocks on the sunk surface. */
export function Markdown({ text, caret = false }: { text: string; caret?: boolean }) {
  const { c } = useStyles();
  const base = { fontSize: 16, lineHeight: 25.6, color: c.ink } as const;
  const blocks = parse(text);
  const cursor = caret ? <Text style={{ color: c.accent }}> ▍</Text> : null;
  return <View>{blocks.map((b, i) => {
    const last = i === blocks.length - 1;
    const gap = { marginBottom: last ? 0 : 10 };
    switch (b.k) {
      case 'h': return <Text key={i} style={[base, gap, { fontSize: 16.5, lineHeight: 22, fontWeight: '700', marginTop: i ? 4 : 0 }]}><Inline text={b.text} />{last ? cursor : null}</Text>;
      case 'code': return <ScrollView key={i} horizontal style={[gap, { backgroundColor: c.sunk, borderRadius: 10 }]} contentContainerStyle={{ paddingVertical: 10, paddingHorizontal: 12 }}><Text style={{ fontFamily: mono, fontSize: 13, lineHeight: 19.5, color: c.ink }}>{b.text}</Text></ScrollView>;
      case 'list': return <View key={i} style={[gap, { gap: 2 }]}>{b.items.map((it, j) => <View key={j} style={{ flexDirection: 'row', paddingLeft: 4 }}><Text style={[base, { width: 22, color: c.ink }]}>{b.ordered ? `${j + 1}.` : '•'}</Text><Text style={[base, { flex: 1 }]}><Inline text={it} />{last && j === b.items.length - 1 ? cursor : null}</Text></View>)}</View>;
      case 'table': return <Table key={i} head={b.head} rows={b.rows} gap={gap} />;
      case 'quote': return <View key={i} style={[gap, { paddingLeft: 12, borderLeftWidth: 3, borderLeftColor: c.line2 }]}><Markdown text={b.text} caret={last && caret} /></View>;
      default: return <Text key={i} style={[base, gap]}><Inline text={b.text} />{last ? cursor : null}</Text>;
    }
  })}{!blocks.length && cursor ? <Text style={base}>{cursor}</Text> : null}</View>;
}
