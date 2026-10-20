// `clauderipple awake setup [--ssid NAME] [--remove]` — the one privileged step behind lid-closed
// awake and hotspot failover (router: awake.ts, tether.ts).
//
// It installs /etc/sudoers.d/clauderipple, which lets this user run exactly these as root, without a
// password (the router only ever uses `sudo -n`, which fails rather than prompting):
//   /usr/bin/pmset -a disablesleep 0 | 1     hold a closed MacBook awake, and release it
//   /usr/bin/pmset sleepnow                  put a closed Mac to sleep when we release it
//   /usr/sbin/networksetup -setairportnetwork <wifi device> <hotspot name>   (only with a hotspot name)
// The grant is per user, not per app (Insomnia's README says the same of its own rule).
//
// The rule text is built here and written to a temp file by this (unprivileged) process; the one
// privileged step is a single `osascript … do shell script … with administrator privileges`, so the
// user types their password into macOS's own dialog. That script copies the file root-owned, checks
// its SHA-256 against what was built (nothing can swap it in between), checks it with `visudo -cf`,
// moves it into place, and checks the whole sudoers config again — removing ours if that fails, so a
// broken rule can never lock the user out of sudo. Only then does it clear Insomnia's privileged
// leftovers; the rest of Insomnia is removed unprivileged afterwards. Everything is built as data
// and unit-tested as text: no SSID ever reaches a shell (it is validated, then only written to the
// file), and every path in the script is single-quoted.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ssidProblem } from "../../router/src/config.ts";
import { PMSET, SUDO, SUDOERS_FILE, readJournal, type Runner } from "../../router/src/awake.ts";
import { NETWORKSETUP, parseWifiDevice } from "../../router/src/tether.ts";

export const OSASCRIPT = "/usr/bin/osascript";
const STAGED = "/etc/sudoers.d/.clauderipple.new"; // sudo ignores names containing a dot
const INSOMNIA_SUDOERS = "/etc/sudoers.d/insomnia";
const INSOMNIA_LABEL = "com.insomnia.backstop";
const INSOMNIA_KEYCHAIN_SERVICE = "insomnia-hotspot";

/** POSIX single quotes: the only character that needs care inside them is the quote itself. */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** An AppleScript string literal. */
export function asString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function userProblem(user: string): string | null {
  return /^[A-Za-z_][A-Za-z0-9_.-]{0,31}$/.test(user) ? null : `unexpected user name "${user}"`;
}

/** The sudoers drop-in. Throws on anything that could not be written literally. */
export function sudoersRule(o: { user: string; wifiDevice?: string; ssid?: string }): string {
  const bad = userProblem(o.user);
  if (bad) throw new Error(bad);
  const commands = [`${PMSET} -a disablesleep 0`, `${PMSET} -a disablesleep 1`, `${PMSET} sleepnow`];
  if (o.ssid !== undefined) {
    const problem = ssidProblem(o.ssid);
    if (problem) throw new Error(problem);
    if (!o.wifiDevice || !/^en\d+$/.test(o.wifiDevice)) throw new Error(`unexpected Wi-Fi device "${o.wifiDevice ?? ""}"`);
    commands.push(`${NETWORKSETUP} -setairportnetwork ${o.wifiDevice} ${o.ssid}`);
  }
  return [
    "# ClaudeRipple: keep the Mac awake with the lid closed, and join the iPhone hotspot.",
    "# Installed by `clauderipple awake setup`; removed by `clauderipple awake setup --remove`.",
    `${o.user} ALL=(root) NOPASSWD: ${commands.join(", ")}`,
    "",
  ].join("\n");
}

function pathProblem(p: string): string | null {
  return /^\/[A-Za-z0-9/._-]+$/.test(p) ? null : `unexpected characters in path ${p}`;
}

/** The privileged shell script for install. One line, run by `do shell script` (/bin/sh). */
export function installScript(o: { tempFile: string; sha256: string; removeInsomnia: boolean }): string {
  const bad = pathProblem(o.tempFile);
  if (bad) throw new Error(bad);
  if (!/^[0-9a-f]{64}$/.test(o.sha256)) throw new Error("bad sha256");
  const undoStaged = `{ /bin/rm -f ${shQuote(STAGED)}; exit 3; }`;
  const steps = [
    "set -e",
    `/usr/bin/install -m 0440 -o root -g wheel ${shQuote(o.tempFile)} ${shQuote(STAGED)}`,
    `[ "$(/usr/bin/shasum -a 256 ${shQuote(STAGED)} | /usr/bin/cut -c1-64)" = ${shQuote(o.sha256)} ] || ${undoStaged}`,
    `/usr/sbin/visudo -cf ${shQuote(STAGED)} || ${undoStaged}`,
    `/bin/mv -f ${shQuote(STAGED)} ${shQuote(SUDOERS_FILE)}`,
    `/usr/sbin/visudo -c || { /bin/rm -f ${shQuote(SUDOERS_FILE)}; exit 4; }`,
  ];
  // Insomnia's privileged leftovers, only after ours is safely in place: clear the sleep bit it may
  // have left set (its backstop is about to go), then its rule.
  if (o.removeInsomnia) steps.push(`${PMSET} -a disablesleep 0`, `/bin/rm -f ${shQuote(INSOMNIA_SUDOERS)}`);
  return steps.join("; ");
}

