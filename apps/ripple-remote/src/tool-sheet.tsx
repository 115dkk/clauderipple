import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BlobChunk, Text as WireText } from '../../../packages/remote/src/protocol.ts';
import type { ToolView } from '../../../packages/remote/web/timeline.ts';
import { numberedRead, pretty, record, stringField, toolDiffs, toolInput, webLinks } from '../../../packages/remote/src/tool-details.ts';
import { remote } from './client';
import { Button, copy, useStyles } from './ui';
import { Icon } from './icons';
import { mono } from './theme';
import { Markdown } from './markdown';

export async function loadEventText(value: WireText, session: string): Promise<string> {
  if (typeof value === 'string') return value;
  let offset = 0, text = '';
  for (;;) {
    const page = await remote.request({ op: 'blob', session, id: value.blob, offset }) as BlobChunk;
    text += page.text;
    if (page.next === null) return text;
    offset = page.next;
  }
}
function useDetailText(value: WireText | undefined, session: string) {
  const [loaded, setLoaded] = useState<{ id: string; text: string } | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const id = typeof value === 'object' ? value.blob : '';
  useEffect(() => {
    let cancelled = false;
    setError('');
    if (typeof value !== 'object') return;
    void loadEventText(value, session).then(text => { if (!cancelled) setLoaded({ id, text }); }).catch(e => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [id, session, retry]);
  const ready = typeof value !== 'object' || loaded?.id === id;
  return { text: typeof value === 'string' ? value : loaded?.id === id ? loaded.text : value?.preview ?? '', ready, error, retry: () => setRetry(n => n + 1) };
}
function Code({ text }: { text: string }) {
  const { c } = useStyles();
  return <ScrollView horizontal nestedScrollEnabled><Text selectable style={{ fontFamily: mono, color: c.ink2, fontSize: 12.5, lineHeight: 20, padding: 12 }}>{text}</Text></ScrollView>;
}
function Output({ text, failed = false }: { text: string; failed?: boolean }) {
  const { c } = useStyles();
  return <View style={{ gap: 4, backgroundColor: failed ? c.badSoft : c.sunk, borderRadius: 10 }}>
    {failed && <Text accessibilityRole="alert" style={{ color: c.bad, fontWeight: '700', padding: 12, paddingBottom: 0 }}>{copy('오류', 'Error')}</Text>}
    <Code text={text} />
  </View>;
}
function ToolDetail({ tool, inputText, output }: { tool: ToolView; inputText: string; output: string }) {
  const { c } = useStyles();
  const input = toolInput(inputText);
  const name = tool.name;
  if (name === 'Bash' || name === 'BashOutput') return <><Code text={`$ ${stringField(input, 'command') || tool.summary}`} /><Output text={output || copy('출력을 기다리는 중…', 'Waiting for output…')} /></>;
  if (name === 'Edit' || name === 'MultiEdit') return <>
    {!input ? <Code text={inputText} /> : toolDiffs(name, input).map((diff, i) => <View key={i} style={{ backgroundColor: c.sunk, borderRadius: 10, overflow: 'hidden' }}>
      <Code text={`--- a/${diff.path}\n+++ b/${diff.path}\n${diff.header}`} />
      <ScrollView horizontal nestedScrollEnabled><View style={{ minWidth: '100%' }}>{diff.lines.map((line, j) => <Text selectable key={j} style={{ fontFamily: mono, fontSize: 12.5, lineHeight: 20, paddingHorizontal: 10, color: line.kind === 'add' ? c.ok : line.kind === 'remove' ? c.bad : c.ink2, backgroundColor: line.kind === 'add' ? c.okSoft : line.kind === 'remove' ? c.badSoft : 'transparent' }}>{line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '} {line.text}</Text>)}</View></ScrollView>
      <Text style={{ color: c.muted, padding: 10, fontSize: 12 }}>{copy('입력 조각 기준 diff입니다. 파일 전체 위치는 포함되지 않습니다.', 'Diff of the supplied edit fragment; full-file positions are not available.')}</Text>
    </View>)}
    {!!output && <Output text={output} />}
  </>;
  if (name === 'Write') return <><Text style={{ color: c.muted }}>{stringField(input, 'file_path')}</Text><Code text={stringField(input, 'content') || inputText} />{!!output && <Output text={output} />}</>;
  if (name === 'Read') return <ScrollView horizontal nestedScrollEnabled><View>{numberedRead(output, input).map((line, i) => <View key={i} style={{ flexDirection: 'row', gap: 12 }}><Text style={{ fontFamily: mono, fontSize: 12.5, lineHeight: 20, color: c.faint, minWidth: 44, textAlign: 'right' }}>{line.number}</Text><Text selectable style={{ fontFamily: mono, fontSize: 12.5, lineHeight: 20, color: c.ink2 }}>{line.text}</Text></View>)}</View></ScrollView>;
  if (name === 'Grep' || name === 'Glob' || name === 'LS') return <><Code text={pretty(inputText)} /><Text style={{ color: c.muted }}>{copy('검색 결과', 'Search results')}</Text><View style={{ backgroundColor: c.sunk, borderRadius: 10 }}>{output.split('\n').filter(Boolean).map((file, index) => <Text selectable key={index} style={{ color: c.ink2, fontFamily: mono, fontSize: 12.5, padding: 10, borderBottomWidth: 1, borderColor: c.line }}>{file}</Text>)}</View></>;
  if (name === 'WebFetch' || name === 'WebSearch') {
    const links = webLinks(output);
    for (const link of webLinks(stringField(input, 'url'))) if (!links.some(existing => existing.url === link.url)) links.push(link);
    return <><Code text={stringField(input, 'query') || stringField(input, 'prompt')} />{links.map(link => <View key={link.url} style={{ padding: 12, borderRadius: 10, backgroundColor: c.sunk, gap: 4 }}><Text selectable style={{ color: c.ink, fontWeight: '600' }}>{link.title}</Text><Text selectable style={{ color: c.accent, fontSize: 13 }}>{link.url}</Text></View>)}{!!output && <Output text={output} />}</>;
  }
  if (name === 'TodoWrite' && Array.isArray(input?.todos)) return <>{input.todos.map((value, i) => { const todo = record(value); return <View key={i} style={{ flexDirection: 'row', gap: 10, paddingVertical: 8 }}><Icon name={todo?.status === 'completed' ? 'check' : 'clock'} size={18} color={todo?.status === 'completed' ? c.ok : c.muted} /><Text style={{ flex: 1, color: c.ink, textDecorationLine: todo?.status === 'completed' ? 'line-through' : 'none' }}>{stringField(todo, 'content')}</Text></View>; })}{!!output && <Output text={output} />}</>;
  if (name === 'Task' || name === 'Agent') return <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 14, padding: 14, gap: 10 }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name="model" size={20} color={c.accent} /><Text style={{ color: c.ink, fontWeight: '700', flex: 1 }}>{stringField(input, 'description') || tool.summary}</Text></View><Text style={{ color: c.muted }}>{[stringField(input, 'subagent_type'), stringField(input, 'model'), !tool.result ? copy('실행 중', 'Running') : tool.result.ok ? copy('완료', 'Done') : copy('실패', 'Failed')].filter(Boolean).join(' · ')}</Text><Markdown text={stringField(input, 'prompt') || inputText} />{!!output && <Output text={output} />}</View>;
  if (name === 'ExitPlanMode') return <><Markdown text={stringField(input, 'plan') || inputText} />{!!output && <Output text={output} />}</>;
  return <><Text style={{ color: c.muted }}>{copy('입력', 'Input')}</Text><Code text={pretty(inputText)} />{!!output && <><Text style={{ color: c.muted }}>{copy('출력', 'Output')}</Text><Output text={pretty(output)} /></>}</>;
}

/** Mounted above the virtualized timeline. It receives the current tool, not a captured snapshot. */
export function ToolSheet({ tool, session, onClose, worker }: { tool: ToolView; session: string; onClose: () => void; worker?: React.ReactNode }) {
  const { c } = useStyles();
  const insets = useSafeAreaInsets();
  const [full, setFull] = useState(false);
  const input = useDetailText(tool.input, session);
  const output = useDetailText(tool.result?.text, session);
  return <Modal visible transparent animationType="slide" onRequestClose={onClose}>
    <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000066' }}>
      <Pressable accessibilityRole="button" accessibilityLabel={copy('상세 닫기', 'Close details')} style={{ flex: 1 }} onPress={onClose} />
      <View accessibilityViewIsModal style={{ height: full ? '95%' : '60%', backgroundColor: c.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingBottom: insets.bottom, paddingTop: 8 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={copy('시트 높이 변경', 'Change sheet height')} onPress={() => setFull(v => !v)} style={{ alignSelf: 'center', padding: 8 }}><View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: c.faint }} /></Pressable>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, gap: 10 }}>
          <Text style={{ flex: 1, color: c.ink, fontSize: 17, fontWeight: '700' }}>{tool.name}</Text>
          {!tool.result && <ActivityIndicator color={c.accent} />}
          <Button title={full ? '60%' : copy('전체 화면', 'Full height')} ghost onPress={() => setFull(v => !v)} />
          <Button title={copy('닫기', 'Close')} ghost onPress={onClose} />
        </View>
        <FlatList data={['detail']} keyExtractor={v => v} style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12 }} renderItem={() => <View style={{ gap: 12 }}>
          {[input, output].map((value, i) => value.error ? <View key={i}><Text accessibilityRole="alert" style={{ color: c.bad }}>{value.error}</Text><Button title={copy('다시 시도', 'Retry')} ghost onPress={value.retry} /></View> : !value.ready ? <ActivityIndicator key={i} color={c.accent} /> : null)}
          <ToolDetail tool={tool} inputText={input.text} output={output.text} />
          {worker}
          {tool.result?.ok === false && <Output text={output.text || copy('도구 실행에 실패했습니다.', 'Tool failed.')} failed />}
        </View>} />
      </View>
    </View>
  </Modal>;
}
