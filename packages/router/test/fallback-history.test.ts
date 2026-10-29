import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import tls from "node:tls";
import { once } from "node:events";
import { DEFAULTS, type Config } from "../src/config.ts";
import { CertStore } from "../src/certs.ts";
import { createCa } from "../src/x509.ts";
import { Proxy } from "../src/proxy.ts";
import { UpstreamHealth } from "../src/health.ts";
import { Logger } from "../src/log.ts";
import { RequestLog } from "../src/requestlog.ts";
import { normalizeSettings } from "../../mod/hooks/settings.ts";
import { workerLadderLine } from "../../mod/hooks/ladder.ts";

type Block = { type: string; [key: string]: unknown };
type Message = { role: string; content: string | Block[] };
type Body = { model: string; messages: Message[] };
const signed: Block = { type: "thinking", thinking: "fallback reasoning", signature: "opaque-fallback-signature" };
const redacted: Block = { type: "redacted_thinking", data: "opaque-fallback-redaction" };
const text: Block = { type: "text", text: "Working" };
const tool: Block = { type: "tool_use", id: "call_1", name: "Read", input: { file_path: "/example" } };
const own = [signed, redacted, text, tool];

async function fixture(stream: boolean, run: (f: {
  cfg: Config; seen: Body[];
  send: (messages: Message[], model: string) => Promise<{ status: number; raw: string }>;
}) => Promise<void>) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ripple-fallback-history-"));
  const ca = createCa({ cn: "isolated fallback test" });
  fs.writeFileSync(path.join(home, "ca.pem"), ca.certPem);
  fs.writeFileSync(path.join(home, "ca.key"), ca.keyPem);
  const seen: Body[] = [];
  const upstream = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (b: Buffer) => chunks.push(b));
    req.on("end", () => {
      const body: Body = JSON.parse(Buffer.concat(chunks).toString());
      seen.push(body);
      if (body.model === "primary") {
        res.writeHead(410, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "Model primary has been deprecated." } }));
        return;
      }
      if (!stream) {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: "msg_fallback", type: "message", role: "assistant", content: own, stop_reason: "tool_use" }));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const event = (data: Record<string, unknown>) => `event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`;
      const events = [event({ type: "message_start", message: { id: "msg_fallback", role: "assistant", content: [] } })];
      own.forEach((block, index) => {
        events.push(event({ type: "content_block_start", index, content_block: block.type === "thinking" ? { ...block, signature: "" } : block }));
        if (block.type === "thinking") {
          const signature = String(block.signature);
          for (const fragment of [signature.slice(0, 9), signature.slice(9)]) events.push(event({ type: "content_block_delta", index, delta: { type: "signature_delta", signature: fragment } }));
        }
        events.push(event({ type: "content_block_stop", index }));
      });
      events.push(event({ type: "message_stop" }));
      const bytes = Buffer.from(events.join(""));
      // Split JSON fields and UTF-8 transport arbitrarily, not just at event boundaries.
      for (let i = 0; i < bytes.length; i += 17) res.write(bytes.subarray(i, i + 17));
      res.end();
    });
  });
  upstream.listen(0, "127.0.0.1"); await once(upstream, "listening");
  const url = `http://127.0.0.1:${(upstream.address() as net.AddressInfo).port}`;
  const probe = net.createServer(); probe.listen(0, "127.0.0.1"); await once(probe, "listening");
  const port = (probe.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const cfg: Config = { ...DEFAULTS, listen: { host: "127.0.0.1", port }, routes: {}, direct: [], aliases: { primary: "primary", approved: "approved" }, providers: {
    p: { type: "anthropic-compatible", url, identity: false, models: [{ id: "primary" }] },
    q: { type: "anthropic-compatible", url, identity: false, models: [{ id: "approved" }], caps: { thinking: "enabled" } },
  } };
  fs.writeFileSync(path.join(home, "mod-settings.json"), JSON.stringify({ revision: 1, settings: normalizeSettings({ rules: { general: { mode: "ladder", rungs: {
    hard: [{ target: { agent: "primary" }, effort: "high" }, { target: { agent: "approved" }, effort: "low" }],
  } } } }) }));
  const proxy = new Proxy({ config: () => cfg, home, agentDir: home, certs: new CertStore(home), log: new Logger(null, 1e6, 1, false), health: new UpstreamHealth(() => 100, () => {}), requests: new RequestLog(path.join(home, "requests.jsonl")) });
  await proxy.listen();
  async function send(messages: Message[], model: string) {
    const socket = net.connect(port, "127.0.0.1"); await once(socket, "connect");
    socket.write("CONNECT api.anthropic.com:443 HTTP/1.1\r\nHost: api.anthropic.com:443\r\n\r\n"); await once(socket, "data");
    const secure = tls.connect({ socket, servername: "api.anthropic.com", ca: ca.certPem }); await once(secure, "secureConnect");
    const response = new Promise<string>((resolve, reject) => {
      let raw = "";
      secure.setTimeout(5000, () => secure.destroy(new Error("isolated request timed out")));
      secure.on("data", (b: Buffer) => { raw += b.toString(); }); secure.on("end", () => resolve(raw)); secure.on("error", reject);
    });
    const body = JSON.stringify({ model, stream, max_tokens: 128, messages });
    secure.write(`POST /v1/messages HTTP/1.1\r\nHost: api.anthropic.com\r\nConnection: close\r\nx-claude-code-session-id: fallback-test\r\nx-claude-code-agent-id: worker-a\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    try { const raw = await response; return { status: Number(/^HTTP\/1.1 (\d+)/.exec(raw)?.[1]), raw }; }
    finally { secure.destroy(); }
  }
  try { await run({ cfg, seen, send }); }
  finally { proxy.close(); upstream.closeAllConnections(); await new Promise<void>(resolve => upstream.close(() => resolve())); fs.rmSync(home, { recursive: true, force: true }); }
}

for (const stream of [false, true]) {
  for (const ladder of [false, true]) {
    test(`${ladder ? "LADDER" : "FAILOVER"} preserves target-owned thinking and stable prefixes (${stream ? "SSE" : "JSON"})`, async () => {
      await fixture(stream, async ({ send, seen, cfg }) => {
        cfg.routes.worker = { provider: "p", model: "primary", fallbacks: [{ provider: "q", model: "approved" }] };
        const first: Message = { role: "user", content: (ladder ? workerLadderLine({ pick: "hard-pick", model: "primary@high", fallbacks: ["approved@low"] }) + "\n" : "") + "Start" };
        const model = ladder ? "primary@high" : "worker";
        assert.equal((await send([first], model)).status, 410);
        const foreign: Block[] = [{ ...signed, signature: "unknown-signature" }, { ...redacted, data: "unknown-redaction" }];
        const foreignTurn: Message = { role: "assistant", content: [...foreign, text] };
        assert.equal((await send([first, foreignTurn], model)).status, 200);
        assert.deepEqual(seen.at(-1)?.messages, [first, { ...foreignTurn, content: [text] }]);
        const history: Message[] = [first, foreignTurn, { role: "assistant", content: own }, { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "file bytes" }] }];
        assert.equal((await send(history, model)).status, 200);
        const prefix = seen.at(-1)?.messages;
        assert.deepEqual(prefix, [first, { ...foreignTurn, content: [text] }, ...history.slice(2)]);
        assert.equal((await send([...history, { role: "user", content: "next" }], model)).status, 200);
        assert.deepEqual(seen.at(-1)?.messages.slice(0, history.length), prefix);
      });
    });
  }
}

test("never-rerouted compatible request keeps unknown signed/redacted blocks", async () => {
  await fixture(false, async ({ send, seen }) => {
    const messages: Message[] = [{ role: "user", content: "Start" }, { role: "assistant", content: own }];
    assert.equal((await send(messages, "approved@low")).status, 200);
    assert.deepEqual(seen.at(-1)?.messages, messages);
  });
});
