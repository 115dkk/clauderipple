import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { BlobChunk, SubPage, Text as WireText } from '../../../packages/remote/src/protocol.ts';
import { reduce, type Item } from '../../../packages/remote/web/timeline.ts';
import { t, dictionaries, lang, type Key } from '../../../packages/remote/web/i18n.ts';
import { remote } from './client';
import { copy, useStyles } from './ui';
import { Icon, toolIconName } from './icons';
import { Markdown } from './markdown';
import { StateRing } from './mascot';
import { mono, shadow } from './theme';
export function EventText({ value, session, markdown = false, mono: monoText = false, streaming = false }: { value: WireText; session: string; markdown?: boolean; mono?: boolean; streaming?: boolean }) {
  const { c } = useStyles();
  const [full, setFull] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const draw = (text: string) => markdown ? <Markdown text={text} caret={streaming} /> : <Text selectable style={monoText ? { fontFamily: mono, fontSize: 12.5, lineHeight: 19, color: c.ink2 } : { fontSize: 16, lineHeight: 25.6, color: c.ink }}>{text}</Text>;
  if (typeof value === 'string') {
    if (!value && !streaming) return null;
    const long = !markdown && (value.length > 1200 || value.split('\n').length > 12);
    return <View style={{ gap: 6 }}>{draw(long && !expanded ? value.slice(0, 1200).split('\n').slice(0, 12).join('\n') + '\n…' : value)}{long && <Pressable accessibilityRole="button" onPress={() => setExpanded(!expanded)}><Text style={{ fontSize: 13, fontWeight: '600', color: c.accent, paddingVertical: 4 }}>{expanded ? t('tool.less') : t('perm.showAll')}</Text></Pressable>}</View>;
  }
  const load = async () => {
    setBusy(true);
    try {
      let offset = 0, text = '';
      for (;;) {
        const page = await remote.request({ op: 'blob', session, id: value.blob, offset }) as BlobChunk;
        text += page.text;
        if (page.next === null) break;
        offset = page.next;
      }
      setFull(text);
    } catch (e) { remote.report(e); }
    finally { setBusy(false); }
  };
  return <View style={{ gap: 6 }}>{draw(full ?? value.preview)}<Pressable accessibilityRole="button" disabled={busy} onPress={() => { if (full) setFull(null); else void load(); }}><Text style={{ fontSize: 13, fontWeight: '600', color: c.accent, paddingVertical: 4 }}>{busy ? t('tool.loading') : full ? t('tool.less') : t('perm.showAll')}</Text></Pressable></View>;
}

