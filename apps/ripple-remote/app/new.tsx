import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { BrowseResult, Effort, FolderEntry, ModelOption, ProviderGroup } from '../../../packages/remote/src/protocol.ts';
import { t } from '../../../packages/remote/web/i18n.ts';
import { remote } from '../src/client';
import { Button, Field, Label, s, useRemote } from '../src/ui';
export default function NewSession() {
  const state = useRemote();
  const [folders, setFolders] = useState<FolderEntry[]>([]);
  const [groups, setGroups] = useState<ProviderGroup[]>([]);
  const [cwd, setCwd] = useState('');
  const [model, setModel] = useState<ModelOption | null>(null);
  const [effort, setEffort] = useState<Effort | null>(null);
  const [text, setText] = useState('');
  const [browse, setBrowse] = useState<BrowseResult | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (state.status?.state !== 'open') return;
    void Promise.all([remote.request({ op: 'folders' }), remote.request({ op: 'models' })]).then(([f, m]) => { setFolders(f as FolderEntry[]); setGroups(m as ProviderGroup[]); }).catch(e => remote.report(e));
  }, [state.status?.state]);
  const loadFolder = async (path?: string) => { try { setBrowse(await remote.request({ op: 'browse', path }) as BrowseResult); } catch (e) { remote.report(e); } };
  const create = async () => {
    if (!model || busy) return;
    setBusy(true);
    try { await remote.queue({ t: 'create', cwd, model: model.model, effort, text: text.trim() }); }
    catch (e) { remote.report(e); }
    finally { setBusy(false); }
  };
  return <ScrollView style={s.page} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
    <Label>{t('folder.title')}</Label><Field testID="new-folder" accessibilityLabel={t('folder.title')} value={cwd} onChangeText={setCwd} placeholder="/Users/…" autoCapitalize="none" autoCorrect={false} />
    {folders.map(f => <Button key={f.path} title={f.name} secondary onPress={() => setCwd(f.path)} />)}
    <Button title={t('folder.browse')} secondary onPress={() => { void loadFolder(cwd || undefined); }} />
    {browse && <View style={s.card}><Text style={s.mono}>{browse.path}</Text><Button title={t('folder.here')} onPress={() => { setCwd(browse.path); setBrowse(null); }} />{browse.parent && <Button title={t('folder.up')} secondary onPress={() => { void loadFolder(browse.parent ?? undefined); }} />}{browse.entries.map(f => <Button key={f.path} title={f.name} secondary onPress={() => { void loadFolder(f.path); }} />)}</View>}
    <Label>{t('model.title')}</Label>
    {groups.map(g => <View key={g.provider} style={s.card}><Text style={s.muted}>{g.label}</Text>{g.models.map(m => <Button key={m.model} title={`${m.name}${model?.model === m.model ? ' ✓' : ''}${!m.usable ? ` · ${t('model.unusable')}` : ''}`} secondary={model?.model !== m.model} disabled={!g.usable || !m.usable} onPress={() => { setModel(m); setEffort(m.efforts.includes('medium') ? 'medium' : m.efforts[0] ?? null); }} />)}</View>)}
    <Label>{t('model.effort')}</Label><View style={s.row}>{model?.efforts.map(e => <Button key={e} title={t(`effort.${e}`)} secondary={e !== effort} onPress={() => setEffort(e)} />)}</View>
    <Field testID="new-prompt" accessibilityLabel={t('composer.new')} placeholder={t('composer.new')} value={text} onChangeText={setText} multiline style={{ minHeight: 120 }} />
    <Button title={t('home.empty.title')} disabled={!cwd || !model || !text.trim() || busy || state.status?.state !== 'open'} onPress={() => { void create(); }} />
  </ScrollView>;
}
