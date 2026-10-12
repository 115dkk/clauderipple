// Client-only Remote Control transport. Never register or attach a desktop worker.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

export const DESKTOP_BLOCKED = "Mac 앱에서 열려 있는 세션이라 지금은 휴대폰에서 입력할 수 없습니다. / This session is open in the Mac app and cannot currently accept phone input.";
export interface BridgeAuth { accessToken: string; organizationUuid: string; expiresAt: number }
class BridgeNetworkError extends Error {}
export function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
export function loadBridgeAuth(): BridgeAuth {
  try {
    const credentials = object(JSON.parse(execFileSync("security", ["find-generic-password", "-a", process.env.USER ?? os.userInfo().username, "-s", "Claude Code-credentials", "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })));
    const oauth = object(credentials?.claudeAiOauth);
    const account = object(object(JSON.parse(fs.readFileSync(path.join(os.homedir(), ".claude.json"), "utf8")))?.oauthAccount);
    if (typeof oauth?.accessToken !== "string" || typeof oauth.expiresAt !== "number" || typeof account?.organizationUuid !== "string") throw new Error();
    return { accessToken: oauth.accessToken, expiresAt: oauth.expiresAt, organizationUuid: account.organizationUuid };
  } catch { throw new Error("Claude 로그인 정보를 읽을 수 없습니다. / Cannot read Claude login credentials."); }
}
export interface BridgeFrame { event: string; data: Record<string, unknown> }
export class BridgeClient {
  private fetchFn: typeof fetch;
  private auth: () => BridgeAuth;
  constructor(options: { fetch?: typeof fetch; auth?: () => BridgeAuth } = {}) {
    this.fetchFn = options.fetch ?? fetch;
    this.auth = options.auth ?? loadBridgeAuth;
  }
  private async request(id: string, suffix: string, options: RequestInit): Promise<Response> {
    const auth = this.auth();
    if (auth.expiresAt <= Date.now()) throw new Error("Claude 로그인이 만료되었습니다. / Claude login has expired.");
    let response: Response;
    try {
      response = await this.fetchFn(`https://api.anthropic.com/v1/code/sessions/${encodeURIComponent(id)}${suffix}`, {
        ...options, redirect: "error", headers: { Authorization: `Bearer ${auth.accessToken}`, "anthropic-version": "2023-06-01", "anthropic-client-platform": "claude_code_remote", "x-organization-uuid": auth.organizationUuid, "Content-Type": "application/json", "User-Agent": "RippleRemote/0.8.10" },
      });
    } catch { throw new BridgeNetworkError("Remote Control 연결에 실패했습니다. / Remote Control connection failed."); }
    if (!response.ok) {
      await response.body?.cancel();
      // Do not expose server bodies (which may echo credentials), or retry rejected writes.
      throw new Error(`Remote Control 요청이 거절되었습니다 (HTTP ${response.status}). / Remote Control request rejected.`);
    }
    return response;
  }
  async post(id: string, payload: Record<string, unknown>): Promise<void> {
    const response = await this.request(id, "/events", { method: "POST", body: JSON.stringify({ session_id: id, events: [{ payload }] }), signal: AbortSignal.timeout(15_000) });
    await response.body?.cancel();
  }
  send(id: string, uuid: string, text: string): Promise<void> {
    return this.post(id, { type: "user", uuid, message: { role: "user", content: text }, parent_tool_use_id: null });
  }
  interrupt(id: string): Promise<void> {
    return this.post(id, { type: "control_request", request_id: randomUUID(), request: { subtype: "interrupt" } });
  }
  async events(id: string): Promise<Record<string, unknown>> {
    return object(await (await this.request(id, "/events?sort_order=asc", { signal: AbortSignal.timeout(15_000) })).json()) ?? {};
  }
  async stream(id: string, signal: AbortSignal, handle: (frame: BridgeFrame) => void): Promise<void> {
    let sequence = 0;
    while (!signal.aborted) {
      let response: Response;
      try { response = await this.request(id, `/events/stream?from_sequence_num=${sequence}`, { signal }); }
      catch (error) {
        if (signal.aborted) return;
        if (!(error instanceof BridgeNetworkError)) throw error;
        await delay(1000, undefined, { signal }).catch(error => { if (!signal.aborted) throw error; });
        continue;
      }
      if (!response.body) throw new Error("Remote Control stream is empty.");
      let handling = false;
      try {
        for await (const frame of decodeSse(response.body)) {
          handling = true;
          if (frame.event === "catch_up_truncated") throw new Error("Remote Control 이벤트가 누락되었습니다. / Remote Control event replay was truncated.");
          const number = frame.data.sequence_num;
          if (frame.event === "client_event" && typeof number === "number") {
            if (number <= sequence) { handling = false; continue; }
            handle(frame);
            sequence = number;
          } else if (frame.event === "ephemeral_event") handle(frame);
          handling = false;
        }
      } catch (error) {
        if (signal.aborted) return;
        if (handling || (error instanceof Error && error.message.includes("truncated"))) throw error;
        // A broken read reconnects; HTTP rejection above is terminal. Writes are never retried.
      }
      await delay(1000, undefined, { signal }).catch(error => { if (!signal.aborted) throw error; });
    }
  }
}

export async function* decodeSse(body: ReadableStream<Uint8Array>): AsyncGenerator<BridgeFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "", event = "", data: string[] = [];
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return;
      pending += decoder.decode(chunk.value, { stream: true });
      if (pending.length > 4 * 1024 * 1024) throw new Error("Remote Control frame too large.");
      let end: number;
      while ((end = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, end).replace(/\r$/, "");
        pending = pending.slice(end + 1);
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
        else if (!line) {
          if (data.length) {
            const parsed = object(JSON.parse(data.join("\n")));
            if (parsed) yield { event, data: parsed };
          }
          event = ""; data = [];
        }
      }
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
