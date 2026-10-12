import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { remote } from '../src/client';
import { Button, Field, copy, s } from '../src/ui';
import { t } from '../../../packages/remote/web/i18n.ts';
export default function Pair() {
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
  return <ScrollView style={s.page} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
    <Text style={s.title}>{t('pair.title')}</Text>
    <Text style={s.body}>{t('pair.step1')}</Text>
    <View style={s.card}><Text selectable style={s.mono}>npm run remote -- pair</Text></View>
    <Text style={s.muted}>{copy('Mac에 표시된 QR 코드를 스캔하거나 연결 링크를 붙여 넣습니다. 릴레이를 통해 어디서나 암호화된 연결을 사용합니다.', 'Scan the QR on your Mac or paste its pairing link. The relay connects you from anywhere with end-to-end encryption.')}</Text>
    {scanning && permission?.granted && <CameraView style={{ height: 280, borderRadius: 16 }} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={({ data }) => { void pair(data); }} />}
    <Button title={copy('QR 코드 스캔', 'Scan QR code')} secondary onPress={() => { void requestPermission().then(p => { if (p.granted) setScanning(true); else setError(copy('설정에서 카메라 접근을 허용하거나 링크를 붙여 넣습니다.', 'Allow camera access in Settings or paste the link.')); }).catch(e => setError(String(e))); }} />
    <Field testID="pair-link" accessibilityLabel={copy('연결 링크', 'Pairing link')} value={link} onChangeText={setLink} placeholder="https://…/#pair=…" autoCapitalize="none" autoCorrect={false} multiline secureTextEntry={false} />
    {error && <Text style={s.warning}>{error}</Text>}
    <Button title={t('pair.connect')} disabled={!link.trim() || busy} onPress={() => { void pair(link); }} />
  </ScrollView>;
}
