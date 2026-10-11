#!/usr/bin/env node
// ripple-host: runs Claude Code sessions on this machine for the phone.
//   ripple-host [--bind 127.0.0.1|tailscale|lan|0.0.0.0|<ip>] [--port 8797] [--new-token]
// --bind and --port are remembered. It never stops on its own: a launchd KeepAlive job (not
// installed by this command) is how it should run day to day.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listSessions, query } from "@anthropic-ai/claude-agent-sdk";
import qrcode from "qrcode-generator";
import { loadConfig, newToken, pairingUrl, remoteHome, resolveBind, saveConfig } from "./config.ts";
import { PermissionQueue } from "./permissions.ts";
import { RouterClient } from "./router.ts";
import { HostServer } from "./server.ts";
import { Sessions } from "./sessions.ts";
import type { QueryFn } from "./sessions.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const VERSION = (JSON.parse(fs.readFileSync(path.join(here, "..", "package.json"), "utf8")) as { version: string }).version;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

/** The user's own CLI when there is one: it is the version the router's measurements and the ripple mod are kept current with. */
function findClaude(configured: string | undefined): string | undefined {
  if (configured) return configured;
  for (const p of [path.join(os.homedir(), ".local", "bin", "claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude"]) if (fs.existsSync(p)) return p;
  try { return execFileSync("/usr/bin/which", ["claude"], { encoding: "utf8" }).trim() || undefined; } catch { return undefined; }
}

function qr(text: string): string {
  const q = qrcode(0, "M");
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  const dark = (r: number, c: number): boolean => r >= 0 && c >= 0 && r < n && c < n && q.isDark(r, c);
  const lines: string[] = [];
  // Two rows per character with half blocks and a quiet zone of 2. Black on an explicit white
  // background, so it scans the same on a light or a dark terminal.
  for (let r = -2; r < n + 2; r += 2) {
    let line = "\x1b[30;47m";
    for (let c = -2; c < n + 2; c++) {
      const top = dark(r, c), bottom = dark(r + 1, c);
      line += top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " ";
    }
    lines.push(line + "\x1b[0m");
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const dir = remoteHome();
  const cfg = loadConfig(dir);
  const bind = arg("bind");
  const port = arg("port");
  if (bind) cfg.bind = bind;
  if (port) cfg.port = Number(port);
  if (process.argv.includes("--new-token")) cfg.token = newToken();
  if (bind || port || process.argv.includes("--new-token")) saveConfig(cfg, dir);

  const where = resolveBind(cfg.bind);
  const router = new RouterClient(cfg.adminUrl);
  const permissions = PermissionQueue.open(path.join(dir, "permissions.json"));
  let server: HostServer | null = null;
  const claudePath = findClaude(cfg.claudePath);
  const sessions = new Sessions({
    dir, router, permissions,
    queryFn: query as unknown as QueryFn,
    ...(claudePath ? { claudePath } : {}),
    onEvent: (id) => server?.onEvent(id),
    onSessions: () => server?.onSessions(),
  });
  sessions.recover();
  server = new HostServer({
    listen: where.listen, port: cfg.port, token: cfg.token, webDir: path.resolve(here, "..", "web"), sessions, router,
    hostName: os.hostname().replace(/\.local$/, ""), version: VERSION,
    recentCli: async () => (await listSessions({ limit: 300, includeProgrammatic: false })).flatMap((s) => (s.cwd ? [{ path: s.cwd, lastUsed: s.lastModified }] : [])),
    log: (line) => process.stderr.write(`${line}\n`),
  });
  await server.listen();

  const url = pairingUrl(where.advertise, cfg.port, cfg.token);
  process.stdout.write(`\nRipple Remote ${VERSION} — listening on ${where.listen}:${cfg.port}\n`);
  if (claudePath) process.stdout.write(`Claude Code: ${claudePath}\n`);
  if (!where.reachableFromPhone) {
    process.stdout.write(`\nOnly this Mac can reach it. For the phone, run again with --bind tailscale (or --bind lan).\n`);
  }
  process.stdout.write(`\nScan with the phone's camera (the link carries the pairing key — do not share it):\n\n${qr(url)}\n\n`);

  const stop = (): void => {
    sessions.shutdown();
    void server!.close().then(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

main().catch((e: Error) => {
  process.stderr.write(`ripple-host: ${e.message}\n`);
  process.exit(1);
});
