import React, { useEffect, useRef, useState } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { remote } from './client';
import { Button, Composer, Segmented, copy, useRemote, useStyles } from './ui';
import { ModePicker, modeLabel, rememberMode } from './mode';
import { ATTACHMENT_CAP, ATTACHMENT_COUNT, defaultEffort, type Attachment, type Effort, type ModelOption, type ProviderGroup, type SendBehavior, type SessionSummary } from '../../../packages/remote/src/protocol.ts';
import { COMPOSER_MENU, composerCommand, type ComposerMenuId } from '../../../packages/remote/src/composer-menu.ts';
import { t } from '../../../packages/remote/web/i18n.ts';

// These are Expo 56 standard modules. Kept at the native boundary so host/web never load them.
interface Asset { uri: string; name?: string; fileName?: string | null; mimeType?: string; size?: number; fileSize?: number; base64?: string | null }
interface PickResult { canceled: boolean; assets?: Asset[] | null }
interface ImagePicker { requestCameraPermissionsAsync(): Promise<{ granted: boolean }>; launchCameraAsync(options: { base64: boolean; quality: number }): Promise<PickResult>; launchImageLibraryAsync(options: { mediaTypes: string[]; allowsMultipleSelection: boolean; base64: boolean; quality: number }): Promise<PickResult> }
interface DocumentPicker { getDocumentAsync(options: { multiple: boolean; copyToCacheDirectory: boolean }): Promise<PickResult> }
interface FileSystem { readAsStringAsync(uri: string, options: { encoding: 'base64' }): Promise<string> }
export interface DraftAttachment { name: string; mediaType: string; data: string; uri: string }
interface Draft { id: string; text: string; attachments: DraftAttachment[] }
interface Saved { draft: Draft; queue: Draft[]; behavior: SendBehavior | 'queue' }
const newDraft = (): Draft => ({ id: `phone-${Date.now()}-${Math.random().toString(36).slice(2)}`, text: '', attachments: [] });
export async function savedEffort(model: ModelOption): Promise<Effort | null> {
  const saved = await AsyncStorage.getItem(`effort:${model.model}`);
  return model.efforts.find(e => e === saved) ?? defaultEffort(model.efforts);
}
export async function rememberEffort(model: string, effort: Effort | null): Promise<void> {
  await AsyncStorage.setItem(`effort:${model}`, effort ?? '');
}

