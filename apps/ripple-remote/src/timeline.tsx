import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Clipboard, Image, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import type { ImagePart } from '../../../packages/remote/src/protocol.ts';
import type { BlobChunk, SubPage, Text as WireText } from '../../../packages/remote/src/protocol.ts';
import { reduce, timelineItems, type Item, type TimelineItem as DisplayItem } from '../../../packages/remote/web/timeline.ts';
import { t, dictionaries, lang, type Key } from '../../../packages/remote/web/i18n.ts';
import { remote } from './client';
import { copy, Field, useStyles } from './ui';
import { Icon, toolIconName } from './icons';
import { Markdown } from './markdown';
import { StateRing } from './mascot';
import { mono, shadow } from './theme';
import { activitySummary } from '../../../packages/remote/src/tool-details.ts';
import type { ActivityRow, ToolView } from '../../../packages/remote/web/timeline.ts';
import { loadEventText, ToolSheet } from './tool-sheet';
import { useTextReveal } from './text-reveal';

export const TimelineItem = React.memo(TimelineRow, (before, after) => before.session === after.session && before.readOnly === after.readOnly && before.item.key === after.item.key && before.item.ver === after.item.ver);

const OpenTool = createContext<(row: ActivityRow) => void>(() => {});
/** Selection survives row virtualization; resolve it from the latest reduction on every update. */
export function TimelineTools({ items, session, children }: { items: DisplayItem[]; session: string; children: React.ReactNode }) {
  const [selected, setSelected] = useState<ActivityRow | null>(null);
  const id = selected?.type === 'tool' ? selected.tool.id : selected?.toolUseId;
  const rows: ActivityRow[] = items.flatMap(item => item.type === 'toolGroup' ? item.rows : item.type === 'assistant' ? item.tools.map(tool => ({ type: 'tool' as const, tool })) : item.type === 'subagent' ? [item] : []);
  const current = rows.find(row => (row.type === 'tool' ? row.tool.id : row.toolUseId) === id) ?? selected;
  const tool: ToolView | null = current?.type === 'tool' ? current.tool : current ? current.call ?? { id: current.toolUseId, name: 'Agent', summary: current.description, ...(current.status !== 'running' ? { result: { ok: current.status === 'done', text: '' } } : {}) } : null;
  useEffect(() => setSelected(null), [session]);
  return <OpenTool.Provider value={setSelected}>{children}{tool && <ToolSheet key={tool.id} tool={tool} session={session} onClose={() => setSelected(null)} worker={current?.type === 'subagent' ? <Worker item={current} session={session} initiallyOpen /> : undefined} />}</OpenTool.Provider>;
}
export function EventText({ value, session, markdown = false, mono: monoText = false, streaming = false, initiallyExpanded = false }: { value: WireText; session: string; markdown?: boolean; mono?: boolean; streaming?: boolean; initiallyExpanded?: boolean }) {
  const { c } = useStyles();
  const [full, setFull] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const revealed = useTextReveal(typeof value === 'string' ? value : value.preview, streaming);
  const draw = (text: string) => markdown ? <Markdown text={text} caret={streaming} /> : <Text selectable style={monoText ? { fontFamily: mono, fontSize: 12.5, lineHeight: 19, color: c.ink2 } : { fontSize: 16, lineHeight: 25.6, color: c.ink }}>{text}</Text>;
  if (typeof value === 'string') {
    if (!value && !streaming) return null;
    const long = !markdown && (value.length > 1200 || value.split('\n').length > 12);
    return <View style={{ gap: 6 }}>{draw(long && !expanded ? revealed.slice(0, 1200).split('\n').slice(0, 12).join('\n') + '\n…' : revealed)}{long && <Pressable accessibilityRole="button" onPress={() => setExpanded(!expanded)}><Text style={{ fontSize: 13, fontWeight: '600', color: c.accent, paddingVertical: 4 }}>{expanded ? t('tool.less') : t('perm.showAll')}</Text></Pressable>}</View>;
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

function ConversationImage({ part, session }: { part: ImagePart; session: string }) {
  const { c } = useStyles();
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(!part.blob);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setUri(null); setFailed(!part.blob);
    if (!part.blob) return;
    void (async () => {
      try {
        let offset = 0, base64 = '';
        for (;;) {
          const chunk = await remote.request({ op: 'blob', session, id: part.blob!, offset }) as BlobChunk;
          if (cancelled) return;
          base64 += chunk.text;
          if (chunk.next === null) break;
          offset = chunk.next;
        }
        setUri(`data:${part.mediaType};base64,${base64}`);
      } catch (error) { if (!cancelled) { setFailed(true); remote.report(error); } }
    })();
    return () => { cancelled = true; };
  }, [session, part.blob, part.mediaType]);
  const label = copy('이미지를 표시할 수 없습니다', 'Image unavailable');
  return <View style={{ marginVertical: 6 }}>
    {uri && !failed ? <Pressable accessibilityRole="button" accessibilityLabel={copy('이미지 크게 보기', 'View full image')} onPress={() => setOpen(true)}>
      <Image source={{ uri }} resizeMode="contain" onError={() => setFailed(true)} style={{ width: 240, maxWidth: '100%', height: 180, borderRadius: 12, backgroundColor: c.sunk }} />
    </Pressable> : <Text style={{ fontSize: 12.5, color: c.muted, padding: 8 }}>{failed ? label : t('tool.loading')}</Text>}
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <View style={{ flex: 1, backgroundColor: '#000', paddingTop: 60, paddingBottom: 40 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('a11y.close')} onPress={() => setOpen(false)} style={{ alignSelf: 'flex-end', padding: 16 }}><Text style={{ color: '#fff', fontSize: 17 }}>{t('a11y.close')}</Text></Pressable>
        <ScrollView maximumZoomScale={5} minimumZoomScale={1} centerContent contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
          {uri && <Image source={{ uri }} resizeMode="contain" style={{ width: '100%', height: 600 }} />}
        </ScrollView>
      </View>
    </Modal>
  </View>;
}
function ConversationImages({ images, session }: { images?: ImagePart[]; session: string }) {
  return <>{images?.map((part, i) => <ConversationImage key={`${part.blob ?? 'missing'}-${i}`} part={part} session={session} />)}</>;
}

function ToolRow({ tool }: { tool: ToolView }) {
  const { c } = useStyles();
  const open = useContext(OpenTool);
  const status = !tool.result ? <Icon name="clock" size={15} color={c.faint} /> : tool.result.ok ? <Icon name="check" size={15} color={c.ok} /> : <Icon name="x" size={15} color={c.bad} />;
  return <Pressable accessibilityRole="button" accessibilityLabel={`${tool.name} ${tool.summary}`} onPress={() => open({ type: 'tool', tool })} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
    <Icon name={toolIconName(tool.name)} size={16} color={c.ink2} />
    <Text style={{ fontSize: 13.5, fontWeight: '700', color: c.ink }}>{tool.name}</Text>
    <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, fontFamily: mono, fontSize: 12.5, color: c.muted }}>{tool.summary}</Text>
    {status}<Icon name="chevron" size={14} color={c.muted} />
  </Pressable>;
}
function CopyAnswer({ value, session }: { value: WireText; session: string }) {
  const { c } = useStyles();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const copyText = async () => {
    setBusy(true);
    try {
      Clipboard.setString(await loadEventText(value, session));
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1400);
    } catch (e) { remote.report(e); }
    finally { setBusy(false); }
  };
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}><Pressable accessibilityRole="button" accessibilityLabel={copy('답변 복사', 'Copy answer')} disabled={busy} onPress={() => { void copyText(); }} style={{ padding: 10 }}><Icon name="copy" size={17} color={c.muted} /></Pressable>{copied && <Text accessibilityLiveRegion="polite" style={{ fontSize: 12.5, color: c.bg, backgroundColor: c.ink, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 8 }}>{copy('복사됨', 'Copied')}</Text>}</View>;
}

