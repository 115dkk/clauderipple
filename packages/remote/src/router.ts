// The host reads the router's admin API like any client: models and effort ladders for the
// picker, the proxy settings a spawned CLI needs, and per-session request records for the
// mod's figures. Read-only; the host never writes router state.
import type { Effort, Figures, ProviderGroup } from "./protocol.ts";

const EFFORTS: readonly Effort[] = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
const LABELS: Record<string, string> = {
  chatgpt: "ChatGPT", anthropic: "Claude", openrouter: "OpenRouter", deepseek: "DeepSeek",
  "opencode-go": "OpenCode Go", "opencode-zen": "OpenCode Zen", "google-gemini": "Google Gemini",
};

interface ModOptions {
  models: { model: string; provider: string; name: string; judgeOnly: boolean }[];
  providers: { name: string; type: string; usable: boolean }[];
}
interface EffortLevels { providers: Record<string, { default: string[]; models?: Record<string, string[]> }> }
interface RequestRecord { source?: string; target?: string; provider?: string; effort?: string; ok?: boolean; at?: string; usage?: { input?: number; cached?: number; cacheWrite?: number; output?: number } }
interface Window { used_percent?: number; window_minutes?: number; reset_at?: number }

export interface RouterStatus { ok: boolean; problem?: string; proxyEnv: Record<string, string> }

export type Fetch = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const toEffort = (s: string | undefined): Effort | null => (s && (EFFORTS as readonly string[]).includes(s) ? (s as Effort) : null);
const base = (id: string): string => id.split("@")[0]!.replace(/-\d{8}$/, "");

export class RouterClient {
  private adminUrl: string;
  private fetch: Fetch;

  constructor(adminUrl: string, fetchImpl: Fetch = globalThis.fetch as unknown as Fetch) {
    this.adminUrl = adminUrl.replace(/\/$/, "");
    this.fetch = fetchImpl;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await this.fetch(this.adminUrl + path, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`router ${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  /** Every chat model the router routes, grouped by provider, judge-only models left out (ARCHITECTURE §3b). */
  async models(): Promise<ProviderGroup[]> {
    const [opts, levels] = await Promise.all([this.get<ModOptions>("/api/mod-options"), this.get<EffortLevels>("/api/effort-levels")]);
    return groupModels(opts, levels);
  }

  /** What a spawned CLI needs to go through the router: the same two keys `~/.claude/settings.json` carries (ARCHITECTURE §1). */
  async status(): Promise<RouterStatus> {
    try {
      const s = await this.get<{ settings?: { HTTPS_PROXY?: string; NODE_EXTRA_CA_CERTS?: string }; listen?: { host: string; port: number }; home?: string; readiness?: { ready: boolean; problems?: string[] } }>("/api/status");
      const proxyEnv: Record<string, string> = {};
      const proxy = s.settings?.HTTPS_PROXY ?? (s.listen ? `http://${s.listen.host}:${s.listen.port}` : undefined);
      if (proxy) proxyEnv.HTTPS_PROXY = proxy;
      if (s.settings?.NODE_EXTRA_CA_CERTS) proxyEnv.NODE_EXTRA_CA_CERTS = s.settings.NODE_EXTRA_CA_CERTS;
      // Readiness problems name one provider needing attention (measured: "provider:opencode-go"
      // while that provider still answered); they are not "the router is down", so they do not turn the banner on.
      return { ok: true, proxyEnv };
    } catch (e) {
      return { ok: false, problem: (e as Error).message, proxyEnv: {} };
    }
  }

  /** The mod's figures for one Claude Code session, from the router's own request records. */
  async figures(sessionId: string, mainModel: string, contextWindow: number | null): Promise<Figures> {
    const [reqs, status] = await Promise.all([
      this.get<{ requests: RequestRecord[] }>(`/api/requests?kind=messages&n=400&session=${encodeURIComponent(sessionId)}`).catch(() => ({ requests: [] })),
      this.get<{ claude?: { accounts?: { quota?: { rate_limits?: { primary?: Window; secondary?: Window } } }[] } }>("/api/status").catch(() => ({})),
    ]);
    return computeFigures(reqs.requests, mainModel, contextWindow, status, Date.now());
  }
}

export function groupModels(opts: ModOptions, levels: EffortLevels): ProviderGroup[] {
  const usable = new Map(opts.providers.map((p) => [p.name, p.usable]));
  const groups = new Map<string, ProviderGroup>();
  for (const m of opts.models) {
    if (m.judgeOnly) continue;
    const ladder = levels.providers[m.provider];
    const efforts = (ladder?.models?.[m.model] ?? ladder?.default ?? []).map(toEffort).filter((e): e is Effort => e !== null && e !== "none" && e !== "minimal");
    const ok = usable.get(m.provider) ?? false;
    let g = groups.get(m.provider);
    if (!g) { g = { provider: m.provider, label: LABELS[m.provider] ?? m.provider, usable: ok, models: [] }; groups.set(m.provider, g); }
    g.models.push({ model: m.model, name: m.name, provider: m.provider, efforts, usable: ok });
  }
  return Array.from(groups.values());
}

/**
 * Cache % is read over all input of the session's main-model requests; context % is the latest
 * main request's input over the window the CLI reported for the model. Unknown stays null.
 */
export function computeFigures(records: RequestRecord[], mainModel: string, contextWindow: number | null, status: { claude?: { accounts?: { quota?: { rate_limits?: { primary?: Window; secondary?: Window } } }[] } }, now: number): Figures {
  const main = base(mainModel);
  let read = 0, all = 0;
  let effort: Effort | null = null;
  let latest = -Infinity;
  let lastInput: number | null = null;
  const workers = new Map<string, { model: string; provider: string; requests: number }>();
  for (const r of records) {
    const target = r.target ?? r.source ?? "";
    if (base(target) === main || base(r.source ?? "") === main) {
      const u = r.usage ?? {};
      read += u.cached ?? 0;
      all += (u.input ?? 0) + (u.cached ?? 0) + (u.cacheWrite ?? 0);
      const at = r.at ? Date.parse(r.at) : 0;
      const input = (u.input ?? 0) + (u.cached ?? 0) + (u.cacheWrite ?? 0);
      // A request still streaming has no usage yet; it would read as an empty context (measured: 0% mid-turn).
      if (at > latest && input > 0) { latest = at; effort = toEffort(r.effort) ?? effort; lastInput = input; }
    } else if (target) {
      const key = base(target);
      const w = workers.get(key) ?? { model: key, provider: r.provider ?? "", requests: 0 };
      w.requests++;
      workers.set(key, w);
    }
  }
  const windows = status.claude?.accounts?.[0]?.quota?.rate_limits;
  const five = [windows?.primary, windows?.secondary].find((w) => w?.window_minutes === 300);
  return {
    effort,
    cachePct: all > 0 ? Math.round((read / all) * 1000) / 10 : null,
    contextPct: contextWindow && lastInput !== null ? Math.min(100, Math.round((lastInput / contextWindow) * 1000) / 10) : null,
    fiveHourPct: typeof five?.used_percent === "number" ? five.used_percent : null,
    fiveHourResetAt: typeof five?.reset_at === "number" ? five.reset_at * 1000 : null,
    workers: Array.from(workers.values()).sort((a, b) => b.requests - a.requests),
    at: now,
  };
}