/** The privileged shell script for `--remove`. Clears the bit only if our journal says we set it. */
export function removeScript(o: { clearSleepBit: boolean }): string {
  const steps = ["set -e"];
  if (o.clearSleepBit) steps.push(`${PMSET} -a disablesleep 0`);
  steps.push(`/bin/rm -f ${shQuote(SUDOERS_FILE)} ${shQuote(STAGED)}`);
  return steps.join("; ");
}

/** `osascript` arguments that run `script` as root after macOS's own password dialog. */
export function adminOsascriptArgs(script: string, prompt: string): string[] {
  return ["-e", `do shell script ${asString(script)} with prompt ${asString(prompt)} with administrator privileges`];
}

export type CleanupStep =
  | { label: string; kind: "run"; file: string; args: string[] }
  | { label: string; kind: "trash"; path: string };

export function insomniaPaths(home: string): { plist: string; app: string } {
  return {
    plist: path.join(home, "Library", "LaunchAgents", `${INSOMNIA_LABEL}.plist`),
    app: path.join(home, "Applications", "Insomnia.app"),
  };
}

/** Insomnia's unprivileged leftovers, in order. Failures are reported, not fatal. */
export function insomniaCleanupSteps(o: { uid: number; home: string; exists: (p: string) => boolean }): CleanupStep[] {
  const p = insomniaPaths(o.home);
  const steps: CleanupStep[] = [{ label: "stop Insomnia's backstop agent", kind: "run", file: "/bin/launchctl", args: ["bootout", `gui/${o.uid}/${INSOMNIA_LABEL}`] }];
  if (o.exists(p.plist)) steps.push({ label: "move the backstop agent's plist to the Trash", kind: "trash", path: p.plist });
  steps.push({ label: "quit Insomnia", kind: "run", file: "/usr/bin/killall", args: ["-TERM", "Insomnia"] });
  if (o.exists(p.app)) steps.push({ label: "move Insomnia.app to the Trash", kind: "trash", path: p.app });
  steps.push({ label: "delete Insomnia's hotspot password from the keychain", kind: "run", file: "/usr/bin/security", args: ["delete-generic-password", "-s", INSOMNIA_KEYCHAIN_SERVICE] });
  return steps;
}

export function insomniaPresent(home: string, exists: (p: string) => boolean): boolean {
  const p = insomniaPaths(home);
  return exists(INSOMNIA_SUDOERS) || exists(p.plist) || exists(p.app);
}

// ---- Orchestration ------------------------------------------------------------------------------

export type SetupDeps = {
  platform: NodeJS.Platform;
  run: Runner;
  user: string;
  uid: number;
  /** The user's home (for Insomnia's files). */
  home: string;
  /** ClaudeRipple's home (awake.json). */
  rippleHome: string;
  exists: (p: string) => boolean;
  /** Writes the rule to a fresh temp file and returns its path. */
  writeTemp: (content: string) => string;
  removeTemp: (file: string) => void;
  /** Moves a file to the Trash (fallback when /usr/bin/trash is missing or fails). */
  trashFallback: (p: string) => void;
  print: (line: string) => void;
};

export function defaultSetupDeps(run: Runner, rippleHome: string): SetupDeps {
  const info = os.userInfo();
  return {
    platform: process.platform,
    run,
    user: info.username,
    uid: info.uid,
    home: os.homedir(),
    rippleHome,
    exists: (p) => fs.existsSync(p),
    writeTemp: (content) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clauderipple-sudoers-"));
      const file = path.join(dir, "clauderipple");
      fs.writeFileSync(file, content, { mode: 0o644 });
      return file;
    },
    removeTemp: (file) => fs.rmSync(path.dirname(file), { recursive: true, force: true }),
    trashFallback: (p) => {
      const trash = path.join(os.homedir(), ".Trash");
      let target = path.join(trash, path.basename(p));
      if (fs.existsSync(target)) target = path.join(trash, `${path.basename(p, path.extname(p))} ${Date.now()}${path.extname(p)}`);
      fs.renameSync(p, target);
    },
    print: (line) => console.log(line),
  };
}

export type SetupResult = { ok: boolean; detail: string; wifiDevice?: string };

