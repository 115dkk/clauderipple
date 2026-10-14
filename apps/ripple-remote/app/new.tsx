import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, ScrollView, Text, View } from 'react-native';
import type { BrowseResult, Effort, FolderEntry, ModelOption, ProviderGroup } from '../../../packages/remote/src/protocol.ts';
import { t } from '../../../packages/remote/web/i18n.ts';
import { remote } from '../src/client';
import { Button, Field, Frame, Label, List, Opt, Segmented, TopBar, useRemote, useStyles } from '../src/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../src/icons';
import { mono } from '../src/theme';
import type { PermissionMode } from '../../../packages/remote/src/protocol.ts';
import { ModePicker, savedMode, rememberMode } from '../src/mode';
export default function NewSession() {
  const { c, s } = useStyles();
  const insets = useSafeAreaInsets();
  const state = useRemote();
  const scroll = useRef<ScrollView>(null);
  const focused = useRef<'folder' | 'prompt' | null>(null);
  const reveal = () => {
    if (focused.current === 'prompt') scroll.current?.scrollToEnd({ animated: false });
    if (focused.current === 'folder') scroll.current?.scrollTo({ y: 0, animated: false });
  };
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', reveal);
    return () => shown.remove();
  }, []);
  const [folders, setFolders] = useState<FolderEntry[]>([]);
  const [groups, setGroups] = useState<ProviderGroup[]>([]);
  const [cwd, setCwd] = useState('');
  const [model, setModel] = useState<ModelOption | null>(null);
  const [effort, setEffort] = useState<Effort | null>(null);
  const [text, setText] = useState('');
  const [browse, setBrowse] = useState<BrowseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('auto');
  const modePicked = useRef(false);
  useEffect(() => { void savedMode().then(mode => { if (!modePicked.current) setPermissionMode(mode); }).catch(e => remote.report(e)); }, []);
  useEffect(() => {
    if (state.status?.state !== 'open') return;
    void Promise.all([remote.request({ op: 'folders' }), remote.request({ op: 'models' })]).then(([f, m]) => { setFolders(f as FolderEntry[]); setGroups(m as ProviderGroup[]); }).catch(e => remote.report(e));
  }, [state.status?.state]);
  const loadFolder = async (path?: string) => { try { setBrowse(await remote.request({ op: 'browse', path }) as BrowseResult); } catch (e) { remote.report(e); } };
  const create = async () => {
    if (!model || busy) return;
    setBusy(true);
    try { await remote.queue({ t: 'create', cwd, model: model.model, effort, permissionMode, text: text.trim() }); }
    catch (e) { remote.report(e); }
    finally { setBusy(false); }
  };
  const tick = <Icon name="check" size={20} color={c.accent} />;
  const efforts = model?.efforts ?? [];
  return <Frame><TopBar title={t('home.empty.title')} />
    <ScrollView ref={scroll} onContentSizeChange={reveal} style={{ flex: 1 }} automaticallyAdjustKeyboardInsets contentContainerStyle={{ paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
      <Label>{t('folder.title')}</Label>
      <View style={s.filter}><Icon name="folder" size={18} color={c.muted} /><Field onFocus={() => { focused.current = 'folder'; reveal(); }} onBlur={() => { focused.current = null; }} testID="new-folder" accessibilityLabel={t('folder.title')} value={cwd} onChangeText={setCwd} placeholder="/Users/…" autoCapitalize="none" autoCorrect={false} style={{ flex: 1, minHeight: 0, borderWidth: 0, backgroundColor: 'transparent', padding: 0, paddingHorizontal: 0, fontFamily: mono, fontSize: 15 }} /></View>
      {folders.length > 0 && <><Label>{t('folder.recent')}</Label><List>{folders.slice(0, 6).map((f, i) => <Opt key={f.path} first={i === 0} icon={<Icon name="folder" size={20} color={c.muted} />} title={f.name} sub={f.path} on={cwd === f.path} trailing={cwd === f.path ? tick : undefined} onPress={() => setCwd(f.path)} />)}</List></>}
      <View style={{ marginHorizontal: 12, marginTop: 10, alignItems: 'flex-start' }}><Button title={t('folder.browse')} secondary onPress={() => { void loadFolder(cwd || undefined); }} /></View>
      {browse && <>
        <Label>{t('folder.browse')}</Label>
        <Text numberOfLines={1} style={{ marginHorizontal: 20, marginBottom: 8, fontFamily: mono, fontSize: 12.5, color: c.muted }}>{browse.path}</Text>
        <List>
          {browse.parent && <Opt first icon={<Icon name="up" size={20} color={c.muted} />} title={t('folder.up')} onPress={() => { void loadFolder(browse.parent ?? undefined); }} />}
          {browse.entries.map((f, i) => <Opt key={f.path} first={i === 0 && !browse.parent} icon={<Icon name="folder" size={20} color={c.muted} />} title={f.name} trailing={<Icon name="chevron" size={18} color={c.muted} />} onPress={() => { void loadFolder(f.path); }} />)}
          {!browse.entries.length && <Opt first title={t('folder.empty')} />}
        </List>
        <View style={{ marginHorizontal: 12, marginTop: 10 }}><Button title={t('folder.here')} onPress={() => { setCwd(browse.path); setBrowse(null); }} /></View>
      </>}
      <Label>{t('model.title')}</Label>
      {groups.map(g => <View key={g.provider}>
        <Label>{g.usable ? g.label : `${g.label} · ${t('model.unusable')}`}</Label>
        <List>{g.models.map((m, i) => {
          const on = model?.model === m.model;
          const off = !g.usable || !m.usable;
          return <Opt key={m.model} first={i === 0} disabled={off} on={on} icon={<Icon name="model" size={20} color={c.muted} />} title={m.name} sub={m.model} subMono
            trailing={on ? tick : !m.usable ? <Text style={s.badge}>{t('model.unusable')}</Text> : undefined}
            onPress={() => { setModel(m); setEffort(m.efforts.includes('medium') ? 'medium' : m.efforts[0] ?? null); }} />;
        })}</List>
      </View>)}
      {efforts.length > 0 && <View style={{ marginHorizontal: 12, marginTop: 16 }}>
        <Text style={s.segLabel}>{t('model.effort')}</Text>
        <Segmented options={efforts.map(e => ({ value: e, label: t(`effort.${e}`) }))} value={effort} onChange={setEffort} />
      </View>}
      <View style={{ marginHorizontal: 12, marginTop: 16 }}>
        <ModePicker value={permissionMode} onChange={mode => { modePicked.current = true; setPermissionMode(mode); void rememberMode(mode).catch(e => remote.report(e)); }} />
      </View>
      <View style={{ marginHorizontal: 12, marginTop: 16 }}>
        <Field onFocus={() => { focused.current = 'prompt'; reveal(); }} onBlur={() => { focused.current = null; }} testID="new-prompt" accessibilityLabel={t('composer.new')} placeholder={t('composer.new')} value={text} onChangeText={setText} multiline style={{ minHeight: 120, borderRadius: 20, paddingTop: 14, paddingHorizontal: 16, textAlignVertical: 'top', borderColor: c.line2 }} />
      </View>
      <View style={{ marginHorizontal: 12, marginTop: 12 }}><Button big title={t('home.empty.title')} disabled={!cwd || !model || !text.trim() || busy || state.status?.state !== 'open'} onPress={() => { void create(); }} /></View>
    </ScrollView>
  </Frame>;
}
