// Fail over to the iPhone Personal Hotspot when Wi-Fi has no internet, and come back to a known
// Wi-Fi later (macOS only).
//
// What decides "no internet" is a real HTTP probe through the Wi-Fi interface, not the OS path
// status: a router with a dead uplink or a captive portal reads "satisfied" to NWPathMonitor, which
// is why Insomnia never failed over in that state (research §1.3, §3.3). Behaviour follows wifihop
// (captive.apple.com "Success" + gstatic 204, 3 of the last 5 rounds) and WiFiGuard (switch back when
// a better network returns); the code is our own.
//
//   failover  on Wi-Fi (or none), 3 of the last 5 probe rounds failed → `sudo -n networksetup
//             -setairportnetwork <dev> <hotspot>`; macOS takes the password from the System keychain.
//   return    on the hotspot, every returnEverySec while no model call runs → disassociate (CoreWLAN
//             through JXA, as the console user — the router is a launchd agent in the user's session)
//             so macOS auto-joins the best known network in range; probe it; if that does not give
//             working Wi-Fi within 20s, rejoin the hotspot and double the interval (up to 15 min).
//
// Never more than one switch per 60s; nothing switches while the user has pinned the network.
// "On the hotspot" is read from the address, not the SSID (which macOS redacts without Location):
// an iPhone hotspot hands out 172.20.10.0/28.

import http from "node:http";
import os from "node:os";
import type { TetherSettings } from "./config.ts";
import { SUDO, sudoRefused, type Activity, type Runner } from "./awake.ts";

export const NETWORKSETUP = "/usr/sbin/networksetup";
export const OSASCRIPT = "/usr/bin/osascript";
/** wifihop's exact call (verified in its source, `mac_disassociate_js`): a zero-argument ObjC method is invoked by reading it. */
export const DISASSOCIATE_JS = 'ObjC.import("CoreWLAN"); $.CWWiFiClient.sharedWiFiClient.interface.disassociate; "ok";';

export const PROBE_URLS = {
  apple: "http://captive.apple.com/hotspot-detect.html",
  google: "http://connectivitycheck.gstatic.com/generate_204",
} as const;
export const PROBE_TIMEOUT_MS = 4_000;
export const MIN_SWITCH_INTERVAL_MS = 60_000;
export const RETURN_PROBE_MS = 20_000;
export const MAX_RETURN_INTERVAL_MS = 15 * 60_000;
/** A model call this recent counts as "Claude is working": no return attempt (it drops the link for seconds). */
export const RETURN_QUIET_MS = 20_000;
/** Failover waits at most this long for an in-flight call; a dead network cannot serve it anyway. */
export const FAILOVER_IDLE_WAIT_MS = 30_000;
const JOIN_SETTLE_MS = 15_000;

// ---- Pure helpers -------------------------------------------------------------------------------

/** The Wi-Fi device from `networksetup -listallhardwareports` ("Hardware Port: Wi-Fi\nDevice: en0"). */
export function parseWifiDevice(text: string): string | null {
  const blocks = text.split(/\n\s*\n/);
  for (const b of blocks) {
    if (!/Hardware Port:\s*(Wi-Fi|AirPort)\s*$/m.test(b)) continue;
    const dev = /Device:\s*(\S+)/.exec(b)?.[1];
    if (dev && /^en\d+$/.test(dev)) return dev;
  }
  return null;
}

/** The interface's IPv4 address, or null when it has none (not associated, or no DHCP yet). */
export function wifiIPv4(ifaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>, device: string): string | null {
  return ifaces[device]?.find((a) => a.family === "IPv4" && !a.internal)?.address ?? null;
}

/** An iPhone Personal Hotspot hands out 172.20.10.0/28 (172.20.10.0–15). */
export function isHotspotAddress(ip: string | null): boolean {
  const m = ip ? /^172\.20\.10\.(\d{1,3})$/.exec(ip) : null;
  return !!m && Number(m[1]) <= 15;
}