export async function awakeSetup(o: { ssid?: string }, d: SetupDeps): Promise<SetupResult> {
  if (d.platform !== "darwin") return { ok: false, detail: "lid-closed awake and hotspot failover are macOS only" };
  let wifiDevice: string | undefined;
  if (o.ssid !== undefined) {
    const problem = ssidProblem(o.ssid);
    if (problem) return { ok: false, detail: problem };
    const ports = await d.run(NETWORKSETUP, ["-listallhardwareports"]);
    wifiDevice = (ports.code === 0 ? parseWifiDevice(ports.stdout) : null) ?? undefined;
    if (!wifiDevice) return { ok: false, detail: "no Wi-Fi interface found (networksetup -listallhardwareports)" };
  }
  const rule = sudoersRule({ user: d.user, ...(o.ssid !== undefined ? { ssid: o.ssid, wifiDevice: wifiDevice! } : {}) });
  const removeInsomnia = insomniaPresent(d.home, d.exists);
  const temp = d.writeTemp(rule);
  let r;
  try {
    const script = installScript({ tempFile: temp, sha256: crypto.createHash("sha256").update(rule).digest("hex"), removeInsomnia });
    d.print("macOS will ask for your password once, in its own dialog (ClaudeRipple never sees it).");
    r = await d.run(OSASCRIPT, adminOsascriptArgs(script, "ClaudeRipple wants to keep your Mac awake with the lid closed and join your iPhone hotspot when Wi-Fi fails."), { timeoutMs: 5 * 60_000 });
  } finally {
    d.removeTemp(temp);
  }
  if (r.code !== 0) {
    const text = (r.stderr || r.stdout).trim();
    return { ok: false, detail: /-128|cancel/i.test(text) ? "cancelled; nothing was changed" : `the privileged step failed: ${text.slice(0, 300)}` };
  }
  const check = await d.run(SUDO, ["-n", "-l", PMSET, "-a", "disablesleep", "1"]);
  if (check.code !== 0) return { ok: false, detail: "the rule was installed but `sudo -n -l` does not allow pmset; check /etc/sudoers.d/clauderipple" };
  d.print(`✓ installed ${SUDOERS_FILE}${o.ssid !== undefined ? ` (pmset, and joining "${o.ssid}" on ${wifiDevice})` : " (pmset)"}`);
  if (removeInsomnia) {
    d.print("✓ cleared Insomnia's sleep setting and its sudoers rule");
    for (const step of insomniaCleanupSteps({ uid: d.uid, home: d.home, exists: d.exists })) d.print(`${(await runCleanupStep(step, d)) ? "✓" : "·"} ${step.label}`);
  }
  return { ok: true, detail: "setup complete", ...(wifiDevice ? { wifiDevice } : {}) };
}

async function runCleanupStep(step: CleanupStep, d: SetupDeps): Promise<boolean> {
  if (step.kind === "run") return (await d.run(step.file, step.args)).code === 0;
  const r = await d.run("/usr/bin/trash", [step.path]);
  if (r.code === 0) return true;
  try {
    d.trashFallback(step.path);
    return true;
  } catch {
    return false;
  }
}

export async function awakeRemove(d: SetupDeps): Promise<SetupResult> {
  if (d.platform !== "darwin") return { ok: false, detail: "lid-closed awake is macOS only" };
  const journal = readJournal(path.join(d.rippleHome, "awake.json"));
  const script = removeScript({ clearSleepBit: journal?.applied === true });
  d.print("macOS will ask for your password once, in its own dialog.");
  const r = await d.run(OSASCRIPT, adminOsascriptArgs(script, "ClaudeRipple wants to remove its lid-closed awake permission."), { timeoutMs: 5 * 60_000 });
  if (r.code !== 0) {
    const text = (r.stderr || r.stdout).trim();
    return { ok: false, detail: /-128|cancel/i.test(text) ? "cancelled; nothing was changed" : `the privileged step failed: ${text.slice(0, 300)}` };
  }
  if (journal?.applied) writeReleasedJournal(d.rippleHome, "awake setup --remove");
  return { ok: true, detail: `removed ${SUDOERS_FILE}` };
}

function writeReleasedJournal(rippleHome: string, reason: string): void {
  const file = path.join(rippleHome, "awake.json");
  const prev = readJournal(file);
  fs.writeFileSync(file, JSON.stringify({ applied: false, since: new Date().toISOString(), reason, ...(prev?.lastActivityAt !== undefined ? { lastActivityAt: prev.lastActivityAt } : {}) }) + "\n", { mode: 0o600 });
}

/**
 * If the router set the sleep bit (journal), clear it now with `sudo -n`. For `stop`, `uninstall`
 * and `awake off` with no router answering: a router that is gone cannot reconcile it.
 */
export async function releaseAwake(run: Runner, rippleHome: string, reason: string, platform: NodeJS.Platform = process.platform): Promise<"released" | "not-held" | "failed"> {
  if (platform !== "darwin") return "not-held";
  const journal = readJournal(path.join(rippleHome, "awake.json"));
  if (!journal?.applied) return "not-held";
  const r = await run(SUDO, ["-n", PMSET, "-a", "disablesleep", "0"]);
  if (r.code !== 0) return "failed";
  writeReleasedJournal(rippleHome, reason);
  return "released";
}
