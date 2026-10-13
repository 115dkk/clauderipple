import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { lang, setLang, t, type Lang } from '../../../packages/remote/web/i18n.ts';
import { linkKind } from '../../../packages/remote/web/views.ts';
import { Frame, Label, List, Opt, Segmented, TopBar, copy, useNow, useRemote, useStyles } from '../src/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../src/icons';
import { Ripple } from '../src/mascot';
import { dark, light, radius, type Palette } from '../src/theme';
import { loadAppearance, saveAppearance, type AppearanceMode } from '../src/appearance';
import { remote } from '../src/client';

/** A small drawn screen in one palette: the page, a card on it, two lines of text and an accent. */
function Mini({ p, width }: { p: Palette; width: number }) {
  return <View style={{ width, height: 74, backgroundColor: p.bg, paddingTop: 12, paddingHorizontal: 9 }}>
    <View style={{ height: 8, width: 26, borderRadius: 4, backgroundColor: p.ink, opacity: 0.85 }} />
    <View style={{ marginTop: 8, backgroundColor: p.surface, borderRadius: 7, borderWidth: 1, borderColor: p.line2, padding: 6, gap: 4 }}>
      <View style={{ height: 5, width: '78%', borderRadius: 3, backgroundColor: p.ink2, opacity: 0.7 }} />
      <View style={{ height: 5, width: '48%', borderRadius: 3, backgroundColor: p.faint }} />
    </View>
    <View style={{ position: 'absolute', right: 8, bottom: 7, width: 14, height: 14, borderRadius: 7, backgroundColor: p.accentStrong }} />
  </View>;
}

/** The three looks, each shown as it will be; the chosen one is ringed in the accent. */
function Appearance({ value, onChange }: { value: AppearanceMode; onChange: (mode: AppearanceMode) => void }) {
  const { c } = useStyles();
  const tiles: { mode: AppearanceMode; label: string; preview: (width: number) => React.ReactNode }[] = [
    { mode: 'system', label: copy('시스템', 'System'), preview: w => <View style={{ flexDirection: 'row' }}><View style={{ width: w / 2, overflow: 'hidden' }}><Mini p={light} width={w} /></View><View style={{ width: w / 2, overflow: 'hidden' }}><View style={{ marginLeft: -w / 2 }}><Mini p={dark} width={w} /></View></View></View> },
    { mode: 'light', label: copy('라이트', 'Light'), preview: w => <Mini p={light} width={w} /> },
    { mode: 'dark', label: copy('다크', 'Dark'), preview: w => <Mini p={dark} width={w} /> },
  ];
  const [room, setRoom] = useState(0);
  // Three tiles share the row, a gap of 10 between them.
  const tile = room > 0 ? Math.floor((room - 20) / 3) : 0;
  return <View style={{ marginHorizontal: 12, flexDirection: 'row', gap: 10 }} onLayout={e => setRoom(e.nativeEvent.layout.width)}>
    {tile > 0 && tiles.map(o => {
      const on = o.mode === value;
      return <Pressable key={o.mode} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={o.label} onPress={() => onChange(o.mode)} style={({ pressed }) => [{ width: tile, alignItems: 'center', gap: 8 }, pressed && { opacity: 0.8 }]}>
        <View style={{ width: tile, borderRadius: radius.md, borderWidth: 2, borderColor: on ? c.accent : c.line2, padding: 3, backgroundColor: c.surface }}>
          <View style={{ borderRadius: radius.md - 4, overflow: 'hidden' }}>{o.preview(tile - 10)}</View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          {on ? <Icon name="check" size={14} color={c.accent} /> : null}
          <Text style={{ fontSize: 14.5, fontWeight: on ? '700' : '500', color: on ? c.accent : c.ink2 }}>{o.label}</Text>
        </View>
      </Pressable>;
    })}
  </View>;
}

type Permission = 'unknown' | 'granted' | 'denied' | 'undetermined';

