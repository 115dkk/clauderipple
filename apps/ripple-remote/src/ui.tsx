// Shared building blocks. Styling follows packages/remote/web/style.css class by class; every
// colour, radius and font comes from ./theme.
import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { remote } from './client';
import { Icon } from './icons';
import { Ripple, type Face } from './mascot';
import { MAX_WIDTH, mono, radius, shadow, usePalette, type Palette } from './theme';
import { t, lang } from '../../../packages/remote/web/i18n.ts';
import { clock, duration } from '../../../packages/remote/web/dom.ts';
import { linkKind } from '../../../packages/remote/web/views.ts';
import type { LinkStatus } from '../../../packages/remote/web/conn.ts';

export const useRemote = () => useSyncExternalStore(remote.subscribe, remote.getSnapshot);
export const copy = (ko: string, en: string): string => lang() === 'ko' ? ko : en;

/** A clock for things that age on screen: relative times and reconnect countdowns. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(id); }, [ms]);
  return now;
}

export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setOpen(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setOpen(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return open;
}

// ---- styles ---------------------------------------------------------------------------------

function make(c: Palette) {
  const card = { backgroundColor: c.surface, borderRadius: radius.md, borderWidth: 1, borderColor: c.line } as const;
  return StyleSheet.create({
    frame: { flex: 1, backgroundColor: c.bg },
    inner: { flex: 1, width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
    // .top
    top: { minHeight: 52, paddingTop: 6, paddingBottom: 6, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.bg },
    iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
    iconBtnOn: { backgroundColor: c.surface2 },
    topTitle: { flex: 1, minWidth: 0, alignItems: 'center', paddingHorizontal: 4 },
    topB: { fontSize: 16, fontWeight: '700', color: c.ink, maxWidth: '100%' },
    topSub: { fontSize: 13, color: c.muted, maxWidth: '100%' },
    spacer: { flex: 1 },
    // .link
    link: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 32, paddingLeft: 10, paddingRight: 12, borderRadius: 99, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, marginLeft: 4 },
    linkText: { fontSize: 13.5, fontWeight: '600', color: c.ink2 },
    linkHost: { fontSize: 13.5, fontWeight: '500', color: c.muted },
    dotHalo: { width: 14, height: 14, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
    dot: { width: 8, height: 8, borderRadius: 4 },
    // .banner
    banner: { ...card, marginTop: 2, marginHorizontal: 12, marginBottom: 8, paddingVertical: 12, paddingHorizontal: 14, flexDirection: 'row', gap: 12, alignItems: 'flex-start', ...shadow(c) },
    bannerPush: { marginTop: 18, shadowOpacity: 0 },
    bannerWarn: { borderColor: c.warnLine },
    bannerBad: { borderColor: c.badLine },
    bannerSlim: { paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center', shadowOpacity: 0, backgroundColor: c.warnSoft, borderColor: 'transparent', gap: 8 },
    bannerTxt: { flex: 1, minWidth: 0 },
    bannerBody: { fontSize: 14.5, lineHeight: 21, color: c.ink2 },
    bannerB: { fontSize: 15.5, fontWeight: '700', color: c.ink, marginBottom: 2 },
    bannerSmall: { marginTop: 6, fontSize: 13, color: c.muted },
    bannerAct: { marginTop: 10, flexDirection: 'row', gap: 8 },
    slimText: { flex: 1, fontSize: 13.5, color: c.ink2 },
    // .btn
    btn: { height: 40, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, backgroundColor: c.surface2 },
    btnPrimary: { backgroundColor: c.accentStrong },
    btnGhost: { backgroundColor: 'transparent', paddingHorizontal: 6 },
    btnBig: { height: 52, borderRadius: 16 },
    btnText: { fontSize: 15, fontWeight: '600', color: c.ink },
    btnTextPrimary: { color: c.accentInk },
    btnTextGhost: { color: c.accent },
    btnTextBig: { fontSize: 16.5 },
    pressed: { opacity: 0.9, transform: [{ scale: 0.98 }] },
    disabled: { opacity: 0.4 },
    // .lt .sec .list .row
    lt: { paddingTop: 4, paddingHorizontal: 20, paddingBottom: 6, fontSize: 30, fontWeight: '700', letterSpacing: -0.6, color: c.ink },
    sec: { paddingTop: 14, paddingHorizontal: 20, paddingBottom: 6, flexDirection: 'row', alignItems: 'center', gap: 6 },
    secText: { fontSize: 13, fontWeight: '600', color: c.muted, letterSpacing: 0.1 },
    count: { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 99, backgroundColor: c.warn, alignItems: 'center', justifyContent: 'center' },
    countText: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
    list: { marginHorizontal: 12, backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.line, overflow: 'hidden' },
    listWaiting: { borderColor: c.warnLine },
    listStale: { opacity: 0.5 },
    foot: { marginHorizontal: 20, marginTop: 10, fontSize: 13, lineHeight: 19, color: c.muted },
    // .empty
    empty: { paddingTop: 40, paddingHorizontal: 32, paddingBottom: 20, alignItems: 'center', gap: 6 },
    emptyB: { fontSize: 19, fontWeight: '700', color: c.ink, marginTop: 10 },
    emptyP: { color: c.muted, fontSize: 15, lineHeight: 22, textAlign: 'center', maxWidth: 280 },
    // .opt (rows inside .list)
    opt: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 14, minHeight: 56 },
    optSep: { position: 'absolute', left: 48, right: 0, top: 0, borderTopWidth: 1, borderColor: c.line },
    optT1: { fontSize: 16, fontWeight: '500', color: c.ink },
    optT1On: { color: c.accent, fontWeight: '600' },
    optT2: { fontSize: 13, color: c.muted },
    optT2Mono: { fontFamily: mono, fontSize: 12 },
    badge: { fontSize: 12, color: c.muted, backgroundColor: c.surface2, borderRadius: 99, paddingVertical: 2, paddingHorizontal: 8, overflow: 'hidden' },
    // field (.filter / .pair input)
    field: { backgroundColor: c.surface, color: c.ink, fontSize: 16, paddingHorizontal: 12, minHeight: 40, borderWidth: 1, borderColor: c.line, borderRadius: 12 },
    filter: { marginTop: 2, marginHorizontal: 12, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.surface2, borderRadius: 12, paddingHorizontal: 12, height: 42 },
    filterInput: { flex: 1, fontSize: 16, color: c.ink, minWidth: 0, padding: 0 },
    // .seg
    segLabel: { fontSize: 13, color: c.muted, marginHorizontal: 4, marginBottom: 6, fontWeight: '600' },
    seg: { flexDirection: 'row', backgroundColor: c.surface2, borderRadius: 13, padding: 3, gap: 2 },
    segBtn: { flex: 1, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    segBtnOn: { backgroundColor: c.surface, shadowColor: '#000000', shadowOpacity: 0.12, shadowRadius: 1.5, shadowOffset: { width: 0, height: 1 } },
    segText: { fontSize: 14.5, fontWeight: '600', color: c.ink2 },
    segTextOn: { color: c.accent },
    // .composer
    composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line2, borderRadius: 24, paddingTop: 6, paddingBottom: 6, paddingRight: 6, paddingLeft: 16, ...shadow(c) },
    composerInput: { flex: 1, minWidth: 0, fontSize: 16, lineHeight: 23, paddingTop: 8, paddingBottom: 8, paddingHorizontal: 0, color: c.ink, minHeight: 40, maxHeight: 160 },
    send: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: c.accentStrong },
    sendOff: { backgroundColor: c.surface2 },
    sendStop: { backgroundColor: c.ink },
    dock: { paddingTop: 8, paddingHorizontal: 12, backgroundColor: c.bg },
    // toast (.toast)
    toast: { position: 'absolute', left: 16, right: 16, backgroundColor: c.ink, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, ...shadow(c) },
    toastText: { color: c.bg, fontSize: 14.5, lineHeight: 20 },
    mono: { fontFamily: mono },
  });
}
const cache = new Map<Palette, ReturnType<typeof make>>();
export function useStyles() {
  const c = usePalette();
  const s = useMemo(() => { let v = cache.get(c); if (!v) { v = make(c); cache.set(c, v); } return v; }, [c]);
  return { c, s };
}

// ---- frame ----------------------------------------------------------------------------------

/** The whole screen: respects the status bar and home indicator, centres on wide displays. */
export function Frame({ children, bottom = false }: { children: React.ReactNode; bottom?: boolean }) {
  const { s } = useStyles();
  const insets = useSafeAreaInsets();
  return <View style={[s.frame, { paddingTop: insets.top, paddingBottom: bottom ? insets.bottom : 0 }]}><View style={s.inner}>{children}</View></View>;
}