function Worker({ item, session, initiallyOpen = false }: { item: Extract<Item, { type: 'subagent' }>; session: string; initiallyOpen?: boolean }) {
  const { c } = useStyles();
  const [items, setItems] = useState<DisplayItem[] | null>(null);
  const load = async () => {
    try {
      let events: SubPage['events'] = [], afterSeq = 0;
      for (;;) {
        const page = await remote.request({ op: 'sub', session, sub: item.sub, afterSeq }) as SubPage;
        events = [...events, ...page.events];
        if (!page.more || !page.events.length) break;
        afterSeq = page.events.at(-1)!.seq;
      }
      setItems(timelineItems(reduce(events)));
    } catch (e) { remote.report(e); }
  };
  useEffect(() => {
    if (!initiallyOpen && !items) return;
    void load();
  }, [item.sub, item.steps, item.status, initiallyOpen]);
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

function TimelineRow({ item, session, readOnly }: { item: DisplayItem; session: string; readOnly: boolean }) {
  const { c, s } = useStyles();
  const openTool = useContext(OpenTool);
  const [expanded, setExpanded] = useState(item.type === 'permission');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [free, setFree] = useState<Record<string, string>>({});
  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const decision = item.type === 'permission' ? item.decision : null;
  useEffect(() => {
    if (decision) { pending.current = false; setSending(false); if (timer.current) clearTimeout(timer.current); }
  }, [decision]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const host = remote.snapshot.host?.name ?? t('host.fallback');
  if (item.type === 'toolGroup') {
    const summary = activitySummary(item.rows, item.running, lang());
    const label = summary.text;
    return <View style={{ gap: 4 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
        {item.running ? <ActivityIndicator size="small" color={c.muted} /> : <Icon name="terminal" size={16} color={c.ink2} />}
        <Text style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: c.muted }}>{label}</Text>
        {(summary.added > 0 || summary.removed > 0) && <View style={{ flexDirection: 'row', gap: 4 }}><Text style={{ color: c.ok, backgroundColor: c.okSoft, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 2, fontFamily: mono, fontSize: 12.5 }}>+{summary.added}</Text><Text style={{ color: c.bad, backgroundColor: c.badSoft, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 2, fontFamily: mono, fontSize: 12.5 }}>−{summary.removed}</Text></View>}
        {summary.failed && <Icon name="x" size={16} color={c.bad} />}
        <View style={expanded ? { transform: [{ rotate: '90deg' }] } : undefined}><Icon name="chevron" size={16} color={c.muted} /></View>
      </Pressable>
      {expanded && item.rows.map(row => row.type === 'tool' ? <ToolRow key={row.tool.id} tool={row.tool} /> : <Pressable key={row.key} accessibilityRole="button" accessibilityLabel={row.description} onPress={() => openTool(row)} style={{ flexDirection: 'row', gap: 8, alignItems: 'center', padding: 10, minHeight: 44 }}><StateRing state={row.status === 'running' ? 'running' : row.status === 'done' ? 'idle' : 'error'} size={20} /><Text style={{ flex: 1, color: c.ink2 }}>{row.description}</Text><Icon name="chevron" size={16} color={c.muted} /></Pressable>)}
    </View>;
  }
  if (item.type === 'start') return <Text style={{ alignSelf: 'center', fontSize: 12.5, color: c.faint, paddingVertical: 4 }}>{t('history.start')}</Text>;
  if (item.type === 'user') return <View style={{ alignSelf: 'flex-end', maxWidth: '86%', backgroundColor: c.userBg, paddingVertical: 10, paddingHorizontal: 14, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderBottomLeftRadius: 20, borderBottomRightRadius: 6, opacity: item.queued ? 0.72 : 1 }}>
    <Text selectable style={{ fontSize: 16, lineHeight: 24, color: c.ink }}>{item.text}</Text>
    <ConversationImages images={item.images} session={session} />
    {item.queued && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4, justifyContent: 'flex-end' }}><Icon name="clock" size={13} color={c.muted} /><Text style={{ fontSize: 12.5, color: c.muted }}>{t(`queue.${item.queued}`)}</Text></View>}
  </View>;
  if (item.type === 'thinking') return <View style={{ gap: 8 }}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(v => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 }}><Icon name="clock" size={16} color={c.muted} /><Text style={{ color: c.muted, fontSize: 13.5 }}>{copy('사고 과정', 'Thinking')}</Text><Icon name={expanded ? 'down' : 'chevron'} size={15} color={c.muted} /></Pressable>
    {expanded && <View style={{ paddingLeft: 12, borderLeftWidth: 2, borderColor: c.line2 }}><EventText value={item.text} session={session} streaming={item.streaming} /></View>}
  </View>;
  if (item.type === 'assistant') return <View>
    <EventText value={item.text} session={session} markdown streaming={item.streaming} />
    <ConversationImages images={item.images} session={session} />
    {!item.streaming && (typeof item.text !== 'string' || !!item.text.trim()) && <CopyAnswer value={item.text} session={session} />}
    {item.tools.length > 0 && <View style={{ gap: 4, marginTop: 8 }}>{item.tools.map(tool => <ToolRow key={tool.id} tool={tool} />)}</View>}
  </View>;
  if (item.type === 'permission') {
    const answers = Object.fromEntries((item.questions ?? []).map(q => [q.question, [...(selected[q.question] ?? []), ...(free[q.question]?.trim() ? [free[q.question]!.trim()] : [])].join(', ')]));
    const incomplete = item.requestKind === 'question' && (item.questions ?? []).some(q => !answers[q.question]);
    const decide = async (decision: 'allow' | 'allow_always' | 'deny') => {
      if (pending.current) return;
      pending.current = true; setSending(true); setError('');
      const fail = (e: unknown) => { pending.current = false; setSending(false); setError(e instanceof Error ? e.message : String(e)); if (timer.current) clearTimeout(timer.current); };
      timer.current = setTimeout(() => fail(copy('결정 확인이 도착하지 않았습니다. 다시 시도하십시오.', 'No decision arrived. Please retry.')), 15_000);
      try { await remote.command({ t: 'decide', session, id: item.id, decision, ...(message.trim() ? { message: message.trim() } : {}), ...(item.requestKind === 'question' && decision !== 'deny' ? { answers } : {}) }); }
      catch (e) { if (pending.current) fail(e); }
    };
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
        {why in dictionaries[lang()] && <Text style={{ fontSize: 12.5, color: c.muted }}>{t(why as Key, { host })}</Text>}
      </View>;
    }
    return <View style={{ backgroundColor: c.surface, borderWidth: 1.5, borderColor: c.warnRing, borderRadius: 20, paddingTop: 14, paddingHorizontal: 14, paddingBottom: 12, ...shadow(c) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name="shield" size={16} color={c.warn} /><Text style={{ fontSize: 13, fontWeight: '700', color: c.warn }}>{item.tool}</Text></View>
      <Text style={{ fontSize: 17, fontWeight: '700', lineHeight: 23, marginTop: 6, marginBottom: 8, color: c.ink }}>{item.title || t('perm.title', { tool: item.tool })}</Text>
      <View style={{ backgroundColor: c.sunk, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 11 }}>
        {item.requestKind === 'plan' ? <EventText value={item.input} session={session} markdown /> : expanded ? <EventText value={item.input} session={session} mono initiallyExpanded /> : <Text selectable numberOfLines={5} style={{ fontFamily: mono, fontSize: 13, lineHeight: 19.5, color: c.ink2 }}>{item.summary}</Text>}
      </View>
      <Pressable accessibilityRole="button" onPress={() => setExpanded(!expanded)}><Text style={{ fontSize: 13, fontWeight: '600', color: c.accent, paddingTop: 6 }}>{expanded ? t('tool.less') : t('perm.showAll')}</Text></Pressable>
      {item.requestKind === 'plan' && <Field value={message} onChangeText={setMessage} editable={!sending} placeholder={copy('계속 계획할 내용 (선택)', 'Planning feedback (optional)')} />}
      {item.questions?.map(q => <View key={q.question} style={{ gap: 8, marginTop: 12 }}>
        <Text style={{ color: c.ink, fontWeight: '700', fontSize: 15 }}>{q.header} · {q.question}</Text>
        {q.options.map(option => {
          const on = selected[q.question]?.includes(option.label) ?? false;
          return <Pressable key={option.label} disabled={sending} accessibilityRole={q.multiSelect ? 'checkbox' : 'radio'} accessibilityState={{ checked: on }} onPress={() => {
            setSelected(prev => ({ ...prev, [q.question]: q.multiSelect ? on ? (prev[q.question] ?? []).filter(v => v !== option.label) : [...(prev[q.question] ?? []), option.label] : [option.label] }));
            if (!q.multiSelect) setFree(prev => ({ ...prev, [q.question]: '' }));
          }} style={{ padding: 10, borderRadius: 10, borderWidth: 1, borderColor: on ? c.accent : c.line }}>
            <Text style={{ color: c.ink }}>{on ? '✓ ' : ''}{option.label}</Text><Text style={{ color: c.muted, fontSize: 12.5 }}>{option.description}</Text>
          </Pressable>;
        })}
        <Field value={free[q.question] ?? ''} editable={!sending} placeholder={copy('직접 입력', 'Your own answer')} onChangeText={value => { setFree(prev => ({ ...prev, [q.question]: value })); if (!q.multiSelect) setSelected(prev => ({ ...prev, [q.question]: [] })); }} />
      </View>)}
      {sending && <Text style={{ color: c.muted, marginTop: 8 }}>{copy('보내는 중…', 'Sending…')}</Text>}
      {!!error && <Text accessibilityRole="alert" style={{ color: c.bad, marginTop: 8 }}>{error}</Text>}
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('perm.deny')} disabled={sending} onPress={() => { void decide('deny'); }} style={({ pressed }) => [{ flex: 1, height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface2 }, pressed && s.pressed]}><Text style={{ fontSize: 17, fontWeight: '700', color: c.ink }}>{item.requestKind === 'plan' ? copy('계속 계획', 'Keep planning') : t('perm.deny')}</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t('perm.allow')} disabled={sending || incomplete} onPress={() => { void decide('allow'); }} style={({ pressed }) => [{ flex: 1.35, height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, backgroundColor: c.accentStrong }, pressed && s.pressed]}><Icon name="check" size={20} color={c.accentInk} /><Text style={{ fontSize: 17, fontWeight: '700', color: c.accentInk }}>{item.requestKind === 'plan' ? copy('구현', 'Implement') : item.requestKind === 'question' ? copy('답변 보내기', 'Submit answers') : t('perm.allow')}</Text></Pressable>
      </View>
      {item.canAlways && <Pressable accessibilityRole="button" disabled={sending} onPress={() => { void decide('allow_always'); }} style={{ height: 36, marginTop: 8, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 14, fontWeight: '600', color: c.muted }}>{t('perm.always')}</Text></Pressable>}
    </View>;
  }
  if (item.type === 'subagent') return <Worker item={item} session={session} />;
  if (item.type === 'result') return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -6 }}>{!item.ok && <Icon name="x" size={14} color={c.bad} />}<Text style={{ fontSize: 12.5, color: item.ok ? c.muted : c.bad }}>{item.ok ? copy('작업을 마쳤습니다', 'Work finished') : t('turn.failed', { error: item.error ?? '' })} · {item.model} · {Math.round(item.ms / 1000)}s</Text></View>;
  const key = `notice.${item.code}`;
  return <Text style={{ alignSelf: 'center', fontSize: 13, color: c.muted, backgroundColor: c.surface2, paddingVertical: 5, paddingHorizontal: 12, borderRadius: 99, overflow: 'hidden', textAlign: 'center', maxWidth: '92%' }}>{key in dictionaries[lang()] ? t(key as Key, { text: item.text ?? '', host }) : item.text ?? item.code}</Text>;
}
