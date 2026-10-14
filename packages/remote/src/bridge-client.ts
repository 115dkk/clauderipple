// Client-only Remote Control transport. Never register or attach a desktop worker.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

export const DESKTOP_BLOCKED = "Claude 앱에서 열려 있는 세션에 지금은 보낼 수 없습니다.";
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
  } catch { throw new Error("이 컴퓨터의 Claude 로그인 정보를 읽을 수 없습니다."); }
}
export interface BridgeFrame { event: string; data: Record<string, unknown> }
/** `slash_commands` minus `terminal_slash_commands`, which phone UIs should hide (SDK init docs). */
export function slashCommands(init: Record<string, unknown>): string[] | null {
  if (!Array.isArray(init.slash_commands)) return null;
  const terminal = new Set(Array.isArray(init.terminal_slash_commands) ? init.terminal_slash_commands : []);
  return init.slash_commands.filter((c): c is string => typeof c === "string" && !!c && !terminal.has(c));
}

export class BridgeClient {
  private fetchFn: typeof fetch;
  private loadAuth: () => BridgeAuth;
  private cached: BridgeAuth | null = null;
  constructor(options: { fetch?: typeof fetch; auth?: () => BridgeAuth } = {}) {
    this.fetchFn = options.fetch ?? fetch;
    this.loadAuth = options.auth ?? loadBridgeAuth;
  }
  /**
   * The keychain read is a synchronous child process; doing it per request blocked the host's
   * event loop under the 3 s state poll until relay pings timed out (2026-10-12). Kept in memory
   * and reread only near expiry or after a 401 (Claude Code refreshes the token on its own).
   */
  private auth(): BridgeAuth {
    if (!this.cached || this.cached.expiresAt - Date.now() < 5 * 60_000) this.cached = this.loadAuth();
    return this.cached;
  }
  private async request(id: string, suffix: string, options: RequestInit): Promise<Response> {
    const auth = this.auth();
    if (auth.expiresAt <= Date.now()) throw new Error("이 컴퓨터의 Claude 로그인이 만료되었습니다. Claude 앱을 한 번 열어 주십시오.");
    let response: Response;
    try {
      // The bridge treats a prompt as the user's own only from a person's app platform
      // (ios, android, web_claude_ai, desktop_app in CLI 2.1.296); any claude_code_* platform
      // is demoted to "a message from another Claude session". These prompts are typed on a phone.
      response = await this.fetchFn(`https://api.anthropic.com/v1/code/sessions/${encodeURIComponent(id)}${suffix}`, {
        ...options, redirect: "error", headers: { Authorization: `Bearer ${auth.accessToken}`, "anthropic-version": "2023-06-01", "anthropic-client-platform": "ios", "x-organization-uuid": auth.organizationUuid, "Content-Type": "application/json", "User-Agent": "RippleRemote/0.8.10" },
      });
    } catch { throw new BridgeNetworkError("Claude 앱과 연결하지 못했습니다."); }
    if (!response.ok) {
      if (response.status === 401) this.cached = null;
      await response.body?.cancel();
      // Do not expose server bodies (which may echo credentials), or retry rejected writes.
      throw new Error(`Claude 앱이 메시지를 받지 않았습니다 (${response.status}).`);
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
  async session(id: string): Promise<{ worker_status: "running" | "idle" | "requires_action"; status?: string; status_bucket?: string; connection_status?: string }> {
    const response = object(await (await this.request(id, "", { method: "GET", signal: AbortSignal.timeout(3000) })).json());
    // CLI 2.1.296's single-session read uses response_shape ?? session.
    const body = object(response?.response_shape ?? response?.session) ?? response;
    const worker_status = body?.worker_status;
    if (worker_status !== "running" && worker_status !== "idle" && worker_status !== "requires_action") throw new Error("Remote Control session has no valid worker status.");
    return { worker_status, ...(typeof body?.status === "string" ? { status: body.status } : {}),
      ...(typeof body?.status_bucket === "string" ? { status_bucket: body.status_bucket } : {}),
      ...(typeof body?.connection_status === "string" ? { connection_status: body.connection_status } : {}) };
  }
  async events(id: string): Promise<Record<string, unknown>> {
    return object(await (await this.request(id, "/events?sort_order=asc", { signal: AbortSignal.timeout(15_000) })).json()) ?? {};
  }
  /** The session's slash commands, from the CLI's init event, without the terminal-only ones; null when it has none. */
  async commands(id: string): Promise<string[] | null> {
    const list = (await this.events(id)).data;
    for (const value of Array.isArray(list) ? list : []) {
      const payload = object(object(value)?.payload);
      if (payload?.type === "system" && payload.subtype === "init") return slashCommands(payload);
    }
    return null;
  }
  /**
   * Authorization requests still open on the session, oldest first. The stream starts at the
   * newest event (`latest` below), so attach and every reconnect replay this list from the start
   * cursor instead — otherwise an approval requested before the stream connected never cards.
   * A request followed by its control_response (answered from another client) or
   * control_cancel_request (withdrawn) is not open and is left out.
   */
  async openRequests(id: string): Promise<{ requestId: string; tool: string; input: Record<string, unknown>; toolUseId: string }[]> {
    const list = (await this.events(id)).data;
    const open = new Map<string, { requestId: string; tool: string; input: Record<string, unknown>; toolUseId: string }>();
    for (const value of Array.isArray(list) ? list : []) {
      const item = object(value);
      const payload = object(item?.payload);
      if (!payload || typeof payload.request_id !== "string") continue;
      // Stored prompts carry the same source as stream frames; accept a missing one, never a foreign one.
      const source = (item as { source?: unknown } | null)?.source;
      if (source !== undefined && source !== "worker") continue;
      const requestId = payload.request_id;
      if (payload.type === "control_request") {
        const request = object(payload.request);
        const input = object(request?.input);
        if (request?.subtype === "can_use_tool" && typeof request.tool_name === "string" && input && typeof request.tool_use_id === "string") {
          open.set(requestId, { requestId, tool: request.tool_name, input, toolUseId: request.tool_use_id });
        }
      } else if (payload.type === "control_response" || payload.type === "control_cancel_request") {
        open.delete(requestId);
      }
    }
    return [...open.values()];
  }
  /** The newest durable event's number; the stream starts there instead of replaying the whole session. */
  private async latest(id: string, signal: AbortSignal): Promise<number> {
    const body = object(await (await this.request(id, "/events?sort_order=desc&limit=1", { signal })).json());
    const first = Array.isArray(body?.data) ? object(body.data[0]) : null;
    return sequenceOf(first?.sequence_num) ?? 0;
  }
  async stream(id: string, signal: AbortSignal, handle: (frame: BridgeFrame) => void, onConnect?: () => void): Promise<void> {
    let sequence: number | null = null;
    while (!signal.aborted) {
      if (sequence === null) {
        try { sequence = await this.latest(id, signal); }
        catch (error) {
          if (signal.aborted) return;
          if (!(error instanceof BridgeNetworkError)) throw error;
          await delay(1000, undefined, { signal }).catch(error => { if (!signal.aborted) throw error; });
          continue;
        }
      }
      let response: Response;
      try { response = await this.request(id, `/events/stream?from_sequence_num=${sequence}`, { signal }); }
      catch (error) {
        if (signal.aborted) return;
        if (!(error instanceof BridgeNetworkError)) throw error;
        await delay(1000, undefined, { signal }).catch(error => { if (!signal.aborted) throw error; });
        continue;
      }
      if (!response.body) throw new Error("Remote Control stream is empty.");
      // Connected (or reconnected): the caller replays approvals already waiting, which the
      // newest-event cursor above would otherwise skip.
      onConnect?.();
      let handling = false;
      try {
        for await (const frame of decodeSse(response.body)) {
          handling = true;
          // Only live permission prompts come from here; the conversation itself is read from the transcript.
          if (frame.event === "catch_up_truncated") { handling = false; continue; }
          const number = sequenceOf(frame.data.sequence_num);
          if (frame.event === "client_event" && number !== undefined) {
            if (number <= sequence) { handling = false; continue; }
            handle(frame);
            sequence = number;
          } else if (frame.event === "ephemeral_event") handle(frame);
          handling = false;
        }
      } catch (error) {
        if (signal.aborted) return;
        if (handling) throw error;
        // A broken read reconnects; HTTP rejection above is terminal. Writes are never retried.
      }
      await delay(1000, undefined, { signal }).catch(error => { if (!signal.aborted) throw error; });
    }
  }
}

/** The server sends sequence numbers as decimal strings ("9136"); tests and older shapes use numbers. */
function sequenceOf(value: unknown): number | undefined {
  const number = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof number === "number" && Number.isSafeInteger(number) && number >= 0 ? number : undefined;
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
