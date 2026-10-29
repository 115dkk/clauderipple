import { test } from "node:test";
import assert from "node:assert/strict";
import { dropForeignThinking, ThinkingOrigins } from "../src/thinking.ts";
import { ResponseUsageTap } from "../src/requestlog.ts";

// A session switched from a translated model to Claude replays that model's unsigned thinking, and
// Anthropic refused every retry: "each thinking block must contain thinking" (2026-09-28).
test("unsigned thinking from another model is dropped; Anthropic's own is kept", () => {
  const signed = { type: "thinking", thinking: "plan", signature: "EqQBCkgIBxABGAIiQ" };
  const json: Record<string, unknown> = {
    model: "claude-opus-5-5",
    messages: [
      { role: "user", content: "hi" },
      { role: "assistant", content: [{ type: "thinking", thinking: "", signature: "" }, { type: "text", text: "hello" }] },
      { role: "user", content: "next" },
      { role: "assistant", content: [{ type: "thinking", thinking: "summary" }] },
      { role: "user", content: "again" },
      { role: "assistant", content: [signed, { type: "text", text: "done" }] },
    ],
  };
  assert.equal(dropForeignThinking(json), 2);
  assert.deepEqual(json.messages, [
    { role: "user", content: "hi" },
    { role: "assistant", content: [{ type: "text", text: "hello" }] },
    { role: "user", content: "next" },
    // The thinking-only turn goes whole; Anthropic joins the two user turns that meet.
    { role: "user", content: "again" },
    { role: "assistant", content: [signed, { type: "text", text: "done" }] },
  ]);
});

test("provenance is provider-scoped, deterministic per block, bounded and lost on restart", () => {
  const origins = new ThinkingOrigins(2);
  const signed = { type: "thinking", signature: "q-sig" };
  const redacted = { type: "redacted_thinking", data: "q-redacted" };
  origins.remember("q", signed);
  origins.remember("q", redacted);
  assert.equal(origins.owns("p", signed), false);
  assert.equal(new ThinkingOrigins().owns("q", signed), false);
  for (let turn = 0; turn < 3; turn++) {
    const json = { messages: [{ role: "assistant", content: [signed, redacted, { type: "thinking", signature: "foreign" }] }] };
    assert.equal(dropForeignThinking(json, block => origins.owns("q", block)), 1);
    assert.deepEqual(json.messages[0]?.content, [signed, redacted]);
  }
  origins.remember("q", { type: "thinking", signature: "new" });
  assert.equal(origins.owns("q", signed), false);
  assert.equal(origins.owns("q", redacted), true);
});

test("JSON provenance skips long reasoning text and nested tool-input impostors", () => {
  const origins = new ThinkingOrigins();
  const signed = { type: "thinking", thinking: "x".repeat(100_000), signature: "q-sig" };
  const redacted = { data: "q-redacted", type: "redacted_thinking" };
  const tap = new ResponseUsageTap("application/json", undefined, block => origins.remember("q", block));
  const bytes = Buffer.from(JSON.stringify({ content: [signed, redacted, { type: "tool_use", input: { type: "thinking", signature: "impostor" } }] }));
  for (let i = 0; i < bytes.length; i += 19) tap.feed(bytes.subarray(i, i + 19));
  tap.finish();
  assert.equal(origins.owns("q", signed), true);
  assert.equal(origins.owns("q", redacted), true);
  assert.equal(origins.owns("q", { type: "thinking", signature: "impostor" }), false);
});

test("a conversation with nothing foreign is left untouched", () => {
  const messages = [{ role: "assistant", content: [{ type: "thinking", thinking: "x", signature: "sig" }] }];
  const json: Record<string, unknown> = { messages };
  assert.equal(dropForeignThinking(json), 0);
  assert.equal(json.messages, messages);
});
