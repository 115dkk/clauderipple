import test from "node:test";
import assert from "node:assert/strict";
import { BridgeClient, decodeSse } from "../src/bridge-client.ts";

const auth = () => ({ accessToken: "secret-not-for-phone", organizationUuid: "org", expiresAt: Date.now() + 60_000 });
const frame = (sequence: number) => `event: client_event\r\ndata: ${JSON.stringify({ sequence_num: sequence, event_id: `e${sequence}`, source: "worker", payload: { type: "control_cancel_request", request_id: "r" } })}\r\n\r\n`;

test("client writes exact prompt, permission and interrupt envelopes, never worker registration", async () => {
  const calls: { url: string; options: RequestInit }[] = [];
  const client = new BridgeClient({ auth, fetch: async (url, options) => { calls.push({ url: String(url), options: options! }); return new Response("{}"); } });
  await client.send("bridge", "uuid", "hello");
  await client.post("bridge", { type: "control_response", response: { subtype: "success", request_id: "r", response: { behavior: "allow", updatedInput: { command: "true" }, toolUseID: "t" } } });
  await client.interrupt("bridge");
  assert.deepEqual(JSON.parse(String(calls[0]?.options.body)), { session_id: "bridge", events: [{ payload: { type: "user", uuid: "uuid", message: { role: "user", content: "hello" }, parent_tool_use_id: null } }] });
  assert.ok(calls.every(call => call.url === "https://api.anthropic.com/v1/code/sessions/bridge/events"));
  const headers = new Headers(calls[0]?.options.headers);
  assert.equal(headers.get("authorization"), "Bearer secret-not-for-phone");
  assert.equal(headers.get("x-organization-uuid"), "org");
  assert.equal(headers.get("anthropic-beta"), null);
  assert.equal(JSON.parse(String(calls[2]?.options.body)).events[0].payload.request.subtype, "interrupt");
});

test("expired auth never calls fetch; rejected writes are not retried and errors cannot leak token", async () => {
  let calls = 0;
  const expired = new BridgeClient({ auth: () => ({ ...auth(), expiresAt: 0 }), fetch: async () => { calls++; return new Response(); } });
  await assert.rejects(expired.send("b", "u", "text"), /Claude 로그인이 만료되었습니다/);
  assert.equal(calls, 0);
  for (const status of [401, 403, 400, 500]) {
    const client = new BridgeClient({ auth, fetch: async () => { calls++; return new Response("secret-not-for-phone signature_wanted", { status }); } });
    await assert.rejects(client.send("b", "u", "text"), error => error instanceof Error && error.message.includes(`(${status})`) && !error.message.includes("secret-not-for-phone"));
  }
  assert.equal(calls, 4);
  const client = new BridgeClient({ auth, fetch: async () => { throw new Error("secret-not-for-phone"); } });
  await assert.rejects(client.send("b", "u", "text"), error => error instanceof Error && !error.message.includes("secret-not-for-phone"));
});

test("SSE handles split UTF-8 and CRLF frames", async () => {
  const bytes = new TextEncoder().encode(`event: ephemeral_event\r\ndata: {"payload":{"text":"한글"}}\r\n\r\n` + frame(1));
  const stream = new ReadableStream<Uint8Array>({ start(controller) { for (let i = 0; i < bytes.length; i++) controller.enqueue(bytes.slice(i, i + 1)); controller.close(); } });
  const frames = [];
  for await (const value of decodeSse(stream)) frames.push(value);
  assert.equal(frames.length, 2);
  assert.deepEqual(frames[0]?.data, { payload: { text: "한글" } });
});

test("stream reconnects from applied sequence and drops repeated durable events", async () => {
  const urls: string[] = [];
  const abort = new AbortController();
  const client = new BridgeClient({ auth, fetch: async url => { urls.push(String(url)); if (String(url).includes("sort_order=desc")) return Response.json({ data: [{ sequence_num: "3" }] }); return new Response(urls.length === 2 ? frame(4) : frame(4) + frame(5)); } });
  const sequences: unknown[] = [];
  await client.stream("b", abort.signal, event => { sequences.push(event.data.sequence_num); if (event.data.sequence_num === 5) abort.abort(); });
  assert.deepEqual(sequences, [4, 5]);
  assert.ok(urls[1]?.endsWith("from_sequence_num=3"), "starts at the newest event, not 0");
  assert.ok(urls[2]?.endsWith("from_sequence_num=4"));
});

test("stream HTTP auth refusal is terminal", async () => {
  let calls = 0;
  const client = new BridgeClient({ auth, fetch: async () => { calls++; return new Response("untrusted_device", { status: 403 }); } });
  await assert.rejects(client.stream("b", new AbortController().signal, () => {}), /\(403\)/);
  assert.equal(calls, 1);
});
