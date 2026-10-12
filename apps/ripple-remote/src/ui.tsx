import React, { useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View, type TextInputProps, TextInput } from 'react-native';
import { remote } from './client';
import { t, type Key, lang } from '../../../packages/remote/web/i18n.ts';
export const colors = { bg: '#F6F8FB', ink: '#182C43', muted: '#60738A', line: '#D9E2EC', accent: '#285EAB', white: '#FFFFFF', warning: '#935B12' };
export const useRemote = () => useSyncExternalStore(remote.subscribe, remote.getSnapshot);
export const copy = (ko: string, en: string): string => lang() === 'ko' ? ko : en;
export function Button({ title, onPress, disabled = false, secondary = false }: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} disabled={disabled} onPress={onPress} style={[s.button, secondary && s.secondary, disabled && { opacity: .4 }]}><Text style={[s.buttonText, secondary && { color: colors.accent }]}>{title}</Text></Pressable>;
}
export function Label({ children }: { children: React.ReactNode }) { return <Text style={s.label}>{children}</Text>; }
export function Field(props: TextInputProps) { return <TextInput placeholderTextColor={colors.muted} {...props} style={[s.field, props.style]} />; }
export function Connection() {
  const state = useRemote();
  const status = state.status;
  if (!state.paired) return null;
  const title = status?.state === 'open' ? t('conn.open') : status?.state === 'denied' ? t('conn.denied.title') : status?.state === 'waiting' ? t('conn.retryIn', { s: Math.max(0, Math.ceil(((status.nextAt ?? Date.now()) - Date.now()) / 1000)) }) : t('conn.connecting');
  return <View style={s.connection}><Pressable onPress={() => remote.retry()} accessibilityRole="button"><Text style={{ color: status?.state === 'open' ? colors.accent : colors.warning }}>● {state.host?.name ?? 'Mac'} · {title}</Text></Pressable>{state.host && !state.host.routerOk && <Text style={s.warning}>{t('conn.router')}</Text>}{state.error && <Pressable onPress={() => remote.clearError()}><Text style={s.warning}>{state.error}</Text></Pressable>}</View>;
}
export const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg }, content: { padding: 22, gap: 16, paddingBottom: 44 },
  title: { fontSize: 30, fontWeight: '700', color: colors.ink, letterSpacing: -.8 },
  body: { fontSize: 16, lineHeight: 25, color: colors.ink }, muted: { fontSize: 13, lineHeight: 20, color: colors.muted },
  label: { fontSize: 13, fontWeight: '600', color: colors.muted, letterSpacing: .4, marginTop: 12 },
  card: { backgroundColor: colors.white, borderRadius: 16, padding: 18, gap: 8, borderWidth: 1, borderColor: colors.line },
  row: { flexDirection: 'row', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
  button: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 18, alignItems: 'center', minHeight: 48 },
  secondary: { backgroundColor: '#E8EFF8' }, buttonText: { color: colors.white, fontSize: 15, fontWeight: '600' },
  field: { backgroundColor: colors.white, color: colors.ink, fontSize: 16, padding: 15, minHeight: 50, borderWidth: 1, borderColor: colors.line, borderRadius: 12 },
  connection: { paddingHorizontal: 22, paddingVertical: 12, gap: 8, borderBottomWidth: 1, borderColor: colors.line, backgroundColor: colors.bg },
  warning: { color: colors.warning, fontSize: 13, lineHeight: 20 }, mono: { fontFamily: 'Menlo', fontSize: 12, lineHeight: 19, color: colors.ink },
});
