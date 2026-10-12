import React, { useEffect, useState } from 'react';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { remote } from '../src/client';
import { ErrorToast, useRemote } from '../src/ui';
import { usePalette } from '../src/theme';
import { pickLang, setLang } from '../../../packages/remote/web/i18n.ts';
Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) });
export default function Layout() {
  const state = useRemote();
  const c = usePalette();
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
  if (!ready || !state.loaded) return <View style={{ flex: 1, backgroundColor: c.bg }} />;
  return <View style={{ flex: 1, backgroundColor: c.bg }}><StatusBar style="auto" /><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
    <Stack.Screen name="index" />
    <Stack.Screen name="pair" />
    <Stack.Screen name="session/[id]" />
    <Stack.Screen name="new" />
    <Stack.Screen name="settings" />
  </Stack><ErrorToast /></View>;
}
