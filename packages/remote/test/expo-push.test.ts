import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ExpoNotifier, expoBody, expoSender, type ExpoPayload } from '../src/expo-push.ts';
import type { EventBody } from '../src/protocol.ts';
const token = 'ExpoPushToken[device_one]';
const secret = 'PRIVATE PROMPT OUTPUT PATH ERROR';
const permission: EventBody = { kind: 'permission', id: 'p', tool: secret, title: secret, summary: secret, input: secret, canAlways: true };
const done: EventBody = { kind: 'result', ok: true, ms: 1, turns: 1 };
const failed: EventBody = { ...done, ok: false, error: secret };

test('native payload contains only fixed lines and session id; persists per client and respects per-session views', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-push-'));
  try {
    const seen = new Map<string, number>();
    let now = 1_000_000;
    const sent: ExpoPayload[] = [];
    const options = { dir, send: async (p: ExpoPayload) => { sent.push(p); return 'sent' as const; }, seenRecently: (session: string) => now - (seen.get(session) ?? 0) < 180_000, log: () => {} };
    const notifier = new ExpoNotifier(options);
    assert.throws(() => notifier.subscribe('device', 'https://invalid', 'ko'));
    notifier.subscribe('device', token, 'ko');
    const restored = new ExpoNotifier(options);
    assert.deepEqual(restored.devices(), ['device']);
    seen.set('session', now);
    await restored.onEvent('session', permission);
    assert.equal(sent.length, 0);
    seen.delete('session');
    for (const event of [permission, done, failed, { kind: 'user', text: secret, clientMsgId: 'x' } as const]) await restored.onEvent('session', event);
    assert.deepEqual(sent.map(p => p.body), ['승인을 기다립니다', '작업을 마쳤습니다', '작업이 실패했습니다']);
    for (const p of sent) {
      assert.deepEqual(Object.keys(p).sort(), ['body', 'data', 'sound', 'title', 'to', 'ttl']);
      assert.deepEqual(p.data, { session: 'session' });
      assert.ok(!JSON.stringify(p).includes(secret));
    }
    assert.equal(expoBody(failed, 'en'), 'Work failed');
    restored.unsubscribe('device');
    assert.deepEqual(new ExpoNotifier(options).devices(), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('DeviceNotRegistered removes a token but never its concurrent replacement; errors retain tokens', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-push-'));
  try {
    let resolve: ((result: 'gone') => void) | undefined;
    let errors = 0;
    const notifier = new ExpoNotifier({ dir, seenRecently: () => false, log: () => { errors++; }, send: () => new Promise(r => { resolve = r; }) });
    notifier.subscribe('device', token, 'ko');
    const pending = notifier.onEvent('session', failed);
    notifier.subscribe('device', 'ExpoPushToken[replacement]', 'en');
    resolve!('gone'); await pending;
    assert.deepEqual(notifier.devices(), ['device']);
    const gone = notifier.onEvent('session', done);
    resolve!('gone'); await gone;
    assert.deepEqual(notifier.devices(), []);
    const failing = new ExpoNotifier({ dir, seenRecently: () => false, log: () => { errors++; }, send: async () => { throw new Error('network'); } });
    failing.subscribe('device', token, 'ko'); await failing.onEvent('session', done);
    assert.deepEqual(failing.devices(), ['device']); assert.equal(errors, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Expo HTTP boundary handles ticket and receipt invalidation and transient errors', async () => {
  const payload: ExpoPayload = { to: token, title: 'Ripple Remote', body: '작업을 마쳤습니다', data: { session: 's' }, ttl: 86400, sound: 'default' };
  const calls: string[] = [];
  let replies = [{ data: { status: 'ok', id: 'ticket' } }, { data: { ticket: { status: 'error', details: { error: 'DeviceNotRegistered' } } } }];
  const fetcher: typeof fetch = async (url, init) => { calls.push(String(url)); assert.equal(init?.method, 'POST'); return Response.json(replies.shift()); };
  assert.equal(await expoSender(fetcher, async () => {})(payload), 'gone');
  assert.deepEqual(calls, ['https://exp.host/--/api/v2/push/send', 'https://exp.host/--/api/v2/push/getReceipts']);
  const goneFetch: typeof fetch = async () => Response.json({ data: { status: 'error', details: { error: 'DeviceNotRegistered' } } });
  assert.equal(await expoSender(goneFetch)(payload), 'gone');
  const badFetch: typeof fetch = async () => new Response('', { status: 503 });
  await assert.rejects(expoSender(badFetch)(payload), /HTTP 503/);
});