export function IconButton({ name, label, onPress, size = 22, tint }: { name: React.ComponentProps<typeof Icon>['name']; label: string; onPress?: () => void; size?: number; tint?: string }) {
  const { c, s } = useStyles();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={4} style={({ pressed }) => [s.iconBtn, pressed && s.iconBtnOn]}><Icon name={name} size={size} color={tint ?? c.ink2} /></Pressable>;
}

/** `.top` for screens that only need a way back and a title. */
export function TopBar({ title, right }: { title: string; right?: React.ReactNode }) {
  const { s } = useStyles();
  return <View style={s.top}>
    <IconButton name="back" label={t('a11y.back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
    <View style={s.topTitle}><Text style={s.topB} numberOfLines={1}>{title}</Text></View>
    {right ?? <View style={{ width: 44 }} />}
  </View>;
}

export function Button({ title, onPress, disabled = false, secondary = false, ghost = false, big = false, icon }: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean; ghost?: boolean; big?: boolean; icon?: React.ReactNode }) {
  const { s } = useStyles();
  const primary = !secondary && !ghost;
  return <Pressable accessibilityRole="button" accessibilityLabel={title} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [s.btn, primary && s.btnPrimary, ghost && s.btnGhost, big && s.btnBig, pressed && s.pressed, disabled && s.disabled]}>
    {icon}<Text style={[s.btnText, primary && s.btnTextPrimary, ghost && s.btnTextGhost, big && s.btnTextBig]}>{title}</Text>
  </Pressable>;
}

