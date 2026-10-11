// Host settings and the pairing token, under ~/.clauderipple/remote (0600). The token is the
// only secret: whoever holds it can run Claude Code on this machine, so it is never logged,
// never put in a URL the server sees (the pairing link carries it in the #fragment), and
// compared in constant time.
import { randomBytes, timingSafeEqual } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { readJson, writeFileAtomic } from "./fsutil.ts";

export const DEFAULT_PORT = 8797;

export interface HostConfig {
  token: string;
  /** an address, or "tailscale" / "lan" to pick this machine's address on that network at start */
  bind: string;
  port: number;
  adminUrl: string;
  claudePath?: string;
}

export function remoteHome(): string {
  return process.env.RIPPLE_REMOTE_HOME ?? path.join(os.homedir(), ".clauderipple", "remote");
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function loadConfig(dir = remoteHome()): HostConfig {
  const file = path.join(dir, "host.json");
  const stored = readJson<Partial<HostConfig>>(file) ?? {};
  const cfg: HostConfig = {
    token: typeof stored.token === "string" && stored.token.length >= 32 ? stored.token : newToken(),
    bind: typeof stored.bind === "string" ? stored.bind : "127.0.0.1",
    port: typeof stored.port === "number" ? stored.port : DEFAULT_PORT,
    adminUrl: typeof stored.adminUrl === "string" ? stored.adminUrl : "http://127.0.0.1:8792",
    ...(typeof stored.claudePath === "string" ? { claudePath: stored.claudePath } : {}),
  };
  if (cfg.token !== stored.token) saveConfig(cfg, dir);
  return cfg;
}

export function saveConfig(cfg: HostConfig, dir = remoteHome()): void {
  writeFileAtomic(path.join(dir, "host.json"), JSON.stringify(cfg, null, 2) + "\n");
}

export function tokenMatches(expected: string, given: unknown): boolean {
  if (typeof given !== "string") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

type Ifaces = ReturnType<typeof os.networkInterfaces>;

const isTailnet = (ip: string): boolean => {
  const [a, b] = ip.split(".").map(Number);
  return a === 100 && b !== undefined && b >= 64 && b <= 127; // 100.64.0.0/10, Tailscale's CGNAT range
};
const isLan = (ip: string): boolean => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);

function firstV4(ifaces: Ifaces, pick: (ip: string) => boolean): string | null {
  for (const list of Object.values(ifaces)) for (const a of list ?? []) if (a.family === "IPv4" && !a.internal && pick(a.address)) return a.address;
  return null;
}

/** The address to listen on, and the one to put in the pairing link. */
export function resolveBind(bind: string, ifaces: Ifaces = os.networkInterfaces()): { listen: string; advertise: string; reachableFromPhone: boolean } {
  if (bind === "tailscale" || bind === "lan") {
    const ip = firstV4(ifaces, bind === "tailscale" ? isTailnet : isLan);
    if (!ip) throw new Error(`no ${bind === "tailscale" ? "Tailscale (100.64.0.0/10)" : "LAN"} address on this machine`);
    return { listen: ip, advertise: ip, reachableFromPhone: true };
  }
  if (bind === "0.0.0.0" || bind === "::") {
    const ip = firstV4(ifaces, isTailnet) ?? firstV4(ifaces, isLan) ?? "127.0.0.1";
    return { listen: bind, advertise: ip, reachableFromPhone: ip !== "127.0.0.1" };
  }
  const loopback = bind === "127.0.0.1" || bind === "::1" || bind === "localhost";
  return { listen: bind, advertise: bind, reachableFromPhone: !loopback };
}

export function pairingUrl(advertise: string, port: number, token: string): string {
  const host = advertise.includes(":") ? `[${advertise}]` : advertise;
  return `http://${host}:${port}/#pair=${token}`;
}
