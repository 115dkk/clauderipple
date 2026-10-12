import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { remote } from '../src/client';
import { Button, Field, Frame, copy, useStyles } from '../src/ui';
import { Ripple } from '../src/mascot';
import { mono } from '../src/theme';
import { t } from '../../../packages/remote/web/i18n.ts';
export default function Pair() {
  const { c, s } = useStyles();
  const insets = useSafeAreaInsets();
  const [link, setLink] = useState('');
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pair = async (text: string) => {
    if (busy) return;
    setBusy(true); setScanning(false); setError('');
    try { await remote.pair(text); setLink(''); router.replace('/'); }
    catch { setError(t('pair.badLink')); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    const receive = (url: string) => { const u = new URL(url); const pasted = u.searchParams.get('link'); if (pasted) setLink(pasted); };
    void Linking.getInitialURL().then(url => { if (url) receive(url); }).catch(e => remote.report(e));
    const sub = Linking.addEventListener('url', ({ url }) => receive(url));
    return () => sub.remove();
  }, []);
  const step = (n: number, children: React.ReactNode) => <View key={n} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
    <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: c.accent, fontWeight: '700', fontSize: 14 }}>{n}</Text></View>
    <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
  </View>;
  return <Frame><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView contentContainerStyle={{ paddingTop: 40, paddingHorizontal: 28, paddingBottom: insets.bottom + 24, alignItems: 'center' }} keyboardShouldPersistTaps="handled">
      <Ripple face="calm" size={96} />
      <Text style={{ fontSize: 26, fontWeight: '700', letterSpacing: -0.5, color: c.ink, marginTop: 18, marginBottom: 22, textAlign: 'center' }}>{t('pair.title')}</Text>
      <View style={{ width: '100%', gap: 14 }}>
        {step(1, <><Text style={{ fontSize: 15.5, lineHeight: 23, color: c.ink }}>{t('pair.step1')}</Text><View style={{ marginTop: 6, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 }}><Text selectable style={{ fontFamily: mono, fontSize: 13, color: c.ink }}>npm run remote -- pair</Text></View></>)}
        {step(2, <Text style={{ fontSize: 15.5, lineHeight: 23, color: c.ink }}>{t('pair.step2')}</Text>)}
      </View>
      {scanning && permission?.granted && <CameraView style={{ height: 280, borderRadius: 16, width: '100%', marginTop: 20 }} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={({ data }) => { void pair(data); }} />}
      <View style={{ width: '100%', marginTop: 20 }}><Button title={copy('QR 코드 스캔', 'Scan QR code')} secondary onPress={() => { void requestPermission().then(p => { if (p.granted) setScanning(true); else setError(copy('설정에서 카메라 접근을 허용하거나 링크를 붙여 넣습니다.', 'Allow camera access in Settings or paste the link.')); }).catch(e => setError(String(e))); }} /></View>
      <View style={{ marginTop: 24, width: '100%' }}>
        <Text style={{ fontSize: 14, lineHeight: 21, color: c.muted }}>{copy('Mac에 표시된 QR 코드를 스캔하거나 연결 링크를 붙여 넣습니다. 릴레이를 통해 어디서나 암호화된 연결을 사용합니다.', 'Scan the QR on your Mac or paste its pairing link. The relay connects you from anywhere with end-to-end encryption.')}</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, alignItems: 'flex-start' }}>
          <Field testID="pair-link" accessibilityLabel={copy('연결 링크', 'Pairing link')} value={link} onChangeText={setLink} placeholder="https://…/#pair=…" autoCapitalize="none" autoCorrect={false} multiline secureTextEntry={false} style={{ flex: 1, minWidth: 0, fontFamily: mono, maxHeight: 96, paddingTop: 10, paddingBottom: 10 }} />
          <Button title={t('pair.connect')} disabled={!link.trim() || busy} onPress={() => { void pair(link); }} />
        </View>
        {error ? <Text style={[s.bannerSmall, { color: c.bad }]}>{error}</Text> : null}
      </View>
    </ScrollView>
  </KeyboardAvoidingView></Frame>;
}
