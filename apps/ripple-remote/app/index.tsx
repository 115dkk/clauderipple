import React from 'react';
import { ScrollView, Text, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Redirect, router } from 'expo-router';
import { Button, ConnectionBanner, Frame, IconButton, Label, LinkPill, List, copy, useNow, useRemote, useStyles } from '../src/ui';
import { Icon } from '../src/icons';
import { Ripple, StateRing } from '../src/mascot';
import { t } from '../../../packages/remote/web/i18n.ts';
import { folderName, relTime } from '../../../packages/remote/web/dom.ts';
import { remote } from '../src/client';
import type { SessionSummary } from '../../../packages/remote/src/protocol.ts';

function SessionRow({ session, first, now }: { session: SessionSummary; first: boolean; now: number }) {
  const { c } = useStyles();
  const waiting = session.pending > 0;
  const running = session.state === 'running' || session.state === 'starting';
  // Working shows as the spinning ripple on the left; only a waiting approval keeps a text tag.
  const tag = waiting ? `${t('state.waiting')}${session.pending > 1 ? ` ${session.pending}` : ''}` : '';
  return <Pressable accessibilityRole="button" accessibilityLabel={session.title} onPress={() => router.push({ pathname: '/session/[id]', params: { id: session.id } })}
    style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingLeft: 16, paddingRight: 14, minHeight: 68 }, pressed && { backgroundColor: c.surface2 }]}>
    {!first && <View style={{ position: 'absolute', left: 52, right: 0, top: 0, borderTopWidth: 1, borderColor: c.line }} />}
    <StateRing state={waiting ? 'waiting' : session.state} size={24} spin={running && !waiting} />
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: '600', lineHeight: 21, color: c.ink }}>{session.title}</Text>
      <View style={{ marginTop: 3, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text numberOfLines={1} style={{ fontSize: 13.5, color: c.muted, flexShrink: 0, maxWidth: '40%' }}>{folderName(session.cwd)}</Text>
        <Text style={{ fontSize: 13.5, color: c.muted, opacity: 0.5 }}>·</Text>
        <Text numberOfLines={1} style={{ fontSize: 13.5, color: c.muted, flexShrink: 1 }}>{session.model}</Text>
        <Text style={{ fontSize: 13.5, color: c.muted, opacity: 0.5 }}>·</Text>
        <Text numberOfLines={1} style={{ fontSize: 13.5, color: c.muted, flexShrink: 0 }}>{relTime(session.updatedAt, now)}</Text>
      </View>
    </View>
    {tag ? <View style={{ borderRadius: 99, paddingVertical: 3, paddingHorizontal: 9, backgroundColor: waiting ? c.warnSoft : c.accentSoft }}><Text style={{ fontSize: 12.5, fontWeight: '700', color: waiting ? c.warn : c.accent }}>{tag}</Text></View> : null}
  </Pressable>;
}

function Section({ title, sessions, now, waiting = false, stale }: { title: string; sessions: SessionSummary[]; now: number; waiting?: boolean; stale: boolean }) {
  const { s } = useStyles();
  if (!sessions.length) return null;
  return <>
    <Label count={waiting ? sessions.length : undefined}>{title}</Label>
    <List style={[waiting && s.listWaiting, stale && s.listStale]}>{sessions.map((session, i) => <SessionRow key={session.id} session={session} first={i === 0} now={now} />)}</List>
  </>;
}

export default function Home() {
  const state = useRemote();
  const { c, s } = useStyles();
  const insets = useSafeAreaInsets();
  const now = useNow(15000);
  if (!state.paired) return <Redirect href="/pair" />;
  const host = state.sessions.filter(x => x.origin !== 'desktop');
  const desktop = state.sessions.filter(x => x.origin === 'desktop');
  const waiting = host.filter(x => x.pending > 0);
  const active = host.filter(x => x.pending === 0 && (x.state === 'running' || x.state === 'starting'));
  const rest = host.filter(x => x.pending === 0 && x.state !== 'running' && x.state !== 'starting');
  // While the link is down the states below are the last ones seen, and look it.
  const stale = state.status?.state !== 'open';
  return <Frame>
    <View style={s.top}><LinkPill /><View style={s.spacer} /><IconButton name="gear" label={t('a11y.settings')} size={21} onPress={() => router.push('/settings')} /></View>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12 }}>
      <Text style={s.lt}>{t('home.title')}</Text>
      <ConnectionBanner />
      {state.pending.map(p => <View key={p.message.clientMsgId} style={[s.banner, { flexDirection: 'column', alignItems: 'stretch', gap: 8 }]}>
        <Text style={[s.bannerBody, { color: c.ink }]}>{p.message.text}</Text>
        <Text style={p.error ? { fontSize: 13, color: c.warn } : { fontSize: 13, color: c.muted }}>{p.error ?? t('queue.pending')}</Text>
        <View style={s.bannerAct}>
          {p.error && <Button title={t('conn.retryNow')} onPress={() => { void remote.retryPending(p.message.clientMsgId).catch(e => remote.report(e)); }} />}
          <Button title={copy('대기 메시지 제거', 'Remove queued message')} secondary onPress={() => { void remote.discardPending(p.message.clientMsgId).catch(e => remote.report(e)); }} />
        </View>
      </View>)}
      <Section title={t('home.waiting')} sessions={waiting} now={now} waiting stale={stale} />
      <Section title={t('home.active')} sessions={active} now={now} stale={stale} />
      <Section title={t('home.recent')} sessions={rest} now={now} stale={stale} />
      <Section title={t('home.desktop')} sessions={desktop} now={now} stale={stale} />
      {!desktop.length && <Text style={s.foot}>{copy('Mac 세션이 없습니다. 호스트 업데이트 후 최근 대화가 표시됩니다.', 'No Mac sessions. Recent conversations appear after the host is updated.')}</Text>}
      {!state.sessions.length && <View style={s.empty}>
        <Ripple face="calm" size={84} />
        <Text style={s.emptyB}>{t('home.empty.title')}</Text>
        <Text style={s.emptyP}>{state.status?.state === 'open' ? t('home.empty.body') : t('conn.connecting')}</Text>
        <View style={{ marginTop: 18 }}><Icon name="down" size={22} color={c.accent} /></View>
      </View>}
    </ScrollView>
    <View style={[s.dock, { paddingBottom: insets.bottom + 10 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('home.empty.title')} onPress={() => router.push('/new')} style={s.composer}>
        <Text numberOfLines={1} style={[s.composerInput, { color: c.muted, minHeight: 0 }]}>{t('composer.new')}</Text>
        <View style={[s.send, s.sendOff]}><Icon name="send" size={20} color={c.faint} /></View>
      </Pressable>
    </View>
  </Frame>;
}
