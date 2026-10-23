// Antigravity counts Gemini models and Claude/GPT models as two quota groups (usage.ts, measured
// 2026-10-15). A spent Claude group used to rest the whole account: on 2026-10-23 one 429 for
// claude-opus-5-5-low ("Individual quota reached … Resets in 4h51m") refused every gemini-3.8-flash
// turn with "every signed-in account is at its limit" for five hours while the Gemini group read 0%.
// A 429 now rests only the group of the model that met it.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { GoogleAdapter, type GoogleOutcome } from "../src/providers/google/index.ts";
import { saveGoogleAccount } from "../src/providers/google/accounts.ts";
import { antigravityQuotaScope } from "../src/providers/google/usage.ts";
import { Logger } from "../src/log.ts";
import type { AnthropicRequest } from "../src/providers/chatgpt/translate.ts";

// The body Cloud Code Assist sent on 2026-10-23 for claude-opus-5-5-low, shortened only in its message.
const THIRD_PARTY_429 = { error: {
  code: 429, message: "Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 4h51m35s.", status: "RESOURCE_EXHAUSTED",
  details: [
    { "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "QUOTA_EXHAUSTED", domain: "cloudcode-pa.googleapis.com",
      metadata: { quotaResetTimeStamp: "2026-10-23T07:31:42Z", uiMessage: "true", model: "claude-opus-5-5-low", quotaResetDelay: "4h51m35.094691562s" } },
    { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "17495.094691562s" },
  ],
} };
const OK = { response: { candidates: [{ content: { parts: [{ text: "OK" }] }, finishReason: "STOP" }] } };

const ask = (model: string): AnthropicRequest => ({ model, max_tokens: 64, stream: false, system: "sys", messages: [{ role: "user", content: "Reply OK." }] });
const GEMINI = "gemini-3.8-flash";
const OPUS = "claude-opus-5-5-low";

type Reply = { status: number; body: unknown };

async function rig(t: TestContext, reply: (seen: { token: string | undefined; model: string }) => Reply, accounts = 1) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cr-quota-scope-"));
  const seen: { token: string | undefined; model: string }[] = [];
  const upstream = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const call = { token: req.headers.authorization, model: String((JSON.parse(body) as { model?: unknown }).model ?? "") };
    seen.push(call);
    const r = reply(call);
    res.writeHead(r.status, { "content-type": "application/json" }).end(JSON.stringify(r.body));
  });
  await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
  for (let n = 1; n <= accounts; n++) saveGoogleAccount(home, {
    accessToken: `token-${n}`, projectId: `project-${n}`, email: `user-${n}@example.test`, expiresAt: Date.now() + 3_600_000,
  });
  const adapter = new GoogleAdapter("google", { type: "google", auth: "antigravity", url }, home, new Logger(null, 1e6, 1, false));
  const outcomes: GoogleOutcome[] = [];
  const front = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const json = JSON.parse(body) as AnthropicRequest;
    outcomes.push(await adapter.handle(req, res, "/v1/messages", json, json.model, "low"));
  });
  await new Promise<void>(resolve => front.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    for (const server of [front, upstream]) {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    fs.rmSync(home, { recursive: true, force: true });
  });
  const call = async (model: string) => {
    const r = await fetch(`http://127.0.0.1:${(front.address() as { port: number }).port}/v1/messages`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(ask(model)), signal: AbortSignal.timeout(30_000),
    });
    return { status: r.status, text: await r.text() };
  };
  return { adapter, seen, outcomes, call };
}

test("models map onto the two measured quota groups; anything else has none", () => {
  for (const model of ["gemini-3.8-flash", "gemini-3.8-flash@high", "Gemini-4-Pro"]) assert.equal(antigravityQuotaScope(model), "gemini", model);
  for (const model of ["claude-opus-5-5-low", "claude-sonnet-5-5-high", "gpt-oss-120b", "gpt-oss"]) assert.equal(antigravityQuotaScope(model), "3p", model);
  for (const model of ["gpt-6-luna", "gpt-ossify", "deepseek-v4", ""]) assert.equal(antigravityQuotaScope(model), undefined, model);
});

