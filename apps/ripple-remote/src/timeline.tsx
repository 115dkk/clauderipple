import React, { useState } from 'react';
import { Text, View } from 'react-native';
import type { BlobChunk, SubPage, Text as WireText } from '../../../packages/remote/src/protocol.ts';
import { reduce, type Item } from '../../../packages/remote/web/timeline.ts';
import { t, dictionaries, lang, type Key } from '../../../packages/remote/web/i18n.ts';
import { remote } from './client';
import { Button, copy, s } from './ui';
export function EventText({ value, session }: { value: WireText; session: string }) {
  const [full, setFull] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (typeof value === 'string') return value ? <Text selectable style={s.body}>{value}</Text> : null;
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
  return <View style={{ gap: 8 }}><Text selectable style={s.body}>{full ?? value.preview}</Text><Button title={busy ? t('tool.loading') : full ? t('tool.less') : t('perm.showAll')} secondary disabled={busy} onPress={() => { if (full) setFull(null); else void load(); }} /></View>;
}
function Worker({ item, session }: { item: Extract<Item, { type: 'subagent' }>; session: string }) {
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
  return <View style={s.card}><Text style={s.body}>{t('sub.worker')} · {item.description}</Text><Text style={s.muted}>{item.model} · {t(`sub.${item.status === 'running' ? 'running' : item.status === 'done' ? 'done' : 'failed'}`)} · {t('sub.steps', { n: item.steps })}</Text><Button title={items ? t('tool.less') : t('sub.open')} secondary onPress={() => { if (items) setItems(null); else void load(); }} />{items?.map(child => <TimelineItem key={child.key} item={child} session={session} readOnly />)}</View>;
}
export function TimelineItem({ item, session, readOnly }: { item: Item; session: string; readOnly: boolean }) {
  const [expanded, setExpanded] = useState(false);
  if (item.type === 'start') return <Text style={s.muted}>{t('history.start')}</Text>;
  if (item.type === 'user') return <View style={[s.card, { backgroundColor: '#E8EFF8', marginLeft: 24 }]}><Text selectable style={s.body}>{item.text}</Text>{item.queued && <Text style={s.muted}>{t(`queue.${item.queued}`)}</Text>}</View>;
  if (item.type === 'assistant') return <View style={s.card}><Text style={s.muted}>{item.model}{item.streaming ? ' · …' : ''}</Text><EventText value={item.text} session={session} />{item.tools.map(tool => <View key={tool.id} style={{ gap: 8, paddingTop: 12 }}><Text style={s.mono}>{tool.name} · {tool.summary}</Text>{tool.result && <EventText value={tool.result.text} session={session} />}{tool.result && !tool.result.ok && <Text style={s.warning}>{t('tool.failed')}</Text>}</View>)}</View>;
  if (item.type === 'permission') {
    const decide = (decision: 'allow' | 'allow_always' | 'deny') => { try { remote.send({ t: 'decide', session, id: item.id, decision }); } catch (e) { remote.report(e); } };
    return <View style={[s.card, { borderColor: '#BA893F' }]}><Text style={[s.body, { fontWeight: '600' }]}>{t('perm.title', { tool: item.tool })}</Text><Text selectable style={s.mono}>{item.summary}</Text><Button title={expanded ? t('tool.less') : t('perm.showAll')} secondary onPress={() => setExpanded(!expanded)} />{expanded && <EventText value={item.input} session={session} />}{item.decision ? <Text style={s.muted}>{t(item.decision === 'allow' ? 'perm.allowed' : item.decision === 'allow_always' ? 'perm.allowedAlways' : item.decision === 'deny' ? 'perm.denied' : 'perm.expired')}</Text> : !readOnly && <><View style={s.row}><Button title={t('perm.allow')} onPress={() => decide('allow')} /><Button title={t('perm.deny')} secondary onPress={() => decide('deny')} /></View>{item.canAlways && <Button title={t('perm.always')} secondary onPress={() => decide('allow_always')} />}</>}</View>;
  }
  if (item.type === 'subagent') return <Worker item={item} session={session} />;
  if (item.type === 'result') return <Text style={item.ok ? s.muted : s.warning}>{item.ok ? copy('작업을 마쳤습니다', 'Work finished') : t('turn.failed', { error: item.error ?? '' })} · {item.model} · {Math.round(item.ms / 1000)}s</Text>;
  const key = `notice.${item.code}`;
  return <Text style={s.muted}>{key in dictionaries[lang()] ? t(key as Key, { text: item.text ?? '' }) : item.text ?? item.code}</Text>;
}
