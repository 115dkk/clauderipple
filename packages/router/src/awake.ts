// Keep a MacBook awake with its lid closed while Claude works (macOS only).
//
// The only mechanism that holds a closed MacBook awake on battery or without an external display is
// `pmset -a disablesleep 1`, run as root. It is undocumented (absent from `man pmset`) but it is what
// every working open-source tool uses (Insomnia, MacMiniMode, Sleepless, Capsomnia, WiFiGuard), and
// `pmset -g` reports it as `SleepDisabled`. Root comes from a narrow sudoers rule installed once by
// `clauderipple awake setup`; here it is only ever `sudo -n`, which fails instead of prompting.
//
// Rules this module keeps (docs/ARCHITECTURE.md "Lid-closed awake and hotspot failover"):
//   - The bit is set only while it is wanted, and a journal (`<home>/awake.json`) records that we
//     set it, so a router that died with it set clears it on its next start.
//   - Battery below the floor, a thermal warning, or any error reading either forces it off.
//   - Turning it off with the lid closed (and nothing else holding the Mac awake) sends the Mac to
//     sleep, because clearing the bit alone leaves a bagged Mac running (MacMiniMode does the same).
//   - The router's exit does not touch the bit: a restart's successor reconciles within one tick,
//     and clearing it here then setting it again a second later is exactly the off-then-on window in
//     which a closed lid could sleep mid-work. `clauderipple stop`/`uninstall` clear it.
//
// Every command goes through an injected `Runner`, never a shell, so tests run against fakes.

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { AwakeSettings } from "./config.ts";

export type RunResult = { code: number; stdout: string; stderr: string };
/** Runs one program with arguments (no shell). Never throws: a spawn failure is code -1. */
export type Runner = (file: string, args: string[], opts?: { timeoutMs?: number }) => Promise<RunResult>;

export const PMSET = "/usr/bin/pmset";
export const SUDO = "/usr/bin/sudo";
export const IOREG = "/usr/sbin/ioreg";
export const SUDOERS_FILE = "/etc/sudoers.d/clauderipple";

export function execRunner(): Runner {
  return (file, args, opts = {}) =>
    new Promise((resolve) => {
      execFile(
        file,
        args,
        { timeout: opts.timeoutMs ?? 10_000, encoding: "utf8", maxBuffer: 4 * 1024 * 1024, env: { ...process.env, LC_ALL: "C" } },
        (error, stdout, stderr) => {
          if (!error) return resolve({ code: 0, stdout, stderr });
          // A non-zero exit carries its status as a number; a spawn failure or timeout does not.
          const code = (error as { code?: unknown }).code;
          resolve({ code: typeof code === "number" ? code : -1, stdout: stdout ?? "", stderr: stderr || error.message });
        },
      );
    });
}

/** What the router is doing, from the proxy and ingress counters. */
export type Activity = { inFlight: number; lastStartedAt?: number; lastEndedAt?: number };

// ---- Parsers (outputs measured on macOS 27.0.1, 2026-10-20) ---------------------------------

export type Battery = { percent: number | null; onBattery: boolean };

/**
 * `pmset -g batt`:
 *   Now drawing from 'AC Power'
 *    -InternalBattery-0 (id=7995491)	55%; AC attached; not charging present: true
 * A Mac without a battery prints no InternalBattery line: percent null, never "on battery".
 */
export function parseBattery(text: string): Battery {
  const source = /Now drawing from '([^']+)'/.exec(text)?.[1] ?? "";
  const pct = /InternalBattery[^\n]*?\t?(\d{1,3})%/.exec(text)?.[1];
  return { percent: pct === undefined ? null : Number(pct), onBattery: /battery/i.test(source) };
}

export type Thermal = "normal" | "warning" | "unknown";

/**
 * `pmset -g therm`. Measured with nothing recorded:
 *   Note: No thermal warning level has been recorded
 * When a level is recorded pmset prints "Thermal warning level set to N." (any N > 0 is a warning).
 * Output that says neither is "unknown": reported, not acted on, because a wording change in a new
 * macOS must not switch the feature off for good. A failed command is an error, which is acted on.
 */
export function parseThermal(text: string): Thermal {
  const level = /thermal warning level set to (\d+)/i.exec(text)?.[1];
  if (level !== undefined) return Number(level) > 0 ? "warning" : "normal";
  if (/no thermal warning level has been recorded/i.test(text)) return "normal";
  return "unknown";
}

