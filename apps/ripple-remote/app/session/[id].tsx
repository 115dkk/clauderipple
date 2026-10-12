import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { remote } from '../../src/client';
import { Button, Composer, ConnectionBanner, Frame, IconButton, copy, useKeyboardOpen, useNow, useRemote, useStyles } from '../../src/ui';
import { StateRing } from '../../src/mascot';
import { Icon } from '../../src/icons';
import { TimelineItem } from '../../src/timeline';
import { reduce } from '../../../../packages/remote/web/timeline.ts';
import { t } from '../../../../packages/remote/web/i18n.ts';
import { clock, duration, folderName } from '../../../../packages/remote/web/dom.ts';
export default function Session() {
  const { c, s } = useStyles();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardOpen();
  const now = useNow();
  const { id } = useLocalSearchParams<{ id: string }>();
  const state = useRemote();
  const [text, setText] = useState('');
  const session = state.sessions.find(s => s.id === id);
  const history = state.histories[id];
  const view = reduce(history?.events ?? [], remote.outgoing(id), !history?.hasOlder);
  const readOnly = session?.readOnly === true && session?.origin !== 'desktop';
  useEffect(() => { remote.open(id); }, [id]);
  const send = async () => { const value = text.trim(); if (!value) return; try { await remote.queue({ t: 'send', session: id, text: value }); setText(''); } catch (e) { remote.report(e); } };
  const link = state.status;
  const live = link?.state === 'open';
  const model = view.model ?? session?.model ?? '';
  const effort = view.effort ?? session?.effort ?? null;
  const sessionState = view.open.length ? 'waiting' : view.state ?? session?.state ?? 'stopped';
  const running = view.state === 'running' || view.state === 'starting';
  const f = view.figures;
  const tone = (v: number | null) => v === null ? c.accent : v >= 85 ? c.bad : v >= 65 ? c.warn : c.accent;
  const cell = (label: string, value: string | null, pct: number | null, first = false, bar = false) => <View key={label} style={{ flex: 1, minWidth: 0, paddingTop: 7, paddingHorizontal: 10, paddingBottom: 8 }}>
    {!first && <View style={{ position: 'absolute', left: 0, top: 10, bottom: 10, borderLeftWidth: 1, borderColor: c.line }} />}
    <Text numberOfLines={1} style={{ fontSize: 11.5, lineHeight: 15, fontWeight: '500', color: c.muted }}>{label}</Text>
    <Text numberOfLines={1} style={{ fontSize: 15.5, fontWeight: '700', lineHeight: 19, color: value === null ? c.faint : c.ink, fontVariant: ['tabular-nums'] }}>{value ?? '—'}</Text>
    {bar && <View style={{ height: 3, borderRadius: 3, backgroundColor: c.sunk, marginTop: 4, overflow: 'hidden' }}><View style={{ height: '100%', width: `${pct === null ? 0 : Math.min(100, Math.max(2, pct))}%`, backgroundColor: tone(pct), borderRadius: 3 }} /></View>}
  </View>;
  const pct = (v: number | null | undefined) => v === null || v === undefined ? null : `${Math.round(v)}%`;
  return <Frame><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View style={s.top}>
      <IconButton name="back" label={t('a11y.back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      <View style={s.topTitle}>
        <Text style={s.topB} numberOfLines={1}>{session ? folderName(session.cwd) : t('tool.loading')}</Text>
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
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 8, paddingHorizontal: 16, paddingBottom: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
      {history?.hasOlder && <Button title={t('history.loading')} ghost onPress={() => { try { remote.older(id); } catch (e) { remote.report(e); } }} />}
      {view.items.map(item => <TimelineItem key={item.key} item={item} session={id} readOnly={readOnly} />)}
    </ScrollView>
    <View style={[s.dock, { paddingBottom: keyboard ? 10 : insets.bottom + 10 }]}>
      {readOnly && <Text style={{ fontSize: 12.5, color: c.muted, textAlign: 'center', marginBottom: 2 }}>{copy('Mac에서 진행한 대화입니다. 이 앱에서는 읽기만 가능합니다.', 'This conversation ran on your Mac. It is read-only here.')}</Text>}
      {!readOnly && running && !view.open.length && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 6, marginBottom: 8 }}>
        {live ? <StateRing state="running" size={16} spin /> : <Icon name="clock" size={16} color={c.warn} />}
        <Text style={{ fontSize: 13.5, color: live ? c.muted : c.warn }}>{live ? t('running.for', { t: duration(now - (view.turnStartedAt ?? now)) }) : t('running.lastSeen', { time: clock(link?.lastRx ?? now) })}</Text>
      </View>}
      {!readOnly && session && <Composer testID="session-composer" value={text} onChangeText={setText} placeholder={t('composer.reply')} canSend={!!text.trim()} onSend={() => { void send(); }}
        onStop={['running', 'starting', 'waiting'].includes(session.state) ? () => { try { remote.send({ t: 'interrupt', session: id }); } catch (e) { remote.report(e); } } : undefined} />}
    </View>
  </KeyboardAvoidingView></Frame>;
}
