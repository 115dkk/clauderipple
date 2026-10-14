import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { remote } from '../../src/client';
import { Button, ConnectionBanner, Frame, IconButton, copy, useKeyboardOpen, useNow, useRemote, useStyles } from '../../src/ui';
import { StateRing } from '../../src/mascot';
import { Icon } from '../../src/icons';
import { radius } from '../../src/theme';
import { TimelineItem } from '../../src/timeline';
import { reduce, timelineItems } from '../../../../packages/remote/web/timeline.ts';
import { t } from '../../../../packages/remote/web/i18n.ts';
import { clock, duration, folderName } from '../../../../packages/remote/web/dom.ts';
import { SessionComposer } from '../../src/composer';
export default function Session() {
  const { c, s } = useStyles();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardOpen();
  const now = useNow();
  const { id } = useLocalSearchParams<{ id: string }>();
  const state = useRemote();
  const [tasksOpen, setTasksOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const session = state.sessions.find(s => s.id === id);
  const history = state.histories[id];
  const view = reduce(history?.events ?? [], remote.outgoing(id), !history?.hasOlder);
  const readOnly = session?.readOnly === true && session?.origin !== 'desktop';
  const scroll = useRef<ScrollView>(null);
  const pinned = useRef(true);
  const dragging = useRef(false);
  const follow = () => { if (pinned.current) scroll.current?.scrollToEnd({ animated: false }); };
  useEffect(() => { pinned.current = true; dragging.current = false; remote.open(id); }, [id]);
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => {
      pinned.current = true;
      dragging.current = false;
      scroll.current?.scrollToEnd({ animated: false });
    });
    return () => shown.remove();
  }, []);
  const switchSession = (next: string) => { setSessionsOpen(false); router.replace({ pathname: '/session/[id]', params: { id: next } }); };
  const link = state.status;
  const live = link?.state === 'open';
  const model = view.model ?? session?.model ?? '';
  const effort = view.effort ?? session?.effort ?? null;
  const mainState = session?.desktopBridge ? session.state : view.state ?? session?.state ?? 'stopped';
  const sessionState = session?.desktopBridge ? mainState : view.open.length ? 'waiting' : mainState;
  const running = mainState === 'running' || mainState === 'starting';
  const f = view.figures;
  const tone = (v: number | null) => v === null ? c.accent : v >= 85 ? c.bad : v >= 65 ? c.warn : c.accent;
  const cell = (label: string, value: string | null, pct: number | null, first = false, bar = false) => <View key={label} style={{ flex: 1, minWidth: 0, paddingTop: 7, paddingHorizontal: 10, paddingBottom: 8 }}>
    {!first && <View style={{ position: 'absolute', left: 0, top: 10, bottom: 10, borderLeftWidth: 1, borderColor: c.line }} />}
    <Text numberOfLines={1} style={{ fontSize: 11.5, lineHeight: 15, fontWeight: '500', color: c.muted }}>{label}</Text>
    <Text numberOfLines={1} style={{ fontSize: 15.5, fontWeight: '700', lineHeight: 19, color: value === null ? c.faint : c.ink, fontVariant: ['tabular-nums'] }}>{value ?? '—'}</Text>
    {bar && <View style={{ height: 3, borderRadius: 3, backgroundColor: c.sunk, marginTop: 4, overflow: 'hidden' }}><View style={{ height: '100%', width: `${pct === null ? 0 : Math.min(100, Math.max(2, pct))}%`, backgroundColor: tone(pct), borderRadius: 3 }} /></View>}
  </View>;
  const pct = (v: number | null | undefined) => v === null || v === undefined ? null : `${Math.round(v)}%`;
  return <Frame avoidKeyboard>
    <View style={s.top}>
      <IconButton name="back" label={t('a11y.back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: sessionsOpen }} onPress={() => setSessionsOpen(v => !v)} style={s.topTitle}>
        <Text style={s.topB} numberOfLines={1}>{session ? session.title || folderName(session.cwd) : t('tool.loading')} ▾</Text>
        <Text style={s.topSub} numberOfLines={1}>{model}{effort && !readOnly ? ` · ${t(`effort.${effort}`)}` : ''}</Text>
      </Pressable>
      <View style={[s.iconBtn, !live && { opacity: 0.45 }]} accessibilityLabel={t(`state.${sessionState}`)}><StateRing state={readOnly ? 'stopped' : sessionState} size={24} /></View>
    </View>
    {sessionsOpen && <ScrollView style={{ maxHeight: 320, backgroundColor: c.surface, borderBottomLeftRadius: 20, borderBottomRightRadius: 20 }} keyboardShouldPersistTaps="handled">
      <Button title={copy('새 세션', 'New session')} ghost onPress={() => { setSessionsOpen(false); router.replace('/new'); }} />
      {[...state.sessions].filter(x => x.id !== id).sort((a, b) => {
        const rank = (x: typeof a) => x.pending || x.state === 'waiting' ? 0 : ['running', 'starting'].includes(x.state) ? 1 : 2;
        return rank(a) - rank(b) || b.updatedAt - a.updatedAt;
      }).map(x => <Pressable key={x.id} accessibilityRole="button" onPress={() => switchSession(x.id)} style={{ padding: 12, borderTopWidth: 1, borderColor: c.line }}>
        <Text numberOfLines={1} style={{ color: c.ink, fontSize: 15 }}>{x.title || folderName(x.cwd)}</Text>
        <Text numberOfLines={1} style={{ color: c.muted, fontSize: 12 }}>{folderName(x.cwd)} · {t(`state.${x.pending ? 'waiting' : x.state}`)} · {duration(Math.max(0, now - x.updatedAt))} {copy('전', 'ago')}</Text>
      </Pressable>)}
    </ScrollView>}
    {f && <View style={[{ marginHorizontal: 12, marginBottom: 6, flexDirection: 'row', backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 14 }, !live && { opacity: 0.55 }]}>
      {cell(t('band.effort'), f.effort ? t(`effort.${f.effort}`) : null, null, true)}
      {cell(t('band.cache'), pct(f.cachePct), null)}
      {cell(t('band.context'), pct(f.contextPct), f.contextPct ?? null, false, true)}
      {cell(t('band.fiveHour'), pct(f.fiveHourPct), f.fiveHourPct ?? null, false, true)}
    </View>}
    <ConnectionBanner />
    <ScrollView key={id} ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 8, paddingHorizontal: 16, paddingBottom: 16, gap: 14 }} keyboardShouldPersistTaps="handled"
      onContentSizeChange={follow} onLayout={follow} scrollEventThrottle={16}
      onScrollBeginDrag={() => { dragging.current = true; }}
      onScrollEndDrag={() => { dragging.current = false; }}
      onMomentumScrollBegin={() => { dragging.current = true; }}
      onMomentumScrollEnd={() => { dragging.current = false; }}
      onScroll={({ nativeEvent: e }) => {
        if (dragging.current) pinned.current = e.contentSize.height - e.contentOffset.y - e.layoutMeasurement.height < 80;
      }}>
      {history?.hasOlder && <Button title={t('history.loading')} ghost onPress={() => { try { remote.older(id); } catch (e) { remote.report(e); } }} />}
      {timelineItems(view).map(item => <TimelineItem key={item.key} item={item} session={id} readOnly={readOnly} />)}
    </ScrollView>
    <View style={[s.dock, { paddingBottom: keyboard ? 10 : insets.bottom + 10 }]}>
      {readOnly && <Text style={{ fontSize: 12.5, color: c.muted, textAlign: 'center', marginBottom: 2 }}>{copy('이 대화는 여기서 읽기만 가능합니다.', 'This conversation is read-only here.')}</Text>}
      {!readOnly && running && !view.open.length && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 6, marginBottom: 8 }}>
        {live ? <StateRing state="running" size={16} spin /> : <Icon name="clock" size={16} color={c.warn} />}
        <Text style={{ fontSize: 13.5, color: live ? c.muted : c.warn }}>{live ? t('running.for', { t: duration(now - (session?.turnStartedAt ?? view.turnStartedAt ?? now)) }) : t('running.lastSeen', { time: clock(link?.lastRx ?? now) })}</Text>
      </View>}
      {(session?.tasks ?? 0) > 0 && <>
        {tasksOpen && !!session!.taskList?.length && <View style={{ marginHorizontal: 6, marginBottom: 6, borderRadius: radius.sm, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
          {session!.taskList!.map((task, i) => <View key={task.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 10, borderTopWidth: i ? 1 : 0, borderColor: c.line }}>
            <Icon name={task.kind === 'shell' ? 'terminal' : 'model'} size={16} color={c.muted} />
            <Text numberOfLines={2} style={{ flex: 1, minWidth: 0, color: c.ink2, fontSize: 13.5 }}>{task.label}</Text>
            {task.startedAt !== null && <Text style={{ color: c.faint, fontSize: 12.5, fontVariant: ['tabular-nums'] }}>{duration(now - task.startedAt)}</Text>}
          </View>)}
        </View>}
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: tasksOpen }} disabled={!session!.taskList?.length} onPress={() => setTasksOpen(v => !v)}
          style={({ pressed }) => ({ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, marginHorizontal: 6, marginBottom: 8, paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.sm, backgroundColor: pressed ? c.sunk : c.surface2 })}>
          <Text style={{ color: c.muted, fontSize: 13 }}>{t('tasks.running', { n: session!.tasks! })}</Text>
          {!!session!.taskList?.length && <Icon name={tasksOpen ? 'down' : 'chevron'} size={14} color={c.muted} />}
        </Pressable>
      </>}
      {!readOnly && session && <SessionComposer key={id} session={session} busy={['running', 'starting', 'waiting'].includes(session.state)} connected={!!live} onSession={switchSession} />}
    </View>
  </Frame>;
}