export type Clamshell = { lidClosed: boolean | null; causesSleep: boolean | null; sleepDisabled: boolean | null };

/**
 * `ioreg -r -k AppleClamshellState -d 4` (no privilege needed):
 *   |   "AppleClamshellCausesSleep" = No
 *   |   "AppleClamshellState" = Yes
 *   |   "SleepDisabled" = No
 * `AppleClamshellCausesSleep` is No while an external display keeps a closed Mac in closed-display
 * mode — the state in which a closed lid must never be put to sleep by us.
 */
export function parseClamshell(text: string): Clamshell {
  const flag = (key: string): boolean | null => {
    const m = new RegExp(`"${key}"\\s*=\\s*(Yes|No)`).exec(text);
    return m ? m[1] === "Yes" : null;
  };
  return { lidClosed: flag("AppleClamshellState"), causesSleep: flag("AppleClamshellCausesSleep"), sleepDisabled: flag("SleepDisabled") };
}

// ---- The decision -----------------------------------------------------------------------------

export const WORKING_GRACE_MS = 10 * 60_000;

export type AwakeInput = {
  settings: AwakeSettings;
  now: number;
  inFlight: number;
  /** Last time a model call started or finished, across router restarts (journal). */
  lastActivityAt?: number;
  battery: Battery | null;
  thermal: Thermal;
  /** A guard reading failed. */
  error?: string;
};

/** Whether the Mac should be held awake now, and the one-line reason. Pure. */
export function decideAwake(i: AwakeInput): { wanted: boolean; reason: string } {
  const { mode, until, batteryFloorPercent } = i.settings;
  if (mode === "off") return { wanted: false, reason: "off" };
  const untilMs = until ? Date.parse(until) : NaN;
  if (!Number.isNaN(untilMs) && i.now >= untilMs) return { wanted: false, reason: `until ${until} has passed` };
  let reason: string;
  if (mode === "on") reason = "on";
  else if (i.inFlight > 0) reason = `working: ${i.inFlight} model call${i.inFlight === 1 ? "" : "s"} running`;
  else if (i.lastActivityAt !== undefined && i.now - i.lastActivityAt < WORKING_GRACE_MS) reason = `working: last model call ${Math.round((i.now - i.lastActivityAt) / 1000)}s ago`;
  else return { wanted: false, reason: "idle: no model call in the last 10 min" };
  // Guards only matter when something wants the Mac awake.
  if (i.error) return { wanted: false, reason: `error: ${i.error}` };
  if (i.battery?.onBattery && i.battery.percent !== null && i.battery.percent < batteryFloorPercent) {
    return { wanted: false, reason: `battery ${i.battery.percent}% is below ${batteryFloorPercent}%` };
  }
  if (i.thermal === "warning") return { wanted: false, reason: "thermal warning" };
  return { wanted: true, reason };
}

// ---- Journal -----------------------------------------------------------------------------------

export type AwakeJournal = { applied: boolean; since: string; reason: string; lastActivityAt?: number };

export function readJournal(file: string): AwakeJournal | null {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<AwakeJournal>;
    if (typeof j.applied !== "boolean") return null;
    return { applied: j.applied, since: String(j.since ?? ""), reason: String(j.reason ?? ""), ...(typeof j.lastActivityAt === "number" ? { lastActivityAt: j.lastActivityAt } : {}) };
  } catch {
    return null;
  }
}

function writeJournal(file: string, j: AwakeJournal): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(j) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** `sudo -n` refused: the rule is missing or does not cover this exact command. */
export function sudoRefused(r: RunResult): boolean {
  return r.code !== 0 && /password is required|not allowed|sudoers|sorry, user|a terminal is required/i.test(r.stderr + r.stdout);
}

// ---- Controller --------------------------------------------------------------------------------

export type AwakeStatus = {
  mode: AwakeSettings["mode"];
  applied: boolean;
  reason: string;
  setup: "ok" | "needs-setup" | "unsupported";
  battery: Battery | null;
  thermal: Thermal | null;
  lidClosed: boolean | null;
  until: string | null;
};

export type AwakeDeps = {
  platform: NodeJS.Platform;
  run: Runner;
  settings: () => AwakeSettings;
  activity: () => Activity;
  journalFile: string;
  log: { info(m: string): void; warn(m: string): void };
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  fileExists?: (file: string) => boolean;
  /** Schedules the periodic tick; returns a cancel. Tests pass a no-op. */
  schedule?: (fn: () => void, everyMs: number) => () => void;
};