/** `.sec` */
export function Label({ children, count }: { children: React.ReactNode; count?: number }) {
  const { s } = useStyles();
  return <View style={s.sec}><Text style={s.secText}>{children}</Text>{count ? <View style={s.count}><Text style={s.countText}>{count}</Text></View> : null}</View>;
}

/** `.list`: a rounded white card whose children are separated by hairlines. */
export function List({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { s } = useStyles();
  return <View style={[s.list, style]}>{children}</View>;
}

/** `.opt`: icon, two lines, optional trailing node. */
export function Opt({ icon, title, sub, subMono, on, danger, disabled, first, trailing, onPress }: { icon?: React.ReactNode; title: string; sub?: string; subMono?: boolean; on?: boolean; danger?: boolean; disabled?: boolean; first?: boolean; trailing?: React.ReactNode; onPress?: () => void }) {
  const { c, s } = useStyles();
  return <Pressable accessibilityRole="button" accessibilityLabel={title} disabled={disabled || !onPress} onPress={onPress} style={({ pressed }) => [s.opt, pressed && { backgroundColor: c.surface2 }, disabled && { opacity: 0.45 }]}>
    {!first && <View style={s.optSep} />}
    {icon}
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={[s.optT1, on && s.optT1On, danger && { color: c.bad }]} numberOfLines={1}>{title}</Text>
      {sub ? <Text style={[s.optT2, subMono && s.optT2Mono]} numberOfLines={1}>{sub}</Text> : null}
    </View>
    {trailing}
  </Pressable>;
}

export function Field(props: TextInputProps) {
  const { c, s } = useStyles();
  return <TextInput placeholderTextColor={c.muted} keyboardAppearance={c.dark ? 'dark' : 'light'} {...props} style={[s.field, props.style]} />;
}

/** `.seg` */
export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T | null; onChange: (value: T) => void }) {
  const { s } = useStyles();
  return <View style={s.seg}>{options.map(o => <Pressable key={o.value} accessibilityRole="button" accessibilityLabel={o.label} onPress={() => onChange(o.value)} style={[s.segBtn, value === o.value && s.segBtnOn]}><Text style={[s.segText, value === o.value && s.segTextOn]} numberOfLines={1}>{o.label}</Text></Pressable>)}</View>;
}

/** `.composer`: the rounded input with its round send (and stop) button. */
export function Composer({ value, onChangeText, placeholder, onSend, onStop, canSend, testID }: { value: string; onChangeText: (v: string) => void; placeholder: string; onSend: () => void; onStop?: () => void; canSend: boolean; testID?: string }) {
  const { c, s } = useStyles();
  return <View style={s.composer}>
    <TextInput testID={testID} accessibilityLabel={placeholder} placeholder={placeholder} placeholderTextColor={c.muted} value={value} onChangeText={onChangeText} multiline keyboardAppearance={c.dark ? 'dark' : 'light'} style={s.composerInput} />
    {onStop && <Pressable accessibilityRole="button" accessibilityLabel={t('composer.stop')} onPress={onStop} style={[s.send, s.sendStop]}><Icon name="stop" size={18} color={c.bg} /></Pressable>}
    <Pressable accessibilityRole="button" accessibilityLabel={t('composer.send')} disabled={!canSend} onPress={onSend} style={[s.send, !canSend && s.sendOff]}><Icon name="send" size={20} color={canSend ? c.accentInk : c.faint} /></Pressable>
  </View>;
}

