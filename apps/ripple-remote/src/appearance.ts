// The person's choice of light or dark, kept apart from the system's. `system` follows the phone;
// the other two pin the whole app (its own palette, the status bar, the keyboard and system alerts)
// through React Native's colour-scheme override, so nothing else has to know about it.
import { Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type AppearanceMode = 'system' | 'light' | 'dark';

const KEY = 'appearance';

export const isMode = (v: unknown): v is AppearanceMode => v === 'system' || v === 'light' || v === 'dark';

/** `unspecified` hands the choice back to the system. */
function apply(mode: AppearanceMode): void {
  Appearance.setColorScheme(mode === 'system' ? 'unspecified' : mode);
}

/** The stored choice, applied; `system` when nothing (or something unreadable) is stored. */
export async function loadAppearance(): Promise<AppearanceMode> {
  let mode: AppearanceMode = 'system';
  try {
    const stored = await AsyncStorage.getItem(KEY);
    if (isMode(stored)) mode = stored;
  } catch { /* unreadable storage means the system's look, not a broken start */ }
  apply(mode);
  return mode;
}

export async function saveAppearance(mode: AppearanceMode): Promise<void> {
  apply(mode);
  await AsyncStorage.setItem(KEY, mode);
}