function ToolRow({ tool, session }: { tool: Extract<Item, { type: 'assistant' }>['tools'][number]; session: string }) {
  const { c } = useStyles();
  const [open, setOpen] = useState(false);
  const status = !tool.result ? <Icon name="clock" size={15} color={c.faint} /> : tool.result.ok ? <Icon name="check" size={15} color={c.ok} /> : <Icon name="x" size={15} color={c.bad} />;
  return <View style={{ gap: 4 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${tool.name} ${tool.summary}`} accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
      <Icon name={toolIconName(tool.name)} size={16} color={c.ink2} />
      <Text style={{ fontSize: 13.5, fontWeight: '700', color: c.ink }}>{tool.name}</Text>
      <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, fontFamily: mono, fontSize: 12.5, color: c.muted }}>{tool.summary}</Text>
      {status}
    </Pressable>
    {open && <View style={{ marginTop: 2, marginBottom: 4, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: c.sunk, gap: 12 }}>
      {tool.input && <EventText value={tool.input} session={session} mono />}
      {tool.result && <View style={{ borderTopWidth: tool.input ? 1 : 0, borderTopColor: c.line2, paddingTop: tool.input ? 10 : 0 }}><EventText value={tool.result.text} session={session} mono /></View>}
    </View>}
  </View>;
}

function Worker({ item, session }: { item: Extract<Item, { type: 'subagent' }>; session: string }) {
  const { c } = useStyles();
  const [items, setItems] = useState<Item[] | null>(null);
  const load = async () => {
    try {
      let events: SubPage['events'] = [], afterSeq = 0;
      for (;;) {
        const page = await remote.request({ op: 'sub', session, sub: item.sub, afterSeq }) as SubPage;
        events = [...events, ...page.events];
        if (!page.more || !page.events.length) break;
        afterSeq = page.events.at(-1)!.seq;
      }
      setItems(reduce(events).items);
    } catch (e) { remote.report(e); }
  };
  const status = item.status === 'running' ? t('sub.running') : item.status === 'done' ? t('sub.done') : t('sub.failed');
  return <View style={{ gap: 12 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${t('sub.worker')} ${item.description}`} onPress={() => { if (items) setItems(null); else void load(); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
      <StateRing state={item.status === 'running' ? 'running' : item.status === 'done' ? 'idle' : 'error'} size={28} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontSize: 12.5, color: c.muted }}>{t('sub.worker')}</Text>
          {item.model ? <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: mono, fontSize: 12.5, fontWeight: '600', color: c.accent }}>{item.model}</Text> : null}
          <Text numberOfLines={1} style={{ fontSize: 12.5, color: c.muted }}>· {status} · {t('sub.steps', { n: item.steps })}</Text>
        </View>
        <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '600', color: c.ink }}>{item.description}</Text>
      </View>
      <View style={items ? { transform: [{ rotate: '90deg' }] } : undefined}><Icon name="chevron" size={18} color={c.muted} /></View>
    </Pressable>
    {items && <View style={{ marginLeft: 10, paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: c.line2, gap: 14 }}>{items.map(child => <TimelineItem key={child.key} item={child} session={session} readOnly />)}</View>}
  </View>;
}