export const AWAKE_TICK_MS = 15_000;
/** Pause between clearing the bit and reading whether a closed lid now causes sleep. */
export const SLEEPNOW_SETTLE_MS = 3_000;

export class AwakeController {
  private applied = false;
  private reason = "not started";
  private battery: Battery | null = null;
  private thermal: Thermal | null = null;
  private lidClosed: boolean | null = null;
  private sudoFailed = false;
  private lastActivityAt: number | undefined;
  private journaledActivityAt: number | undefined;
  private busy: Promise<void> | null = null;
  private cancel: (() => void) | null = null;
  private lastLogged = "";
  private readonly deps: AwakeDeps;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly fileExists: (f: string) => boolean;

  constructor(deps: AwakeDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.fileExists = deps.fileExists ?? ((f) => fs.existsSync(f));
    const j = readJournal(deps.journalFile);
    // Reconcile starts from what the last process recorded: if it set the bit and died (or was
    // restarted), we own it now and the first tick keeps or clears it.
    if (j) {
      this.applied = j.applied;
      this.lastActivityAt = j.lastActivityAt;
      this.journaledActivityAt = j.lastActivityAt;
    }
  }

  get supported(): boolean {
    return this.deps.platform === "darwin";
  }

  /** First tick now (the reconcile), then every 15s. A no-op off macOS. */
  async start(): Promise<void> {
    if (!this.supported) {
      this.reason = "unsupported on this platform";
      return;
    }
    await this.tick();
    const schedule = this.deps.schedule ?? ((fn, ms) => {
      const t = setInterval(fn, ms);
      t.unref();
      return () => clearInterval(t);
    });
    this.cancel = schedule(() => void this.tick(), AWAKE_TICK_MS);
  }

  stop(): void {
    this.cancel?.();
    this.cancel = null;
  }

  status(): AwakeStatus {
    const s = this.deps.settings();
    return {
      mode: s.mode,
      applied: this.applied,
      reason: this.reason,
      setup: !this.supported ? "unsupported" : this.sudoFailed || !this.fileExists(SUDOERS_FILE) ? "needs-setup" : "ok",
      battery: this.battery,
      thermal: this.thermal,
      lidClosed: this.lidClosed,
      until: s.until ?? null,
    };
  }

  /** One evaluation. Concurrent callers share the running one. */
  tick(): Promise<void> {
    if (!this.supported) return Promise.resolve();
    if (!this.busy) this.busy = this.evaluate().finally(() => (this.busy = null));
    return this.busy;
  }

  /** A fresh evaluation after a settings change: one already running read the old settings. */
  async refresh(): Promise<void> {
    if (this.busy) await this.busy;
    await this.tick();
  }

  /**
   * The router is exiting. Only the journal is written (with the latest activity, so a successor
   * remembers the working window); the bit stays as it is. See the header comment for why.
   */
  beforeExit(): void {
    if (!this.supported) return;
    this.noteActivity();
    this.persist(true);
  }

  private noteActivity(): void {
    const a = this.deps.activity();
    const latest = Math.max(a.lastStartedAt ?? 0, a.lastEndedAt ?? 0, a.inFlight > 0 ? this.now() : 0);
    if (latest > 0 && (this.lastActivityAt === undefined || latest > this.lastActivityAt)) this.lastActivityAt = latest;
  }

  private persist(force = false): void {
    // The activity time is written at most once a minute: it only has to survive a restart.
    const stale = this.lastActivityAt !== undefined && (this.journaledActivityAt === undefined || this.lastActivityAt - this.journaledActivityAt >= 60_000);
    if (!force && !stale) return;
    try {
      const prev = readJournal(this.deps.journalFile);
      writeJournal(this.deps.journalFile, {
        applied: this.applied,
        since: prev && prev.applied === this.applied ? prev.since : new Date(this.now()).toISOString(),
        reason: this.reason,
        ...(this.lastActivityAt !== undefined ? { lastActivityAt: this.lastActivityAt } : {}),
      });
      this.journaledActivityAt = this.lastActivityAt;
    } catch (e) {
      this.deps.log.warn(`awake: cannot write journal: ${(e as Error).message}`);
    }
  }

  private logOnce(line: string): void {
    if (line === this.lastLogged) return;
    this.lastLogged = line;
    this.deps.log.info(line);
  }