export type Network = "wifi" | "hotspot" | "none";
export function classifyNetwork(ip: string | null): Network {
  return ip === null ? "none" : isHotspotAddress(ip) ? "hotspot" : "wifi";
}

/** The last five probe rounds; an outage is 3 failures among them, so a 1s blip never switches. */
export class ProbeWindow {
  private rounds: boolean[] = [];
  push(ok: boolean): void {
    this.rounds.push(ok);
    if (this.rounds.length > 5) this.rounds.shift();
  }
  failures(): number {
    return this.rounds.filter((ok) => !ok).length;
  }
  outage(): boolean {
    return this.failures() >= 3;
  }
  reset(): void {
    this.rounds = [];
  }
}

export type ProbeGet = (url: string, localAddress: string, timeoutMs: number) => Promise<{ status: number; body: string }>;

/** One HTTP GET bound to a local address (so the request leaves through that interface). */
export const httpGet: ProbeGet = (url, localAddress, timeoutMs) =>
  new Promise((resolve, reject) => {
    const req = http.get(url, { localAddress, timeout: timeoutMs, headers: { "cache-control": "no-cache" } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => {
        if (body.length < 4096) body += c;
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("probe timed out")));
    req.on("error", reject);
  });

/** One round: both endpoints at once; the round fails only if both fail. */
export async function probeRound(localAddress: string, get: ProbeGet = httpGet): Promise<boolean> {
  const apple = get(PROBE_URLS.apple, localAddress, PROBE_TIMEOUT_MS).then((r) => r.status === 200 && r.body.includes("Success"), () => false);
  const google = get(PROBE_URLS.google, localAddress, PROBE_TIMEOUT_MS).then((r) => r.status === 204, () => false);
  const [a, g] = await Promise.all([apple, google]);
  return a || g;
}

export type JoinOutcome = "joined" | "needs-setup" | "hotspot-not-visible" | "join-failed";

/**
 * `networksetup -setairportnetwork` reports failure on stdout and may still exit 0
 * ("Could not find network X." / "Failed to join network X."), so the text decides.
 */
export function classifyJoin(r: { code: number; stdout: string; stderr: string }): Exclude<JoinOutcome, "joined"> | null {
  if (sudoRefused(r)) return "needs-setup";
  const text = `${r.stdout}\n${r.stderr}`;
  if (/could not find network/i.test(text)) return "hotspot-not-visible";
  if (r.code !== 0 || /failed|error/i.test(text)) return "join-failed";
  return null;
}

// ---- Controller ---------------------------------------------------------------------------------

export type TetherState =
  | "off" | "unsupported" | "no-wifi-device" | "watching" | "no-wifi" | "outage" | "pinned"
  | "joining-hotspot" | "on-hotspot" | "returning" | "hotspot-not-visible" | "join-failed"
  | "needs-setup" | "no-hotspot-ssid";

export type TetherStatus = {
  enabled: boolean;
  network: Network;
  state: TetherState;
  pinned: boolean;
  hotspotSsid: string;
  lastSwitch: { at: string; to: "hotspot" | "wifi"; ok: boolean; reason: string } | null;
  lastProbe: { at: string; ok: boolean; network: Network } | null;
  hint: string | null;
};

export type TetherDeps = {
  platform: NodeJS.Platform;
  run: Runner;
  settings: () => TetherSettings;
  activity: () => Activity;
  log: { info(m: string): void; warn(m: string): void };
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  interfaces?: () => NodeJS.Dict<os.NetworkInterfaceInfo[]>;
  /** One probe round through this local address. */
  probe?: (localAddress: string) => Promise<boolean>;
  /** Schedules the next tick after `ms`; returns a cancel. Tests pass a no-op. */
  schedule?: (fn: () => void, ms: number) => () => void;
};

const HINTS: Partial<Record<TetherState, string>> = {
  "hotspot-not-visible": "The iPhone is not broadcasting its hotspot. Open Settings → Personal Hotspot on the iPhone once (and keep \"Allow Others to Join\" on) so the Mac can see it.",
  "needs-setup": "Run `clauderipple awake setup --ssid <hotspot name>` once: joining the hotspot needs the rule it installs (and the name must match it).",
  "no-hotspot-ssid": "Set the iPhone hotspot's name: `clauderipple awake setup --ssid <hotspot name>`.",
  "no-wifi": "Wi-Fi is not connected. macOS joins the iPhone hotspot by itself when no Wi-Fi is available if System Settings → Wi-Fi → \"Ask to join hotspots\" is Automatic (ClaudeRipple cannot read that setting: the file is root-only).",
  "join-failed": "Joining the hotspot failed. Check the hotspot name, and that the Mac has joined it once before (macOS keeps its password).",
  pinned: "Switching is paused because the network was pinned.",
};

export class TetherController {
  private readonly deps: TetherDeps;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly interfaces: () => NodeJS.Dict<os.NetworkInterfaceInfo[]>;
  private readonly probe: (localAddress: string) => Promise<boolean>;
  private readonly window = new ProbeWindow();
  private device: string | null = null;
  private network: Network = "none";
  private state: TetherState = "off";
  private pinned = false;
  private lastSwitchAt = 0;
  private lastSwitch: TetherStatus["lastSwitch"] = null;
  private lastProbe: TetherStatus["lastProbe"] = null;
  private returnIntervalMs: number | null = null;
  private nextReturnAt = 0;
  private busy: Promise<void> | null = null;
  private cancel: (() => void) | null = null;
  private lastLogged = "";

  constructor(deps: TetherDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.interfaces = deps.interfaces ?? os.networkInterfaces;
    this.probe = deps.probe ?? ((addr) => probeRound(addr));
    if (deps.platform !== "darwin") this.state = "unsupported";
  }

  get supported(): boolean {
    return this.deps.platform === "darwin";
  }

  start(): void {
    if (!this.supported) return;
    this.loop();
  }

  stop(): void {
    this.cancel?.();
    this.cancel = null;
  }

  /** Run a tick soon (after the settings changed) without waiting for it. */
  kick(): void {
    if (this.supported) void this.tick();
  }

  setPin(on: boolean): void {
    if (this.pinned === on) return;
    this.pinned = on;
    this.deps.log.info(`tether: network ${on ? "pinned; switching paused" : "unpinned; switching resumes"}`);
    if (on) this.state = "pinned";
    this.window.reset();
  }

  status(): TetherStatus {
    const s = this.deps.settings();
    return {
      enabled: s.enabled,
      network: this.network,
      state: this.state,
      pinned: this.pinned,
      hotspotSsid: s.hotspotSsid,
      lastSwitch: this.lastSwitch,
      lastProbe: this.lastProbe,
      hint: HINTS[this.state] ?? null,
    };
  }

  private loop(): void {
    const schedule = this.deps.schedule ?? ((fn, ms) => {
      const t = setTimeout(fn, ms);
      t.unref();
      return () => clearTimeout(t);
    });
    const every = Math.max(5, this.deps.settings().probeEverySec) * 1000;
    this.cancel = schedule(() => {
      void this.tick().finally(() => {
        if (this.cancel) this.loop();
      });
    }, every);
  }

  tick(): Promise<void> {
    if (!this.supported) return Promise.resolve();
    if (!this.busy) this.busy = this.evaluate().catch((e: Error) => this.deps.log.warn(`tether: ${e.message}`)).finally(() => (this.busy = null));
    return this.busy;
  }

  private decide(line: string): void {
    if (line === this.lastLogged) return;
    this.lastLogged = line;
    this.deps.log.info(`tether: ${line}`);
  }

  private currentIp(): string | null {
    return this.device ? wifiIPv4(this.interfaces(), this.device) : null;
  }

  private idle(): boolean {
    const a = this.deps.activity();
    return a.inFlight === 0 && (a.lastStartedAt === undefined || this.now() - a.lastStartedAt >= RETURN_QUIET_MS);
  }

  private async evaluate(): Promise<void> {
    const settings = this.deps.settings();
    if (!settings.enabled) {
      if (this.state !== "off") this.decide("disabled");
      this.state = "off";
      this.window.reset();
      return;
    }
    if (!this.device) {
      const r = await this.deps.run(NETWORKSETUP, ["-listallhardwareports"]);
      this.device = r.code === 0 ? parseWifiDevice(r.stdout) : null;
      if (!this.device) {
        this.state = "no-wifi-device";
        this.decide("no Wi-Fi interface found");
        return;
      }
    }
    const ip = this.currentIp();
    this.network = classifyNetwork(ip);
    const ok = ip ? await this.probe(ip) : false;
    this.window.push(ok);
    this.lastProbe = { at: new Date(this.now()).toISOString(), ok, network: this.network };
    if (this.pinned) {
      this.state = "pinned";
      return;
    }
    if (this.network === "hotspot") {
      // Landed here by our own failover or by hand: either way, plan the way back.
      if (this.returnIntervalMs === null) {
        this.returnIntervalMs = settings.returnEverySec * 1000;
        this.nextReturnAt = this.now() + this.returnIntervalMs;
      }
      if (this.state !== "on-hotspot") this.decide(`on the hotspot; next try for Wi-Fi in ${Math.round((this.nextReturnAt - this.now()) / 1000)}s`);
      this.state = "on-hotspot";
      if (this.now() >= this.nextReturnAt) await this.tryReturn(settings);
      return;
    }
    // On Wi-Fi (or none): the way back is no longer pending.
    this.returnIntervalMs = null;
    if (!this.window.outage()) {
      this.state = this.network === "wifi" ? "watching" : "no-wifi";
      if (this.network === "wifi") this.decide(`watching Wi-Fi (${5 - this.window.failures()}/5 recent probes ok)`);
      else this.decide("Wi-Fi has no address");
      return;
    }
    await this.failover(settings);
  }

  private async failover(settings: TetherSettings): Promise<void> {
    const why = this.network === "wifi" ? "Wi-Fi has no internet (3 of the last 5 probes failed)" : "Wi-Fi is not connected";
    if (!settings.hotspotSsid) {
      this.state = "no-hotspot-ssid";
      this.decide(`${why}, but no hotspot name is set`);
      return;
    }
    const since = this.now() - this.lastSwitchAt;
    if (since < MIN_SWITCH_INTERVAL_MS) {
      // A failed join keeps saying why (and its hint) until the next attempt.
      if (this.state !== "hotspot-not-visible" && this.state !== "join-failed" && this.state !== "needs-setup") this.state = "outage";
      this.decide(`${why}; waiting ${Math.ceil((MIN_SWITCH_INTERVAL_MS - since) / 1000)}s (at most one switch per minute)`);
      return;
    }
    // A call in flight on a dead network cannot finish anyway; give it a short chance, no more.
    const waitUntil = this.now() + FAILOVER_IDLE_WAIT_MS;
    while (this.deps.activity().inFlight > 0 && this.now() < waitUntil) await this.sleep(1_000);
    this.state = "joining-hotspot";
    this.lastSwitchAt = this.now();
    this.decide(`${why}: joining hotspot "${settings.hotspotSsid}"`);
    const outcome = await this.join(settings.hotspotSsid);
    this.recordSwitch("hotspot", outcome === "joined", outcome === "joined" ? why : outcome);
    if (outcome === "joined") {
      this.window.reset();
      this.network = "hotspot";
      this.state = "on-hotspot";
      this.returnIntervalMs = settings.returnEverySec * 1000;
      this.nextReturnAt = this.now() + this.returnIntervalMs;
      this.decide(`joined the hotspot; next try for Wi-Fi in ${settings.returnEverySec}s`);
    } else {
      this.state = outcome;
      this.decide(`could not join the hotspot: ${outcome}`);
    }
  }

  /** `sudo -n networksetup -setairportnetwork <dev> <ssid>`, then wait for a hotspot address. */
  private async join(ssid: string): Promise<JoinOutcome> {
    const r = await this.deps.run(SUDO, ["-n", NETWORKSETUP, "-setairportnetwork", this.device!, ssid], { timeoutMs: 30_000 });
    const failed = classifyJoin(r);
    if (failed) {
      if (failed !== "needs-setup") this.deps.log.warn(`tether: networksetup said: ${(r.stdout + r.stderr).trim().slice(0, 200)}`);
      return failed;
    }
    const deadline = this.now() + JOIN_SETTLE_MS;
    while (this.now() < deadline) {
      if (isHotspotAddress(this.currentIp())) return "joined";
      await this.sleep(1_000);
    }
    return isHotspotAddress(this.currentIp()) ? "joined" : "join-failed";
  }

  private async tryReturn(settings: TetherSettings): Promise<void> {
    if (this.now() - this.lastSwitchAt < MIN_SWITCH_INTERVAL_MS) return;
    if (!this.idle()) {
      this.decide("Wi-Fi return postponed: a model call is running or just started");
      return;
    }
    this.state = "returning";
    this.lastSwitchAt = this.now();
    this.decide("trying to go back to Wi-Fi: leaving the hotspot so macOS joins the best known network");
    const r = await this.deps.run(OSASCRIPT, ["-l", "JavaScript", "-e", DISASSOCIATE_JS], { timeoutMs: 15_000 });
    if (r.code !== 0) {
      this.deps.log.warn(`tether: disassociate failed: ${(r.stderr || r.stdout).trim().slice(0, 200)}`);
      this.state = "on-hotspot";
      this.backOff(settings, "disassociate failed");
      return;
    }
    // Back on Wi-Fi only after two good probes through it (one could be a lucky blip).
    let good = 0;
    const deadline = this.now() + RETURN_PROBE_MS;
    while (this.now() < deadline) {
      await this.sleep(2_000);
      const ip = this.currentIp();
      if (ip && !isHotspotAddress(ip) && (await this.probe(ip))) {
        if (++good >= 2) break;
      } else good = 0;
    }
    this.window.reset();
    if (good >= 2) {
      this.network = "wifi";
      this.state = "watching";
      this.returnIntervalMs = null;
      this.recordSwitch("wifi", true, "a known Wi-Fi with internet was in range");
      this.decide("back on Wi-Fi with internet");
      return;
    }
    const ip = this.currentIp();
    let reason: string;
    if (isHotspotAddress(ip)) reason = "macOS rejoined the hotspot (no better network in range)";
    else {
      reason = ip ? "the Wi-Fi macOS chose has no internet" : "no network was joined";
      const outcome = await this.join(settings.hotspotSsid);
      if (outcome !== "joined") reason += `; rejoining the hotspot failed: ${outcome}`;
    }
    this.network = classifyNetwork(this.currentIp());
    this.state = this.network === "hotspot" ? "on-hotspot" : "join-failed";
    this.recordSwitch("wifi", false, reason);
    this.backOff(settings, reason);
  }

  private backOff(settings: TetherSettings, reason: string): void {
    this.returnIntervalMs = Math.min(MAX_RETURN_INTERVAL_MS, Math.max(settings.returnEverySec * 1000, (this.returnIntervalMs ?? settings.returnEverySec * 1000) * 2));
    this.nextReturnAt = this.now() + this.returnIntervalMs;
    this.lastLogged = "";
    this.decide(`staying on the hotspot (${reason}); next try in ${Math.round(this.returnIntervalMs / 1000)}s`);
  }

  private recordSwitch(to: "hotspot" | "wifi", ok: boolean, reason: string): void {
    this.lastSwitch = { at: new Date(this.now()).toISOString(), to, ok, reason };
  }
}
