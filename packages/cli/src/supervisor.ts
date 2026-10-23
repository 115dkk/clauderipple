// One supervisor interface, three implementations: launchd on macOS, Task Scheduler on Windows,
// a systemd user service on Linux.
// Everything outside this module talks to the router's lifecycle through here.

import { execFileSync, spawn } from "node:child_process";
import { ConfigStore, configPath } from "../../router/src/config.ts";
import { adminPort } from "../../router/src/admin.ts";
import * as launchd from "./launchd.ts";
import * as schtasks from "./schtasks.ts";
import * as systemd from "./systemd.ts";
import { runtime } from "./runtime.ts";
import { windowsPowerShellEnv } from "./windows-powershell.ts";

export type AgentState = "running" | "loaded" | "not-loaded";
/** `direct` is a router that is up but was started outside its supervisor (see startRouter). */
export type StartResult = "already-running" | "started" | "started-directly" | "failed";
export type RestartResult = "drained" | "kickstarted" | "direct" | "failed";

export const isWindows = process.platform === "win32";
export const isLinux = process.platform === "linux";
export const isSupported = isWindows || isLinux || process.platform === "darwin";

/** What the supervisor is called on this platform, for messages the user reads. */
export function supervisorName(): string {
  return isWindows ? "scheduled task" : isLinux ? "systemd user service" : "launchd agent";
}

export function installAgent(opts: { program: string; args?: string[]; bundleId?: string; home: string; env?: Record<string, string> }): string {
  return isWindows ? schtasks.installAgent(opts) : isLinux ? systemd.installAgent(opts) : launchd.installAgent(opts);
}

export function removeAgent(): boolean {
  return isWindows ? schtasks.removeAgent() : isLinux ? systemd.removeAgent() : launchd.removeAgent();
}

export function agentState(): AgentState {
  return isWindows ? schtasks.agentState() : isLinux ? systemd.agentState() : launchd.agentState();
}

export function agentPid(): number | null {
  return isWindows ? schtasks.agentPid() : isLinux ? systemd.agentPid() : launchd.agentPid();
}

/**
 * How a start is asked for and how its result is judged. Injected so tests can model a supervisor
 * that accepts the request but never produces a process, without touching a real one.
 */
export type StartOps = {
  start(): "already-running" | "started" | "failed";
  /** True while the router's process exists — the same pid `stop` and `restart` look for. */
  up(): boolean;
  /** Starts the router without the supervisor; the new process's pid, or null. */
  fallback(): number | null;
  /** True while `pid` is alive. */
  alive(pid: number): boolean;
  now(): number;
  sleep(ms: number): void;
};

/**
 * A start is done when the router is, not when the supervisor says so. Every supervisor answers
 * once the *request* is accepted — Task Scheduler on Start-ScheduledTask, launchd on kickstart,
 * systemd once the unit is activated — so a launcher that never runs the router, or a program that
 * exits at once, still reads as "started". On 2026-10-22 an update drained the router, the
 * scheduled task accepted the start, nothing came up, and the update ended "updated": Claude had
 * no router for 11h47m until the next sign-in (#80). So the process is waited for, and when it
 * never appears the router is started without the supervisor — unsupervised beats absent — and if
 * that fails too the answer is failure, never success.
 */
export function startRouter(ops: StartOps, opts: { budgetMs?: number; pollMs?: number; onProgress?: (msg: string) => void } = {}): StartResult {
  if (ops.up()) return "already-running";
  let asked: "already-running" | "started" | "failed" = "failed";
  try {
    asked = ops.start();
  } catch {
    // A supervisor whose call throws has not started anything; the direct path below is the answer.
    asked = "failed";
  }
  if (asked !== "failed" && waitUntil(ops, () => ops.up(), opts)) return asked;
  opts.onProgress?.(`the ${supervisorName()} did not bring the router up; starting it directly`);
  const pid = ops.fallback();
  if (pid === null) return "failed";
  return waitUntil(ops, () => ops.alive(pid), opts) ? "started-directly" : "failed";
}