test("a spent Claude group rests only Claude models: Gemini keeps answering on the same account", async t => {
  const r = await rig(t, ({ model }) => model.startsWith("claude-") ? { status: 429, body: THIRD_PARTY_429 } : { status: 200, body: OK });

  const spent = await r.call(OPUS);
  assert.equal(spent.status, 429);
  assert.match(JSON.parse(spent.text).error.message, /Individual quota reached/);
  assert.equal(r.outcomes[0]!.exhaustion, undefined, "a spent group is not the provider's exhaustion");

  // The account stays in rotation, with the group's rest beside it.
  const [account] = r.adapter.accountStatus();
  assert.equal(account!.state, "ready");
  assert.ok((account!.quotaCooldowns?.["3p"] ?? 0) > 17_000, "the group rests until Google's stated reset");
  assert.equal(account!.quotaCooldowns?.gemini, undefined);
  assert.equal(r.adapter.hasUsable(GEMINI), true);
  assert.equal(r.adapter.hasUsable(OPUS), false);
  assert.equal(r.adapter.hasUsable("claude-sonnet-5-5-high"), false, "the whole group, not just the one model");
  assert.equal(r.adapter.hasUsable(), true);

  const gemini = await r.call(GEMINI);
  assert.equal(gemini.status, 200, "not refused with 'every signed-in account is at its limit'");
  assert.match(gemini.text, /"text":"OK"/);
  assert.equal(r.seen.length, 2, "the Gemini turn reached Google");

  const again = await r.call("claude-sonnet-5-5-high");
  assert.equal(again.status, 429);
  assert.match(JSON.parse(again.text).error.message, /the Claude\/GPT quota is spent on every signed-in account; Gemini models still answer\. The first is usable again at/);
  assert.equal(r.seen.length, 2, "nothing sent for the resting group");
  assert.equal(r.outcomes[2]!.exhaustion, undefined);
});

test("with two accounts, a spent group moves the turn to the next account and leaves the first for Gemini", async t => {
  const r = await rig(t, ({ token, model }) => model.startsWith("claude-") && token === "Bearer token-1" ? { status: 429, body: THIRD_PARTY_429 } : { status: 200, body: OK }, 2);
  const opus = await r.call(OPUS);
  assert.equal(opus.status, 200);
  assert.deepEqual(r.seen.map(s => s.token), ["Bearer token-1", "Bearer token-2"]);
  assert.deepEqual(r.adapter.accountStatus().map(a => [a.state, Object.keys(a.quotaCooldowns ?? {})]), [["ready", ["3p"]], ["ready", []]]);
  // The conversation stays on the account that answered (its cache), and the first one is still in
  // rotation for Gemini: only its Claude group rests.
  const gemini = await r.call(GEMINI);
  assert.equal(gemini.status, 200);
  assert.equal(r.seen.at(-1)!.token, "Bearer token-2");
  assert.equal(r.adapter.hasUsable(OPUS), true, "the second account still has Claude quota");
});

test("a 429 that does not prove a spent group still rests the whole account", async t => {
  for (const body of [
    { error: { code: 429, message: "Resource has been exhausted (e.g. check quota).", status: "RESOURCE_EXHAUSTED" } },
    { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "x", details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "QUOTA_EXHAUSTED" }] } },
    { error: { ...THIRD_PARTY_429.error, details: [{ ...THIRD_PARTY_429.error.details[0], metadata: { model: "gemini-3.8-flash" } }] } },
  ]) {
    const r = await rig(t, () => ({ status: 429, body }));
    assert.equal((await r.call(OPUS)).status, 429);
    const [account] = r.adapter.accountStatus();
    assert.equal(account!.state, "cooling", JSON.stringify(body));
    assert.equal(account!.quotaCooldowns, undefined);
    assert.equal(r.adapter.hasUsable(GEMINI), false);
    assert.match(JSON.parse((await r.call(GEMINI)).text).error.message, /every signed-in account is at its limit/);
  }
});

test("a failure that is about the account still rests all of it", async t => {
  const r = await rig(t, () => ({ status: 402, body: { error: { code: 402, message: "Payment required", status: "FAILED_PRECONDITION" } } }));
  assert.ok((await r.call(OPUS)).status >= 400);
  const [account] = r.adapter.accountStatus();
  assert.equal(account!.state, "cooling");
  assert.equal(account!.quotaCooldowns, undefined);
  assert.equal(r.adapter.hasUsable(GEMINI), false);
  assert.equal((await r.call(GEMINI)).status, 429);
  assert.equal(r.seen.length, 1);
});

test("clearing an account's cooldown also clears its resting groups", async t => {
  let spent = true;
  const r = await rig(t, ({ model }) => spent && model.startsWith("claude-") ? { status: 429, body: THIRD_PARTY_429 } : { status: 200, body: OK });
  await r.call(OPUS);
  assert.equal(r.adapter.hasUsable(OPUS), false);
  spent = false;
  const [account] = r.adapter.accountStatus();
  r.adapter.clearCooldown(account!.id);
  assert.equal(r.adapter.accountStatus()[0]!.quotaCooldowns, undefined);
  assert.equal((await r.call(OPUS)).status, 200);
});