// ---- connection -----------------------------------------------------------------------------

const DOWN: LinkStatus = { state: 'connecting', attempt: 0, nextAt: null, lastRx: null, downSince: null };

/** The top-left pill: dot, Mac name, what is true right now. */
export function LinkPill() {
  const { c, s } = useStyles();
  const state = useRemote();
  const now = useNow();
  const link = state.status ?? DOWN;
  const kind = linkKind(link, now);
  const label = kind === 'open' ? t('conn.open')
    : kind === 'offline' ? t('conn.offline')
    : kind === 'denied' ? t('conn.denied.title')
    : link.state === 'waiting' && link.nextAt ? t('conn.retryIn', { s: Math.max(1, Math.ceil((link.nextAt - now) / 1000)) })
    : link.attempt > 0 ? t('conn.retrying') : t('conn.connecting');
  const tone = kind === 'open' ? [c.ok, c.okSoft] : kind === 'offline' || kind === 'denied' || kind === 'lost' ? [c.bad, c.badSoft] : [c.warn, c.warnSoft];
  return <Pressable accessibilityRole="button" accessibilityLabel={`${state.host?.name ?? 'Mac'} ${label}`} onPress={() => remote.retry()} style={s.link}>
    <View style={[s.dotHalo, { backgroundColor: tone[1] }]}><View style={[s.dot, { backgroundColor: tone[0] }]} /></View>
    <Text style={s.linkHost}>{state.host?.name ?? 'Mac'}</Text><Text style={s.linkText}>{label}</Text>
  </Pressable>;
}

/** The connection banner: nothing when all is well, a slim line while retrying briefly, a card once it is a real outage. */
export function ConnectionBanner() {
  const { c, s } = useStyles();
  const state = useRemote();
  const now = useNow();
  if (!state.paired) return null;
  const link = state.status ?? DOWN;
  const kind = linkKind(link, now);
  const seen = link.lastRx ? t('conn.lastSeen', { time: clock(link.lastRx) }) : '';
  const card = (face: Face, size: number, tone: 'warn' | 'bad', body: React.ReactNode) => <View style={[s.banner, tone === 'warn' ? s.bannerWarn : s.bannerBad]}><View style={{ marginTop: 2 }}><Ripple face={face} size={size} /></View><View style={s.bannerTxt}>{body}</View></View>;
  if (kind === 'open') {
    if (state.host && !state.host.routerOk) return card('uneasy', 34, 'warn', <Text style={s.bannerBody}>{t('conn.router')}</Text>);
    return null;
  }
  if (kind === 'denied') return card('sorry', 40, 'bad', <Text style={s.bannerBody}><Text style={s.bannerB}>{t('conn.denied.title')}{'\n'}</Text>{t('conn.denied.body')}</Text>);
  if (kind === 'offline') return card('sleepy', 40, 'bad', <><Text style={s.bannerBody}><Text style={s.bannerB}>{t('conn.offline.title')}{'\n'}</Text>{t('conn.offline.body')}</Text>{seen ? <Text style={s.bannerSmall}>{seen}</Text> : null}</>);
  if (kind === 'lost') return card('sleepy', 40, 'bad', <><Text style={s.bannerBody}><Text style={s.bannerB}>{t('conn.lost.title')}{'\n'}</Text>{t('conn.lost.body', { ago: duration(now - (link.downSince ?? now)) })}</Text>{seen ? <Text style={s.bannerSmall}>{seen}</Text> : null}<View style={s.bannerAct}><Button title={t('conn.retryNow')} onPress={() => remote.retry()} /></View></>);
  if (link.attempt === 0) return null;
  return <View style={[s.banner, s.bannerSlim]}><Icon name="clock" size={16} color={c.ink2} /><Text style={s.slimText}>{link.lastRx ? t('conn.stale', { time: clock(link.lastRx) }) : t('conn.connecting')}</Text></View>;
}

/** `.toast`: the last error, tap to dismiss. */
export function ErrorToast() {
  const { s } = useStyles();
  const state = useRemote();
  const insets = useSafeAreaInsets();
  if (!state.error) return null;
  return <Pressable accessibilityRole="button" onPress={() => remote.clearError()} style={[s.toast, { bottom: insets.bottom + 140 }]}><Text style={s.toastText}>{state.error}</Text></Pressable>;
}
