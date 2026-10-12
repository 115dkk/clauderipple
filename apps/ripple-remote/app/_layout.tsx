import React, { useEffect, useState } from 'react';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { remote } from '../src/client';
import { colors, Connection, useRemote } from '../src/ui';
import { pickLang, setLang, t } from '../../../packages/remote/web/i18n.ts';
Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) });
export default function Layout() {
  const state = useRemote();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void AsyncStorage.getItem('language').then(stored => { setLang(pickLang(Localization.getLocales().map(l => l.languageTag), stored)); setReady(true); }).catch(e => remote.report(e));
    void remote.initialize();
    remote.onCreated = session => router.push({ pathname: '/session/[id]', params: { id: session } });
    const open = (response: Notifications.NotificationResponse) => {
      const session = response.notification.request.content.data?.session;
      if (typeof session === 'string') router.push({ pathname: '/session/[id]', params: { id: session } });
    };
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    void Notifications.getLastNotificationResponseAsync().then(r => { if (r) open(r); }).catch(e => remote.report(e));
    return () => sub.remove();
  }, []);
  if (!ready || !state.loaded) return null;
  return <><StatusBar style="dark" /><SafeAreaView edges={['top']} style={{ backgroundColor: colors.bg }}><Connection /></SafeAreaView><Stack screenOptions={{ headerStyle: { backgroundColor: colors.bg }, headerTintColor: colors.ink, contentStyle: { backgroundColor: colors.bg }, headerShadowVisible: false }}>
    <Stack.Screen name="index" options={{ title: 'Ripple Remote' }} />
    <Stack.Screen name="pair" options={{ title: t('pair.title') }} />
    <Stack.Screen name="session/[id]" options={{ title: t('home.title') }} />
    <Stack.Screen name="new" options={{ title: t('home.empty.title') }} />
    <Stack.Screen name="settings" options={{ title: t('a11y.settings') }} />
  </Stack></>;
}
