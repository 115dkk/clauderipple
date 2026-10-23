// #80: both install scripts handed a setup that never brought the router up back to the user as
// success — "Open the dashboard…", exit 0 — so `clauderipple update` (and the tray's Update button)
// reported a version that never started, and the version stayed old until `repair` (#62).
//
// These are shell/PowerShell bodies, so the check is by inspection (the task allows it): the setup
// step's exit code is read, a non-zero one ends the script non-zero, and both say what to run next.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const scripts = path.resolve(import.meta.dirname, "../../../scripts");
const read = (name: string): string => fs.readFileSync(path.join(scripts, name), "utf8");

test("install.ps1 inherits `install`'s failure and names the command that finishes the job", () => {
  const ps1 = read("install.ps1");
  const start = ps1.indexOf("& $cmd install");
  const end = ps1.indexOf("# Part of the default install on Windows");
  assert.ok(start >= 0 && end > start, "the setup step is followed by the menu-bar app section");
  const block = ps1.slice(start, end);
  assert.match(block, /^\$setupCode = \$LASTEXITCODE$/m, "the native exit code is read, not assumed");
  assert.match(block, /if \(\$setupCode -ne 0\) \{/);
  assert.match(block, /exit \$setupCode/, "a failed setup ends the script non-zero");
  assert.match(block, /clauderipple\.cmd install/, "the user is told how to finish the install");
  assert.match(block, /clauderipple\.cmd repair/, "and how to recover a router that will not start");
});

test("install.sh stops on a failed setup with a non-zero code and the next command", () => {
  const sh = read("install.sh");
  const start = sh.indexOf('if ! "$BIN/clauderipple" install; then');
  const end = sh.indexOf("# --- the menu-bar app");
  assert.ok(start >= 0 && end > start, "the setup step is followed by the menu-bar app section");
  const block = sh.slice(start, end);
  assert.match(block, /exit 1/);
  assert.match(block, /clauderipple install/);
  assert.match(block, /clauderipple repair/);
});