  private async evaluate(): Promise<void> {
    const settings = this.deps.settings();
    this.noteActivity();
    const activity = this.deps.activity();
    // Nothing to watch: no reads, no processes, unless a bit we set still has to be cleared.
    if (settings.mode === "off" && !this.applied) {
      this.reason = "off";
      this.battery = null;
      this.thermal = null;
      this.lidClosed = null;
      this.persist();
      return;
    }
    let error: string | undefined;
    const batt = await this.deps.run(PMSET, ["-g", "batt"]);
    if (batt.code === 0) this.battery = parseBattery(batt.stdout);
    else error = `pmset -g batt failed (${batt.code})`;
    const therm = await this.deps.run(PMSET, ["-g", "therm"]);
    if (therm.code === 0) this.thermal = parseThermal(therm.stdout);
    else error ??= `pmset -g therm failed (${therm.code})`;
    const clam = await this.readClamshell();
    // The bit reads cleared although we set it: a reboot (it does not survive one) or another tool
    // (Insomnia saw one reset it every 2s). Take it as not applied, so a wanted state is set again
    // below — re-asserting at most once per tick — and an unwanted one is not "cleared" twice.
    if (this.applied && clam?.sleepDisabled === false) {
      this.logOnce("awake: sleep was re-enabled outside ClaudeRipple (reboot or another tool)");
      this.applied = false;
    }
    const d = decideAwake({
      settings,
      now: this.now(),
      inFlight: activity.inFlight,
      ...(this.lastActivityAt !== undefined ? { lastActivityAt: this.lastActivityAt } : {}),
      battery: this.battery,
      thermal: this.thermal ?? "unknown",
      ...(error ? { error } : {}),
    });
    this.reason = d.reason;
    if (d.wanted && !this.applied) await this.set(true, d.reason);
    else if (!d.wanted && this.applied) {
      if (await this.set(false, d.reason)) await this.sleepIfLidClosed();
    }
    this.persist();
  }

  private async readClamshell(): Promise<Clamshell | null> {
    const r = await this.deps.run(IOREG, ["-r", "-k", "AppleClamshellState", "-d", "4"]);
    if (r.code !== 0) return null;
    const c = parseClamshell(r.stdout);
    this.lidClosed = c.lidClosed;
    return c;
  }

  /** `sudo -n pmset -a disablesleep 1|0`. The journal is written before setting and after clearing. */
  private async set(on: boolean, reason: string): Promise<boolean> {
    if (on) {
      this.applied = true;
      this.persist(true);
    }
    const r = await this.deps.run(SUDO, ["-n", PMSET, "-a", "disablesleep", on ? "1" : "0"]);
    if (r.code !== 0) {
      this.sudoFailed = sudoRefused(r);
      if (on) {
        this.applied = false;
        this.persist(true);
      }
      this.reason = this.sudoFailed ? "needs setup: run `clauderipple awake setup` once" : `pmset failed: ${(r.stderr || r.stdout).trim().slice(0, 200)}`;
      this.logOnce(`awake: could not ${on ? "disable" : "re-enable"} sleep (${reason}): ${this.reason}`);
      return false;
    }
    this.sudoFailed = false;
    this.applied = on;
    this.persist(true);
    this.lastLogged = "";
    this.deps.log.info(`awake: sleep ${on ? "disabled" : "re-enabled"} (${reason})`);
    return true;
  }

  /**
   * With the bit cleared, a Mac whose lid is shut keeps running: nothing re-evaluates the lid. If the
   * lid is closed and macOS says a closed lid now causes sleep (no external display holding it in
   * closed-display mode), put it to sleep so a bagged Mac does not run on. Tried unprivileged first,
   * then through the sudoers rule.
   */
  private async sleepIfLidClosed(): Promise<void> {
    await this.sleep(SLEEPNOW_SETTLE_MS);
    const c = await this.readClamshell();
    if (!c?.lidClosed || c.causesSleep !== true) return;
    this.deps.log.info("awake: lid is closed and nothing else holds the Mac awake; sleeping now");
    const r = await this.deps.run(PMSET, ["sleepnow"]);
    if (r.code === 0) return;
    const s = await this.deps.run(SUDO, ["-n", PMSET, "sleepnow"]);
    if (s.code !== 0) this.deps.log.warn(`awake: pmset sleepnow failed: ${(s.stderr || s.stdout || r.stderr).trim().slice(0, 200)}`);
  }
}