export function TimelineItem({ item, session, readOnly }: { item: Item; session: string; readOnly: boolean }) {
  const { c, s } = useStyles();
  const [expanded, setExpanded] = useState(false);
  if (item.type === 'start') return <Text style={{ alignSelf: 'center', fontSize: 12.5, color: c.faint, paddingVertical: 4 }}>{t('history.start')}</Text>;
  if (item.type === 'user') return <View style={{ alignSelf: 'flex-end', maxWidth: '86%', backgroundColor: c.userBg, paddingVertical: 10, paddingHorizontal: 14, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderBottomLeftRadius: 20, borderBottomRightRadius: 6, opacity: item.queued ? 0.72 : 1 }}>
    <Text selectable style={{ fontSize: 16, lineHeight: 24, color: c.ink }}>{item.text}</Text>
    {item.queued && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4, justifyContent: 'flex-end' }}><Icon name="clock" size={13} color={c.muted} /><Text style={{ fontSize: 12.5, color: c.muted }}>{t(`queue.${item.queued}`)}</Text></View>}
  </View>;
  if (item.type === 'assistant') return <View>
    <EventText value={item.text} session={session} markdown streaming={item.streaming} />
    {item.tools.length > 0 && <View style={{ gap: 4, marginTop: 8 }}>{item.tools.map(tool => <ToolRow key={tool.id} tool={tool} session={session} />)}</View>}
  </View>;
  if (item.type === 'permission') {
    const decide = (decision: 'allow' | 'allow_always' | 'deny') => { try { remote.send({ t: 'decide', session, id: item.id, decision }); } catch (e) { remote.report(e); } };
    if (item.decision || readOnly) {
      const label = item.decision === null ? t('state.waiting') : t(item.decision === 'allow' ? 'perm.allowed' : item.decision === 'allow_always' ? 'perm.allowedAlways' : item.decision === 'deny' ? 'perm.denied' : 'perm.expired');
      const tone = item.decision === null ? c.warn : item.decision === 'allow' || item.decision === 'allow_always' ? c.ok : c.bad;
      const icon = item.decision === null ? 'shield' : item.decision === 'allow' || item.decision === 'allow_always' ? 'check' : 'x';
      const why = item.decision === 'expired' && item.reason ? `perm.reason.${item.reason}` : '';
      return <View style={{ gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 2 }}>
          <Icon name={icon} size={16} color={tone} />
          <Text style={{ fontSize: 13.5, fontWeight: '700', color: item.decision === null ? c.warn : c.ink2 }}>{item.tool}</Text>
          <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, fontFamily: mono, fontSize: 12.5, color: c.muted }}>{item.summary}</Text>
          <Text style={{ fontSize: 13.5, color: item.decision === null ? c.warn : c.muted }}>{label}</Text>
        </View>
        {why in dictionaries[lang()] && <Text style={{ fontSize: 12.5, color: c.muted }}>{t(why as Key)}</Text>}
      </View>;
    }
    return <View style={{ backgroundColor: c.surface, borderWidth: 1.5, borderColor: c.warnRing, borderRadius: 20, paddingTop: 14, paddingHorizontal: 14, paddingBottom: 12, ...shadow(c) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name="shield" size={16} color={c.warn} /><Text style={{ fontSize: 13, fontWeight: '700', color: c.warn }}>{item.tool}</Text></View>
      <Text style={{ fontSize: 17, fontWeight: '700', lineHeight: 23, marginTop: 6, marginBottom: 8, color: c.ink }}>{item.title || t('perm.title', { tool: item.tool })}</Text>
      <View style={{ backgroundColor: c.sunk, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 11 }}>
        {expanded ? <EventText value={item.input} session={session} mono /> : <Text selectable numberOfLines={5} style={{ fontFamily: mono, fontSize: 13, lineHeight: 19.5, color: c.ink2 }}>{item.summary}</Text>}
      </View>
      <Pressable accessibilityRole="button" onPress={() => setExpanded(!expanded)}><Text style={{ fontSize: 13, fontWeight: '600', color: c.accent, paddingTop: 6 }}>{expanded ? t('tool.less') : t('perm.showAll')}</Text></Pressable>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('perm.deny')} onPress={() => decide('deny')} style={({ pressed }) => [{ flex: 1, height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface2 }, pressed && s.pressed]}><Text style={{ fontSize: 17, fontWeight: '700', color: c.ink }}>{t('perm.deny')}</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t('perm.allow')} onPress={() => decide('allow')} style={({ pressed }) => [{ flex: 1.35, height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, backgroundColor: c.accentStrong }, pressed && s.pressed]}><Icon name="check" size={20} color={c.accentInk} /><Text style={{ fontSize: 17, fontWeight: '700', color: c.accentInk }}>{t('perm.allow')}</Text></Pressable>
      </View>
      {item.canAlways && <Pressable accessibilityRole="button" onPress={() => decide('allow_always')} style={{ height: 36, marginTop: 8, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 14, fontWeight: '600', color: c.muted }}>{t('perm.always')}</Text></Pressable>}
    </View>;
  }
  if (item.type === 'subagent') return <Worker item={item} session={session} />;
  if (item.type === 'result') return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -6 }}>{!item.ok && <Icon name="x" size={14} color={c.bad} />}<Text style={{ fontSize: 12.5, color: item.ok ? c.muted : c.bad }}>{item.ok ? copy('작업을 마쳤습니다', 'Work finished') : t('turn.failed', { error: item.error ?? '' })} · {item.model} · {Math.round(item.ms / 1000)}s</Text></View>;
  const key = `notice.${item.code}`;
  return <Text style={{ alignSelf: 'center', fontSize: 13, color: c.muted, backgroundColor: c.surface2, paddingVertical: 5, paddingHorizontal: 12, borderRadius: 99, overflow: 'hidden', textAlign: 'center', maxWidth: '92%' }}>{key in dictionaries[lang()] ? t(key as Key, { text: item.text ?? '' }) : item.text ?? item.code}</Text>;
}
