import React from 'react';
import { Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PERMISSION_MODES, type PermissionMode } from '../../../packages/remote/src/protocol.ts';
import { copy, Segmented, useStyles } from './ui';

export const modeLabel = (mode: PermissionMode): string => ({ plan: copy('계획', 'Plan'), default: copy('항상 묻기', 'Ask'), acceptEdits: copy('편집 허용', 'Accept edits'), auto: 'Auto', bypassPermissions: copy('모두 허용', 'Bypass') })[mode];
export async function savedMode(): Promise<PermissionMode> {
  const value = await AsyncStorage.getItem('permissionMode');
  return PERMISSION_MODES.find(mode => mode === value) ?? 'auto';
}
export const rememberMode = (mode: PermissionMode): Promise<void> => AsyncStorage.setItem('permissionMode', mode);
export function ModePicker({ value, onChange }: { value: PermissionMode; onChange: (mode: PermissionMode) => void }) {
  const { c } = useStyles();
  return <View style={{ gap: 8 }}>
    <Segmented options={PERMISSION_MODES.map(mode => ({ value: mode, label: modeLabel(mode) }))} value={value} onChange={onChange} />
    {value === 'bypassPermissions' && <Text style={{ color: c.warn, fontSize: 12.5 }}>{copy('경고: 승인 없이 모든 도구를 실행합니다.', 'Warning: all tools run without approval.')}</Text>}
  </View>;
}