export function SessionComposer({ session, busy, connected, onSession, onSend }: { session: SessionSummary; busy: boolean; connected: boolean; onSession: (id: string) => void; onSend?: () => void }) {
  const { c, s } = useStyles();
  const [draft, setDraft] = useState<Draft>(newDraft);
  const [queue, setQueue] = useState<Draft[]>([]);
  const [behavior, setBehavior] = useState<SendBehavior | 'queue'>('steer');
  const [loaded, setLoaded] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sheet, setSheet] = useState<'attachments' | 'model' | null>(null);
  const [models, setModels] = useState<ProviderGroup[]>([]);
  const [commands, setCommands] = useState<string[]>(['clear', 'new']);
  useEffect(() => {
    if (!connected) return;
    void remote.request({ op: 'commands', session: session.id }).then(value => {
      if (Array.isArray(value)) setCommands([...new Set(['clear', 'new', ...value.filter((x): x is string => typeof x === 'string')])]);
    }).catch(e => setError(String(e)));
  }, [connected, session.id]);
  const slash = /^\/(\S*)$/.exec(draft.text)?.[1];
  const lock = useRef(false);
  const state = useRemote();
  const events = state.histories[session.id]?.events ?? [];
  const finishedAt = events.filter(e => e.kind === 'result' || e.kind === 'state' && ['idle', 'error', 'stopped'].includes(e.state)).at(-1)?.seq ?? 0;
  const waitingForTurn = useRef<number | null>(null);
  const saves = useRef(Promise.resolve());
  const current = useRef({ draft, queue, behavior });
  current.current = { draft, queue, behavior };
  const key = `composer:${session.id}`;
  useEffect(() => {
    let alive = true;
    Promise.all([AsyncStorage.getItem(key), AsyncStorage.getItem('sendBehavior')]).then(([raw, last]) => {
      if (!alive) return;
      if (raw) { const value = JSON.parse(raw) as Saved; setDraft(value.draft); setQueue(value.queue); setBehavior(value.behavior); }
      else if (last === 'steer' || last === 'interrupt' || last === 'queue') setBehavior(last);
      setLoaded(true);
    }).catch(e => setError(String(e)));
    return () => { alive = false; };
  }, [key]);
  useEffect(() => {
    if (!loaded) return;
    const data = JSON.stringify({ draft, queue, behavior });
    saves.current = saves.current.catch(e => { setError(String(e)); }).then(() => AsyncStorage.setItem(key, data));
    void saves.current.catch(e => setError(String(e)));
  }, [loaded, key, draft, queue, behavior]);
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  const upload = async (item: Draft): Promise<Attachment[]> => {
    const result: Attachment[] = [];
    for (const [index, a] of item.attachments.entries()) {
      let blob = '';
      for (let offset = 0; offset < a.data.length; offset += 60_000) {
        const done = offset + 60_000 >= a.data.length;
        const response = await remote.request({ op: 'upload', session: session.id, uploadId: `${item.id}-${index}`, offset, data: a.data.slice(offset, offset + 60_000), done });
        if (done) blob = (response as { blob: string }).blob;
      }
      result.push({ blob, name: a.name, mediaType: a.mediaType });
    }
    return result;
  };
  const transmit = async (item: Draft, fromQueue: boolean, selected: SendBehavior) => {
    if (lock.current) return;
    lock.current = true; setSending(true); setError('');
    const before = events.at(-1)?.seq ?? 0;
    try {
      await saves.current;
      const attachments = await upload(item);
      const submitted = remote.submit({ t: 'send', session: session.id, text: item.text.trim(), attachments, behavior: selected }, item.id);
      onSend?.();
      const next = await submitted;
      waitingForTurn.current = next === session.id ? before : null;
      if (fromQueue) setQueue(q => q.filter(x => x.id !== item.id));
      else setDraft(value => value.id === item.id ? newDraft() : value);
      if (next !== session.id) onSession(next);
    } catch (e) { fail(e); }
    finally { lock.current = false; setSending(false); }
  };
  useEffect(() => {
    if (waitingForTurn.current !== null && finishedAt > waitingForTurn.current) waitingForTurn.current = null;
    if (!loaded || busy || !connected || sending || error || waitingForTurn.current !== null || !queue.length) return;
    void transmit(queue[0]!, true, 'steer');
  }, [busy, connected, loaded, sending, queue, error, finishedAt]);
  const send = async () => {
    if (!draft.text.trim() && !draft.attachments.length) return;
    if (behavior !== 'queue') { await transmit(draft, false, behavior); return; }
    if (queue.length >= 20) { setError(copy('큐는 최대 20개입니다.', 'Queue limit: 20 messages.')); return; }
    try {
      const value = { ...current.current, draft: newDraft(), queue: [...queue, draft] };
      await AsyncStorage.setItem(key, JSON.stringify(value));
      setQueue(value.queue); setDraft(value.draft); setError('');
    } catch (e) { fail(e); }
  };
  const pick = async (kind: 'photos' | 'camera' | 'files') => {
    setSheet(null); setError('');
    try {
      let result: PickResult;
      if (kind === 'files') {
        const picker: DocumentPicker = require('expo-document-picker');
        result = await picker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
      } else {
        const picker: ImagePicker = require('expo-image-picker');
        if (kind === 'camera') {
          if (!(await picker.requestCameraPermissionsAsync()).granted) throw new Error(copy('카메라 권한이 필요합니다.', 'Camera permission is required.'));
          result = await picker.launchCameraAsync({ base64: true, quality: 0.85 });
        } else result = await picker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, base64: true, quality: 0.85 });
      }
      if (result.canceled) return;
      const assets = result.assets ?? [];
      if (draft.attachments.length + assets.length > ATTACHMENT_COUNT) throw new Error(copy('첨부는 최대 8개입니다.', 'At most 8 attachments.'));
      const additions: DraftAttachment[] = [];
      for (const a of assets) {
        if ((a.size ?? a.fileSize ?? 0) > ATTACHMENT_CAP) throw new Error(`${a.name ?? a.fileName}: 8 MB limit`);
        const files: FileSystem = require('expo-file-system/legacy');
        const data = a.base64 ?? await files.readAsStringAsync(a.uri, { encoding: 'base64' });
        if (data.length > Math.ceil(ATTACHMENT_CAP / 3) * 4) throw new Error('8 MB limit per attachment');
        additions.push({ name: a.name ?? a.fileName ?? 'photo.jpg', mediaType: a.mimeType ?? (kind === 'files' ? 'application/octet-stream' : 'image/jpeg'), data, uri: a.uri });
      }
      setDraft(d => ({ ...d, id: newDraft().id, attachments: [...d.attachments, ...additions] }));
    } catch (e) { fail(e); }
  };
  const openModels = async () => {
    setSheet('model');
    try { setModels(await remote.request({ op: 'models' }) as ProviderGroup[]); } catch (e) { fail(e); }
  };
  const changeModel = async (model: ModelOption, effort: Effort | null) => {
    try { await remote.command({ t: 'set_model', session: session.id, model: model.model, effort }); await rememberEffort(model.model, effort); setError(''); }
    catch (e) { fail(e); }
  };
  const changeMode = (mode: import('../../../packages/remote/src/protocol.ts').PermissionMode) => {
    const apply = async () => { try { await remote.command({ t: 'set_mode', sessionId: session.id, mode }); await rememberMode(mode); } catch (e) { fail(e); } };
    if (mode !== 'bypassPermissions') { void apply(); return; }
    Alert.alert(modeLabel(mode), copy('경고: 승인 없이 모든 도구를 실행합니다.', 'Warning: all tools run without approval.'), [{ text: copy('취소', 'Cancel'), style: 'cancel' }, { text: copy('허용', 'Bypass'), style: 'destructive', onPress: () => { void apply(); } }]);
  };
  // compact and fresh-session are plain text commands: the host routes "/compact" on (SDK or bridge)
  // and "/clear" starts a new session with the same settings.
  const runMenu = (id: ComposerMenuId) => {
    setSheet(null);
    const go = async () => {
      setSending(true); setError('');
      try {
        const next = await remote.submit({ t: 'send', session: session.id, text: composerCommand(id), behavior: 'steer' }, `${session.id}-${id}-${Date.now()}`);
        if (next !== session.id) onSession(next);
      } catch (e) { fail(e); } finally { setSending(false); }
    };
    const entry = COMPOSER_MENU.find(e => e.id === id);
    if (entry?.confirm) Alert.alert(copy(entry.ko, entry.en), copy(entry.confirm.ko, entry.confirm.en), [{ text: copy('취소', 'Cancel'), style: 'cancel' }, { text: copy(entry.ko, entry.en), style: 'destructive', onPress: () => { void go(); } }]);
    else void go();
  };
  const model = models.flatMap(g => g.models).find(m => m.model === session.model);
  const attachmentViews = draft.attachments.map((a, index) => <Pressable key={`${index}-${a.name}`} disabled={sending} accessibilityLabel={`${a.name} ${copy('제거', 'Remove')}`} onPress={() => setDraft(d => ({ ...d, id: newDraft().id, attachments: d.attachments.filter((_, i) => i !== index) }))} style={{ padding: 6, borderRadius: 10, backgroundColor: c.surface2 }}>
    {a.mediaType.startsWith('image/') && <Image source={{ uri: `data:${a.mediaType};base64,${a.data}` }} style={{ width: 48, height: 48, borderRadius: 6 }} />}
    <Text numberOfLines={1} style={{ maxWidth: 110, color: c.ink2, fontSize: 12 }}>{a.name} ×</Text>
  </Pressable>);
  return <>
    {slash !== undefined && <ScrollView horizontal contentContainerStyle={{ gap: 10, paddingBottom: 8 }}>{commands.filter(name => name.toLowerCase().includes(slash.toLowerCase())).map(name => <Button key={name} title={`/${name}`} secondary onPress={() => setDraft(d => ({ ...d, id: newDraft().id, text: `/${name} ` }))} />)}</ScrollView>}
    {!!queue.length && <ScrollView horizontal style={{ maxHeight: 74 }} contentContainerStyle={{ gap: 8, paddingBottom: 8 }}>
      {queue.map(item => <View key={item.id} style={{ borderRadius: 12, backgroundColor: c.surface2, padding: 8, maxWidth: 220 }}>
        <Text numberOfLines={1} style={{ color: c.ink2 }}>{item.text || copy('첨부', 'Attachments')} · {item.attachments.length}</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable disabled={sending} onPress={() => { if (draft.text || draft.attachments.length) { setError(copy('현재 입력을 먼저 보내거나 지우십시오.', 'Send or clear the current draft first.')); return; } setDraft(item); setQueue(q => q.filter(x => x.id !== item.id)); }}><Text style={{ color: c.accent }}>{copy('편집', 'Edit')}</Text></Pressable>
          <Pressable disabled={sending} onPress={() => setQueue(q => q.filter(x => x.id !== item.id))}><Text style={{ color: c.muted }}>{copy('삭제', 'Remove')}</Text></Pressable>
          <Pressable disabled={sending} onPress={() => { void transmit(item, true, 'steer'); }}><Text style={{ color: c.accent }}>{copy('지금 보내기', 'Send now')}</Text></Pressable>
        </View>
      </View>)}
    </ScrollView>}
    {!!error && <Text accessibilityRole="alert" style={{ color: c.bad, fontSize: 13, marginBottom: 6 }}>{error}</Text>}
    <Composer testID="session-composer" editable={loaded && !sending} value={draft.text} onChangeText={text => setDraft(d => ({ ...d, id: newDraft().id, text }))} placeholder={copy('명령어를 보려면 /를 입력하세요', 'Type / for commands')} canSend={loaded && !sending && (!!draft.text.trim() || !!draft.attachments.length)} onSend={() => { void send(); }}
      onStop={busy ? () => {
        setError(copy('정지 중… 대기열은 자동 전송을 멈춥니다.', 'Stopping… automatic queue delivery is paused.'));
        void remote.command({ t: 'interrupt', session: session.id }).then(() => {
          waitingForTurn.current = null;
          setError(copy('정지했습니다. 대기열은 보존되며 지금 보내기로 재개할 수 있습니다.', 'Stopped. Queue retained; use Send now to resume.'));
        }, fail);
      } : undefined}
      onAttach={() => { if (!sending) setSheet('attachments'); }} onModel={() => { void openModels(); }} modelLabel={`${session.model}${session.permissionMode && session.permissionMode !== 'auto' ? ` · ${modeLabel(session.permissionMode)}` : ''}`} attachments={attachmentViews} />
    <Modal transparent visible={sheet !== null} animationType="slide" onRequestClose={() => setSheet(null)}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' }}>
        <Pressable style={{ flex: 1 }} accessibilityLabel={copy('닫기', 'Close')} onPress={() => setSheet(null)} />
        <ScrollView style={{ maxHeight: '75%', backgroundColor: c.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24 }} contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 12 }} keyboardShouldPersistTaps="handled">
          <Button title={copy('닫기', 'Close')} ghost onPress={() => setSheet(null)} />
          {sheet === 'attachments' ? <>
            <Button title={copy('사진', 'Photos')} onPress={() => { void pick('photos'); }} />
            <Button title={copy('카메라', 'Camera')} onPress={() => { void pick('camera'); }} />
            <Button title={copy('파일', 'Files')} onPress={() => { void pick('files'); }} />
            <Text style={s.foot}>{copy('최대 8개 · 파일당 8 MB. Mac 세션 첨부는 아직 지원하지 않습니다.', 'Up to 8 files · 8 MB each. Attachments are not on Mac sessions yet.')}</Text>
            {COMPOSER_MENU.map(entry => <Button key={entry.id} title={copy(entry.ko, entry.en)} secondary={!!entry.confirm} onPress={() => runMenu(entry.id)} />)}
          </> : <>
            <Text style={{ color: c.muted }}>{copy('강도 변경은 다음 턴부터 적용됩니다. Mac 세션은 Claude 앱에서 변경하십시오.', 'Effort changes apply from the next turn. Change Mac sessions in the Claude app.')}</Text>
            {models.map(g => <View key={g.provider} style={{ gap: 6 }}><Text style={{ color: c.muted }}>{g.label}</Text>{g.models.map(m => <Button key={m.model} title={`${m.model === session.model ? '• ' : ''}${m.name}`} disabled={!g.usable || !m.usable} secondary onPress={() => { void savedEffort(m).then(e => changeModel(m, e)).catch(fail); }} />)}</View>)}
            {!!model?.efforts.length && <Segmented value={session.effort} options={model.efforts.map(e => ({ value: e, label: t(`effort.${e}`) }))} onChange={e => { void changeModel(model, e); }} />}
            <ModePicker value={session.permissionMode ?? 'auto'} onChange={changeMode} />
            <Text style={{ color: c.muted }}>{copy('실행 중 전송 방식', 'Send during a turn')}</Text>
            <Segmented value={behavior} options={[{ value: 'steer', label: copy('끼워 넣기', 'Steer') }, { value: 'interrupt', label: copy('중단 후 전송', 'Interrupt') }, { value: 'queue', label: copy('대기열', 'Queue') }]} onChange={v => { setBehavior(v); void AsyncStorage.setItem('sendBehavior', v).catch(fail); }} />
            {busy && <Button title={copy('입력 보내기', 'Send input')} disabled={sending || (!draft.text.trim() && !draft.attachments.length)} onPress={() => { setSheet(null); void send(); }} />}
            {!!error && <Text accessibilityRole="alert" style={{ color: c.bad }}>{error}</Text>}
          </>}
        </ScrollView>
      </View>
    </Modal>
  </>;
}
