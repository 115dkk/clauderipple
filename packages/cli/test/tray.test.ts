import { test } from "node:test";
import assert from "node:assert/strict";

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { earlyExit, npmEnv, swapTrayRuntime, trayEnv, trayRuntimeMatches, trayRuntimeRange } from "../src/tray.ts";

// Issue #50: a tray that died at launch still reported "✓ tray started".
test("a tray process that exits at once is reported with its output; one that stays up is started", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-tray-"));
  try {
    const log = path.join(dir, "tray.log");
    fs.writeFileSync(log, "GPU process isn't usable. Goodbye.\n");
    const dead = spawn(process.execPath, ["-e", "process.exit(3)"], { stdio: "ignore" });
    const failed = await earlyExit(dead, log, 5_000);
    assert.equal(failed.ok, false);
    assert.match(failed.message, /exit code 3/);
    assert.match(failed.message, /Goodbye/);

    // A second tray leaves at once with 0 when one is already up.
    const duplicate = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
    assert.deepEqual(await earlyExit(duplicate, log, 5_000), { ok: true, message: "✓ tray is already running" });

    const alive = spawn(process.execPath, ["-e", "setTimeout(() => {}, 5_000)"], { stdio: "ignore" });
    try {
      assert.deepEqual(await earlyExit(alive, log, 300), { ok: true, message: "✓ tray started" });
    } finally { alive.kill(); }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the tray's environment drops ELECTRON_RUN_AS_NODE rather than emptying it (issue #8)", () => {
  // Windows Electron runs as Node whenever the variable exists, even empty (measured 2026-09-24).
  const env = trayEnv({ PATH: "/bin", ELECTRON_RUN_AS_NODE: "1", Electron_Run_As_Node: "" });
  assert.deepEqual(env, { PATH: "/bin" });
  assert.equal(Object.hasOwn(env, "ELECTRON_RUN_AS_NODE"), false);
});

// Issue #80: Electron's install.js runs `node install.js` through npm's shell, and on a machine
// whose only Node is the one ClaudeRipple downloaded there was no `node` on PATH — so the tray
// failed to install on exactly the machines whose router it is meant to recover.
test("npm for the tray finds the running Node first, whatever the variable is called", () => {
  const nodeDir = path.dirname(process.execPath);
  const posix = npmEnv({ PATH: "/usr/bin", KEEP: "1" });
  assert.equal(posix.PATH, `${nodeDir}${path.delimiter}/usr/bin`);
  assert.equal(posix.KEEP, "1");

  // Windows spells it Path: that is the variable the child's shell reads.
  const windows = npmEnv({ Path: "C:\\Windows\\system32" });
  assert.equal(windows.Path?.split(path.delimiter)[0], nodeDir);

  // Both spellings at once would be two variables in the child's environment block; one remains.
  const both = npmEnv({ Path: "C:\\Windows", PATH: "C:\\other" });
  const names = Object.keys(both).filter((name) => name.toUpperCase() === "PATH");
  assert.equal(names.length, 1);
  assert.equal(both[names[0]!]?.split(path.delimiter)[0], nodeDir);
});

// B15: the fetched Electron lives in the home folder, so installing a newer ClaudeRipple left the
// old runtime in place and the tray kept running it. A refresh compares the recorded range and
// swaps in a fully installed copy, keeping the working one when the move cannot be made.
test("a fetched runtime is refreshed only when it is not the one this version asks for", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-tray-runtime-"));
  try {
    assert.equal(trayRuntimeRange(dir), null);
    assert.equal(trayRuntimeMatches("^38.1.0", dir), false);
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ dependencies: { electron: "^38.1.0" } }));
    assert.equal(trayRuntimeRange(dir), "^38.1.0");
    assert.equal(trayRuntimeMatches("^38.1.0", dir), true);
    assert.equal(trayRuntimeMatches("^39.0.0", dir), false, "a newer version's range refreshes the old copy");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a staged runtime replaces the working one, and a locked one is left whole", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cr-tray-swap-"));
  try {
    const target = path.join(root, "tray-runtime");
    // No working copy yet: the staged one simply moves in.
    let staging = path.join(root, "tray-runtime.new-1");
    fs.mkdirSync(staging);
    fs.writeFileSync(path.join(staging, "package.json"), "{}");
    assert.deepEqual(swapTrayRuntime(target, staging), { ok: true });
    assert.equal(fs.existsSync(path.join(target, "package.json")), true);
    assert.equal(fs.existsSync(staging), false);

    // A working copy is replaced, and the backup goes once the move worked.
    staging = path.join(root, "tray-runtime.new-2");
    fs.mkdirSync(staging);
    fs.writeFileSync(path.join(staging, "package.json"), JSON.stringify({ dependencies: { electron: "^39.0.0" } }));
    assert.deepEqual(swapTrayRuntime(target, staging), { ok: true });
    assert.equal(fs.readFileSync(path.join(target, "package.json"), "utf8"), JSON.stringify({ dependencies: { electron: "^39.0.0" } }));
    assert.deepEqual(fs.readdirSync(root).sort(), ["tray-runtime"]);

    // A backup path that cannot be used (a running tray's files held open) leaves both copies as
    // they were, and says so rather than reporting a half-done replacement.
    const blocked = path.join(root, "tray-runtime.new-3");
    fs.mkdirSync(blocked);
    fs.writeFileSync(path.join(blocked, "package.json"), "{}");
    fs.writeFileSync(path.join(root, "taken"), "x");
    const failed = swapTrayRuntime(target, blocked, path.join(root, "taken"));
    assert.equal(failed.ok, false);
    assert.match(failed.ok ? "" : failed.message, /still holds/);
    assert.equal(fs.readFileSync(path.join(target, "package.json"), "utf8"), JSON.stringify({ dependencies: { electron: "^39.0.0" } }));
    assert.equal(fs.existsSync(blocked), true, "the staged copy is the caller's to clean up");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
