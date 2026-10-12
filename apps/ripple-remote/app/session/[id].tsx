import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { remote } from '../../src/client';
import { Button, Field, copy, s, useRemote } from '../../src/ui';
import { TimelineItem } from '../../src/timeline';
import { reduce } from '../../../../packages/remote/web/timeline.ts';
import { t } from '../../../../packages/remote/web/i18n.ts';
export default function Session() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const state = useRemote();
  const [text, setText] = useState('');
  const session = state.sessions.find(s => s.id === id);
  const history = state.histories[id];
  const view = reduce(history?.events ?? [], remote.outgoing(id), !history?.hasOlder);
  const readOnly = session?.readOnly === true || session?.origin === 'desktop';
  useEffect(() => { remote.open(id); }, [id]);
  const send = async () => { const value = text.trim(); if (!value) return; try { await remote.queue({ t: 'send', session: id, text: value }); setText(''); } catch (e) { remote.report(e); } };
  return <SafeAreaView style={s.page} edges={['bottom']}><Stack.Screen options={{ title: session?.title ?? t('home.title') }} /><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={120}>
    <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Text style={s.muted}>{session?.cwd}</Text><Text style={s.muted}>{session?.model} · {session ? t(`state.${session.state}`) : t('tool.loading')}</Text>
      {readOnly && <Text style={s.warning}>{copy('Mac에서 진행한 대화입니다. 이 앱에서는 읽기만 가능합니다.', 'This conversation ran on your Mac. It is read-only here.')}</Text>}
      {view.figures && <Text style={s.muted}>{t('band.effort')} {view.figures.effort ?? '—'} · {t('band.cache')} {view.figures.cachePct ?? '—'}% · {t('band.context')} {view.figures.contextPct ?? '—'}%</Text>}
      {history?.hasOlder && <Button title={t('history.loading')} secondary onPress={() => { try { remote.older(id); } catch (e) { remote.report(e); } }} />}
      {view.items.map(item => <TimelineItem key={item.key} item={item} session={id} readOnly={readOnly} />)}
    </ScrollView>
    {!readOnly && session && <View style={{ padding: 16, gap: 10, borderTopWidth: 1, borderColor: '#D9E2EC' }}><Field testID="session-composer" accessibilityLabel={t('composer.reply')} placeholder={t('composer.reply')} value={text} onChangeText={setText} multiline style={{ maxHeight: 140 }} /><View style={s.row}><Button title={t('composer.send')} disabled={!text.trim()} onPress={() => { void send(); }} />{['running', 'starting', 'waiting'].includes(session.state) && <Button title={t('composer.stop')} secondary onPress={() => { try { remote.send({ t: 'interrupt', session: id }); } catch (e) { remote.report(e); } }} />}</View></View>}
  </KeyboardAvoidingView></SafeAreaView>;
}
