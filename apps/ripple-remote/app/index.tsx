import React from 'react';
import { ScrollView, Text, Pressable, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { Button, Label, copy, s, useRemote } from '../src/ui';
import { t } from '../../../packages/remote/web/i18n.ts';
import { remote } from '../src/client';
import type { SessionSummary } from '../../../packages/remote/src/protocol.ts';
function SessionRow({ session }: { session: SessionSummary }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={session.title} onPress={() => router.push({ pathname: '/session/[id]', params: { id: session.id } })} style={s.card}>
    <View style={s.row}><Text style={[s.body, { fontWeight: '600', flex: 1 }]} numberOfLines={2}>{session.title}</Text><Text style={s.muted}>{t(`state.${session.state}`)}</Text></View>
    <Text style={s.muted} numberOfLines={1}>{session.cwd}</Text>
    <Text style={s.muted}>{session.model} · {new Date(session.updatedAt).toLocaleString()}{session.readOnly ? ` · ${copy('읽기 전용', 'Read only')}` : ''}</Text>
    {session.pending > 0 && <Text style={s.warning}>{t('home.waiting')} · {session.pending}</Text>}
  </Pressable>;
}
export default function Home() {
  const state = useRemote();
  if (!state.paired) return <Redirect href="/pair" />;
  const host = state.sessions.filter(s => s.origin !== 'desktop');
  const desktop = state.sessions.filter(s => s.origin === 'desktop');
  return <ScrollView style={s.page} contentContainerStyle={s.content}>
    <View style={s.row}><Text style={[s.title, { flex: 1 }]}>{t('home.title')}</Text><Button title={t('a11y.settings')} secondary onPress={() => router.push('/settings')} /></View>
    <Button title={t('home.empty.title')} onPress={() => router.push('/new')} />
    {!state.sessions.length && <View style={s.card}><Text style={s.body}>{state.status?.state === 'open' ? t('home.empty.body') : t('conn.connecting')}</Text></View>}
    {state.pending.map(p => <View key={p.message.clientMsgId} style={s.card}><Text style={s.body}>{p.message.text}</Text><Text style={p.error ? s.warning : s.muted}>{p.error ?? t('queue.pending')}</Text>{p.error && <Button title={t('conn.retryNow')} secondary onPress={() => { void remote.retryPending(p.message.clientMsgId).catch(e => remote.report(e)); }} />}<Button title={copy('대기 메시지 제거', 'Remove queued message')} secondary onPress={() => { void remote.discardPending(p.message.clientMsgId).catch(e => remote.report(e)); }} /></View>)}
    <Label>{copy('호스트 세션', 'Host sessions')}</Label>
    {host.map(session => <SessionRow key={session.id} session={session} />)}
    <Label>{copy('Mac 세션', 'Mac sessions')}</Label>
    {desktop.map(session => <SessionRow key={session.id} session={session} />)}
    {!desktop.length && <Text style={s.muted}>{copy('Mac 세션이 없습니다. 호스트 업데이트 후 최근 대화가 표시됩니다.', 'No Mac sessions. Recent conversations appear after the host is updated.')}</Text>}
  </ScrollView>;
}
