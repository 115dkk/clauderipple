import React, { useState } from 'react';
import { Alert, ScrollView, Text } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { lang, setLang, t } from '../../../packages/remote/web/i18n.ts';
import { Button, Label, copy, s } from '../src/ui';
import { remote } from '../src/client';
export default function Settings() {
  const [, render] = useState(0);
  const [message, setMessage] = useState('');
  const enable = async () => {
    try {
      if (!Device.isDevice) throw new Error(copy('푸시 알림은 실제 iPhone에서 확인합니다.', 'Push notifications require a physical iPhone.'));
      const permission = await Notifications.requestPermissionsAsync();
      if (!permission.granted) throw new Error(t('push.denied'));
      const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
      if (typeof projectId !== 'string') throw new Error(copy('TestFlight 준비 시 승인받은 EAS 프로젝트 ID를 설정해야 합니다. 아직 원격 프로젝트를 만들지 않았습니다.', 'Set the approved EAS project ID when preparing TestFlight. No remote project has been created.'));
      const token = await Notifications.getExpoPushTokenAsync({ projectId });
      await remote.registerToken(token.data, lang());
      setMessage(t('push.done'));
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
  };
  const unpair = () => Alert.alert(copy('Mac 연결을 해제하시겠습니까?', 'Unpair this Mac?'), copy('저장된 연결 키와 대기 메시지를 삭제합니다.', 'Deletes saved pairing keys and queued messages.'), [
    { text: copy('취소', 'Cancel'), style: 'cancel' },
    { text: copy('연결 해제', 'Unpair'), style: 'destructive', onPress: () => { void remote.unpair().then(() => router.replace('/pair')).catch(e => setMessage(e instanceof Error ? e.message : String(e))); } },
  ]);
  return <ScrollView style={s.page} contentContainerStyle={s.content}>
    <Label>{copy('언어', 'Language')}</Label><Button title="한국어 / English" secondary onPress={() => { const next = lang() === 'ko' ? 'en' : 'ko'; setLang(next); remote.refresh(); render(n => n + 1); void AsyncStorage.setItem('language', next).catch(e => remote.report(e)); }} />
    <Label>{t('push.title')}</Label><Text style={s.body}>{t('push.body')}</Text><Text style={s.muted}>{copy('알림에는 승인·완료·실패 상태만 포함됩니다. 대화 내용은 전송하지 않습니다.', 'Notifications contain only approval, completion or failure status. No conversation text is sent.')}</Text><Button title={t('push.on')} onPress={() => { void enable(); }} />
    {message && <Text style={s.warning}>{message}</Text>}
    <Label>{copy('연결', 'Connection')}</Label><Button title={copy('Mac 연결 해제', 'Unpair Mac')} secondary onPress={unpair} />
    <Text style={s.muted}>Ripple Remote · 0.1.0</Text><Text style={s.muted}>{copy('Anthropic 또는 OpenAI와 제휴하지 않은 독립 앱입니다.', 'An independent app, not affiliated with Anthropic or OpenAI.')}</Text>
  </ScrollView>;
}
