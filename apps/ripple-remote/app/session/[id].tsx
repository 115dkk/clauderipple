import React, { useEffect, useRef, useState } from 'react';
import { Alert, Keyboard, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { remote } from '../../src/client';
import { Button, Composer, ConnectionBanner, Frame, IconButton, copy, useKeyboardOpen, useNow, useRemote, useStyles } from '../../src/ui';
import { StateRing } from '../../src/mascot';
import { Icon } from '../../src/icons';
import { radius } from '../../src/theme';
import { TimelineItem } from '../../src/timeline';
import { reduce, timelineItems } from '../../../../packages/remote/web/timeline.ts';
import { t } from '../../../../packages/remote/web/i18n.ts';
import { clock, duration, folderName } from '../../../../packages/remote/web/dom.ts';
import { ModePicker, modeLabel, rememberMode } from '../../src/mode';
import type { PermissionMode } from '../../../../packages/remote/src/protocol.ts';
export default function Session() {
  const { c, s } = useStyles();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardOpen();
  const now = useNow();
  const { id } = useLocalSearchParams<{ id: string }>();
  const state = useRemote();
  const [text, setText] = useState('');
  const [tasksOpen, setTasksOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const [modeBusy, setModeBusy] = useState(false);
  const [modeError, setModeError] = useState('');
  const modeSending = useRef(false);
  const changeMode = async (mode: PermissionMode) => {
    if (modeSending.current) return;
    modeSending.current = true; setModeBusy(true); setModeError('');
    try { await remote.command({ t: 'set_mode', sessionId: id, mode }); await rememberMode(mode); setModeOpen(false); }
    catch (e) { setModeError(e instanceof Error ? e.message : String(e)); }
    finally { modeSending.current = false; setModeBusy(false); }
  };
  const [commands, setCommands] = useState<string[] | null>(null);
  // "/" at the start, before any space: the session's slash commands, as the app's composer offers them.
  const slash = /^\/(\S*)$/.exec(text)?.[1]?.toLowerCase() ?? null;
  const matches = slash === null || !commands ? [] : commands
    .filter(name => name.toLowerCase().includes(slash))
    .sort((a, b) => Number(!b.toLowerCase().startsWith(slash)) - Number(!a.toLowerCase().startsWith(slash)));
  useEffect(() => { setCommands(null); }, [id]);
  useEffect(() => {
    if (slash === null || commands) return;
    remote.request({ op: 'commands', session: id }).then(list => setCommands(Array.isArray(list) ? list as string[] : []), () => setCommands([]));
  }, [slash === null, commands, id]);
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
  const send = async () => { const value = text.trim(); if (!value) return; try { await remote.queue({ t: 'send', session: id, text: value }); setText(''); } catch (e) { remote.report(e); } };
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
      <View style={s.topTitle}>
        <Text style={s.topB} numberOfLines={1}>{session ? session.title || folderName(session.cwd) : t('tool.loading')}</Text>
        <Text style={s.topSub} numberOfLines={1}>{model}{effort && !readOnly ? ` · ${t(`effort.${effort}`)}` : ''}</Text>
      </View>
      <View style={[s.iconBtn, !live && { opacity: 0.45 }]} accessibilityLabel={t(`state.${sessionState}`)}><StateRing state={readOnly ? 'stopped' : sessionState} size={24} /></View>
    </View>
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
      {!readOnly && matches.length > 0 && <View style={{ marginHorizontal: 6, marginBottom: 8, maxHeight: 264, borderRadius: radius.sm, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, overflow: 'hidden' }}>
        <ScrollView keyboardShouldPersistTaps="handled">
          {matches.map((name, i) => <Pressable key={name} accessibilityRole="button" accessibilityLabel={`/${name}`} onPress={() => setText(`/${name} `)}
            style={({ pressed }) => ({ paddingVertical: 10, paddingHorizontal: 12, borderTopWidth: i ? 1 : 0, borderColor: c.line, backgroundColor: pressed ? c.surface2 : 'transparent' })}>
            <Text numberOfLines={1} style={{ fontSize: 15, color: c.ink }}><Text style={{ color: c.muted }}>/</Text>{name}</Text>
          </Pressable>)}
        </ScrollView>
      </View>}
      {!readOnly && session && <View style={{ marginHorizontal: 6, marginBottom: 8, gap: 8 }}>
        <Pressable accessibilityRole="button" disabled={modeBusy} onPress={() => setModeOpen(v => !v)} style={{ alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.sm, backgroundColor: c.surface2 }}>
          <Text style={{ color: c.ink2, fontSize: 13 }}>{modeBusy ? copy('변경 중…', 'Changing…') : session.desktopBridge || session.origin === 'desktop' ? copy('모드: Mac', 'Mode: Mac') : modeLabel(session.permissionMode ?? 'auto')}</Text>
        </Pressable>
        {modeOpen && !modeBusy && <ModePicker value={session.permissionMode ?? 'auto'} onChange={mode => {
          if (mode !== 'bypassPermissions') { void changeMode(mode); return; }
          Alert.alert(modeLabel(mode), copy('경고: 승인 없이 모든 도구를 실행합니다.', 'Warning: all tools run without approval.'), [
            { text: copy('취소', 'Cancel'), style: 'cancel' },
            { text: copy('모두 허용', 'Bypass'), style: 'destructive', onPress: () => { void changeMode(mode); } },
          ]);
        }} />}
        {!!modeError && <Text accessibilityRole="alert" style={{ color: c.bad, fontSize: 13 }}>{modeError}</Text>}
      </View>}
      {!readOnly && session && <Composer testID="session-composer" value={text} onChangeText={setText} placeholder={t('composer.reply')} canSend={!!text.trim()} onSend={() => { void send(); }}
        onStop={['running', 'starting', 'waiting'].includes(session.state) ? () => { try { remote.send({ t: 'interrupt', session: id }); } catch (e) { remote.report(e); } } : undefined} />}
    </View>
  </Frame>;
}