function waitUntil(ops: Pick<StartOps, "now" | "sleep">, ok: () => boolean, opts: { budgetMs?: number; pollMs?: number }): boolean {
  const deadline = ops.now() + (opts.budgetMs ?? 20_000);
  while (ops.now() < deadline) {
    if (ok()) return true;
    ops.sleep(opts.pollMs ?? 500);
  }
  return ok();
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * The router started outside its supervisor: the last resort that still leaves Claude working when
 * the supervisor will not. It runs unsupervised until the next logon or `clauderipple repair`.
 */
function startRouterDirectly(): number | null {
  try {
    const rt = runtime();
    const child = spawn(rt.node, [rt.router], { detached: true, stdio: "ignore", windowsHide: true, env: { ...process.env, ...rt.env } });
    // A spawn failure (ENOENT) arrives as an event; it must surface as "no pid", not as a crash.
    child.on("error", () => {});
    child.unref();
    return child.pid ?? null;
  } catch {
    return null;
  }
}

function realStartOps(): StartOps {
  return {
    start: () => (isWindows ? schtasks.startAgent() : isLinux ? systemd.startAgent() : launchd.startAgent()),
    up: () => agentPid() !== null,
    fallback: startRouterDirectly,
    alive: isAlive,
    now: () => Date.now(),
    sleep: sleepSync,
  };
}

export function startAgent(opts: { onProgress?: (msg: string) => void } = {}): StartResult {
  return startRouter(realStartOps(), opts);
}

export function stopAgent(): boolean {
  if (isLinux) return systemd.stopAgent();
  if (!isWindows) return launchd.stopAgent();
  // Ask the router to drain first: a clean exit also ends the launcher's supervision loop, so the
  // task does not relaunch it. Then stop the task itself to clear anything left behind.
  askShutdown();
  waitForExit(schtasks.agentPid(), 120_000);
  return schtasks.stopAgent();
}

/** Blocking POST to the router's shutdown endpoint. Returns false if it did not answer. */
function askShutdown(): boolean {
  try {
    execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", `Invoke-RestMethod -Method Post -Uri '${adminUrl()}/api/shutdown' -TimeoutSec 10 | Out-Null`],
      { env: windowsPowerShellEnv(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
    return true;
  } catch {
    return false;
  }
}

/** Waits for `pid` to disappear. Returns true if it exited within the budget. */
function waitForExit(pid: number | null, budgetMs: number, onProgress?: (msg: string) => void): boolean {
  if (pid === null) return true;
  const t0 = Date.now();
  let lastTick = 0;
  while (Date.now() - t0 < budgetMs) {
    const now = schtasks.agentPid();
    if (now === null || now !== pid) return true;
    const s = Math.floor((Date.now() - t0) / 1000);
    if (s >= 5 && s !== lastTick && s % 5 === 0) {
      lastTick = s;
      onProgress?.(`draining… ${s}s (waiting for in-flight model calls)`);
    }
    sleepSync(1000);
  }
  return false;
}

/** Where the router's admin API is listening, per the current config. */
function adminUrl(): string {
  const cfg = new ConfigStore(configPath()).get();
  return `http://127.0.0.1:${adminPort(cfg)}`;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Windows restart. There is no SIGTERM here — `process.kill(pid, "SIGTERM")` terminates the target
 * outright, which is exactly the drain-cutting behaviour launchd's `kickstart -k` was fixed for on
 * macOS — so ask the router to drain over its admin API, wait for the process to go, then start the
 * task again. The launcher's supervision loop treats a clean exit as "stay stopped", so the restart
 * has to be explicit.
 */
function restartWindows(opts: { waitMs?: number; onProgress?: (msg: string) => void }): RestartResult {
  const pid = schtasks.agentPid();
  if (pid === null) {
    const started = startAgent(opts);
    if (started === "failed") return "failed";
    return started === "started-directly" ? "direct" : "kickstarted";
  }

  if (!askShutdown()) opts.onProgress?.("router did not answer /api/shutdown; waiting for it to exit anyway");
  const exited = waitForExit(pid, opts.waitMs ?? 120_000, opts.onProgress);
  // Still draining: a second router would only fight it for the port, so this is a failure.
  if (!exited) return "failed";
  // A clean drain ends the launcher loop too, so the task has to be started again — and a task
  // start is not a router until its process is seen (startRouter).
  const started = startAgent(opts);
  if (started === "failed") return "failed";
  return started === "started-directly" ? "direct" : "drained";
}

export function restartAgent(opts: { waitMs?: number; onProgress?: (msg: string) => void } = {}): RestartResult {
  if (isWindows) return restartWindows(opts);
  const r = isLinux ? systemd.restartAgent(opts) : launchd.restartAgent(opts);
  if (r !== "failed") return r;
  // The supervisor said the restart failed. If a process still holds the port, the drain did not
  // finish and a second router must not be put on it; otherwise try starting the router directly.
  if (agentPid() !== null) return "failed";
  opts.onProgress?.(`the ${supervisorName()} did not bring the router back; starting it directly`);
  const pid = startRouterDirectly();
  return pid !== null && waitUntil({ now: () => Date.now(), sleep: sleepSync }, () => isAlive(pid), {}) ? "direct" : "failed";
}

/** Path to the supervisor's own definition, for status output. */
export function agentDefinitionPath(): string {
  return isWindows ? `Task Scheduler\\${schtasks.taskName()}` : isLinux ? systemd.unitPath() : launchd.plistPath();
}