export default function Settings() {
  const { c, s } = useStyles();
  const insets = useSafeAreaInsets();
  const state = useRemote();
  const now = useNow(5000);
  const [, render] = useState(0);
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState<AppearanceMode>('system');
  const [permission, setPermission] = useState<Permission>('unknown');
  const [busy, setBusy] = useState(false);

  const readPermission = useCallback(() => {
    void Notifications.getPermissionsAsync()
      .then(p => setPermission(p.granted ? 'granted' : p.status === 'denied' ? 'denied' : 'undetermined'))
      .catch(() => setPermission('unknown'));
  }, []);
  useEffect(() => {
    void loadAppearance().then(setMode);
    readPermission();
  }, [readPermission]);

  const pick = (next: AppearanceMode) => { setMode(next); void saveAppearance(next).catch(e => remote.report(e)); };
  const pickLanguage = (next: Lang) => { setLang(next); remote.refresh(); render(n => n + 1); void AsyncStorage.setItem('language', next).catch(e => remote.report(e)); };

  const enable = async () => {
    setBusy(true);
    try {
      if (!Device.isDevice) throw new Error(copy('푸시 알림은 실제 iPhone에서 확인합니다.', 'Push notifications require a physical iPhone.'));
      if (permission === 'denied') { await Linking.openSettings(); return; }
      const asked = await Notifications.requestPermissionsAsync();
      readPermission();
      if (!asked.granted) throw new Error(t('push.denied'));
      const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
      if (typeof projectId !== 'string') throw new Error(copy('TestFlight 준비 시 승인받은 EAS 프로젝트 ID를 설정해야 합니다. 아직 원격 프로젝트를 만들지 않았습니다.', 'Set the approved EAS project ID when preparing TestFlight. No remote project has been created.'));
      const token = await Notifications.getExpoPushTokenAsync({ projectId });
      await remote.registerToken(token.data, lang());
      setMessage(t('push.done'));
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const host = state.host?.name ?? t('host.fallback');
  const link = state.status ? linkKind(state.status, now) : 'connecting';
  const online = link === 'open';
  const unpair = () => Alert.alert(copy(`${host} 연결을 해제하시겠습니까?`, `Unpair ${host}?`), copy('저장된 연결 키와 대기 메시지를 삭제합니다.', 'Deletes saved pairing keys and queued messages.'), [
    { text: copy('취소', 'Cancel'), style: 'cancel' },
    { text: copy('연결 해제', 'Unpair'), style: 'destructive', onPress: () => { void remote.unpair().then(() => router.replace('/pair')).catch(e => setMessage(e instanceof Error ? e.message : String(e))); } },
  ]);
  const privacy = () => Alert.alert(copy('개인정보 보호', 'Privacy'), copy(
    '대화는 이 휴대폰과 내 Mac 사이에서만 종단간 암호화되어 오갑니다. 중계 서버는 내용을 읽을 수 없습니다.\n\n푸시 알림에는 승인·완료·실패 상태만 담기고 대화 내용은 포함되지 않습니다.\n\n광고·분석·추적 도구를 사용하지 않으며, 수집하는 개인정보가 없습니다.',
    'Conversations travel end-to-end encrypted between this phone and your Mac only. The relay cannot read them.\n\nPush notifications carry only approval, completion or failure status, never conversation text.\n\nNo ads, analytics or tracking are used, and no personal data is collected.'));

  const version = Constants.expoConfig?.version ?? '0.1.0';
  const build = Constants.expoConfig?.ios?.buildNumber ?? Constants.nativeBuildVersion ?? '';

  return <Frame><TopBar title={t('a11y.settings')} /><ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 28 }} showsVerticalScrollIndicator={false}>
    {/* who this phone talks to */}
    <View style={[s.banner, { marginTop: 4, marginBottom: 4, alignItems: 'center', gap: 14, paddingVertical: 16, paddingHorizontal: 16 }]}>
      <Ripple face={online ? 'pleased' : 'sleepy'} size={52} />
      <View style={s.bannerTxt}>
        <Text style={{ fontSize: 17, fontWeight: '700', color: c.ink }} numberOfLines={1}>{host}</Text>
        <View style={{ marginTop: 5, flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: online ? c.ok : c.warn }} />
          <Text style={{ fontSize: 13.5, color: c.muted }} numberOfLines={1}>{online ? t('conn.open') : t('conn.connecting')}{state.host?.version ? ` · Ripple Host ${state.host.version}` : ''}</Text>
        </View>
      </View>
    </View>

    <Label>{copy('화면', 'Appearance')}</Label>
    <Appearance value={mode} onChange={pick} />
    <Text style={s.foot}>{mode === 'system' ? copy('휴대폰의 라이트·다크 설정을 따릅니다.', 'Follows your phone’s light or dark setting.') : mode === 'light' ? copy('항상 밝은 화면으로 표시합니다.', 'Always shown in the light look.') : copy('항상 어두운 화면으로 표시합니다.', 'Always shown in the dark look.')}</Text>

    <Label>{copy('언어', 'Language')}</Label>
    <View style={{ marginHorizontal: 12 }}><Segmented<Lang> value={lang()} onChange={pickLanguage} options={[{ value: 'ko', label: '한국어' }, { value: 'en', label: 'English' }]} /></View>

    <Label>{t('push.title')}</Label>
    <List>
      <Opt first icon={<Icon name="bell" size={20} color={permission === 'granted' ? c.accent : c.muted} />} title={copy('푸시 알림', 'Push notifications')} sub={permission === 'denied' ? copy('iOS 설정에서 허용해야 합니다', 'Allow it in iOS Settings') : copy('승인 요청·작업 완료·실패', 'Approvals, finished work, failures')}
        trailing={<Switch value={permission === 'granted'} disabled={busy || permission === 'unknown'} onValueChange={() => { void (permission === 'granted' ? Linking.openSettings() : enable()); }} trackColor={{ true: c.accentStrong, false: c.surface2 }} ios_backgroundColor={c.surface2} />} />
    </List>
    {message ? <Text style={[s.foot, { color: c.warn }]}>{message}</Text> : null}
    <Text style={s.foot}>{copy('알림에는 승인·완료·실패 상태만 포함됩니다. 대화 내용은 전송하지 않습니다.', 'Notifications contain only approval, completion or failure status. No conversation text is sent.')}</Text>

    <Label>{copy('연결', 'Connection')}</Label>
    <List>
      <Opt first danger icon={<Icon name="x" size={20} color={c.bad} />} title={copy('연결 해제', 'Unpair')} sub={copy(`${host}와(과)의 연결을 끊습니다`, `Disconnect from ${host}`)} onPress={unpair} />
    </List>

    <Label>{copy('정보', 'About')}</Label>
    <List>
      <Opt first icon={<Icon name="shield" size={20} color={c.muted} />} title={copy('개인정보 보호', 'Privacy')} sub={copy('종단간 암호화 · 추적 없음', 'End-to-end encrypted · no tracking')} trailing={<Icon name="chevron" size={18} color={c.faint} />} onPress={privacy} />
      <Opt icon={<Icon name="file" size={20} color={c.muted} />} title={copy('버전', 'Version')} trailing={<Text style={{ fontSize: 14, color: c.muted, fontWeight: '600' }}>{version}{build ? ` (${build})` : ''}</Text>} />
    </List>
    <Text style={[s.foot, { marginTop: 22, textAlign: 'center' }]}>Ripple Remote</Text>
    <Text style={[s.foot, { marginTop: 4, textAlign: 'center' }]}>{copy('Anthropic 또는 OpenAI와 제휴하지 않은 독립 앱입니다.', 'An independent app, not affiliated with Anthropic or OpenAI.')}</Text>
  </ScrollView></Frame>;
}
