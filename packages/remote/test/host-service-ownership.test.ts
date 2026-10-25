// The phone host is a second account-wide service, beside the router's. A main install's uninstall
// removes it only when its definition records that installation's home; a release check under its
// own home must leave the real one alone, and an unrecorded one is only removed when the user asks
// explicitly (`remote uninstall`) (G-D01, 2026-10-25).
//
// Nothing here runs launchd, systemd or PowerShell: the definition is a string and removal is
// injected.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hostServiceOwnership, servicePaths, uninstallService } from "../src/host-service.ts";

const home = "/tmp/cr-host-install-a";
const other = "/tmp/cr-host-install-b";

const plist = (recorded: string | null): string => `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>EnvironmentVariables</key>
  <dict>
${recorded === null ? "" : `    <key>CLAUDERIPPLE_HOME</key><string>${recorded}</string>`}
  </dict>
</dict>
</plist>
`;
const unit = (recorded: string | null): string => `[Unit]\nDescription=Ripple Remote host\n\n[Service]\nExecStart="/n" "/s"\n${recorded === null ? "" : `Environment="CLAUDERIPPLE_HOME=${recorded}"`}\n`;
const launcher = (recorded: string): string => `﻿# Ripple Remote host\r\n$env:CLAUDERIPPLE_HOME = '${recorded}'\r\n`;

test("macOS host removal propagates lookup and bootout failures without deleting the definition", async t => {
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), "cr-host-remove-"));
  t.after(() => fs.rmSync(userHome, { recursive: true, force: true }));
  const file = servicePaths("darwin", userHome).definition;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (const failure of ["print", "bootout"]) {
    fs.writeFileSync(file, plist(home));
    await assert.rejects(uninstallService({ platform: "darwin", installationHome: home, userHome, launchctl: (_cmd, args) => ({ status: args[0] === failure ? 1 : 0, out: "permission denied" }) }), /보존했습니다/);
    assert.equal(fs.readFileSync(file, "utf8"), plist(home));
  }
});

test("the host service records the installation home it was written for", () => {
  for (const [platform, text] of [["darwin", plist(home)], ["linux", unit(home)], ["win32", launcher(home)]] as const) {
    assert.equal(hostServiceOwnership(text, platform, home).state, "ours", platform);
    assert.equal(hostServiceOwnership(text, platform, other).state, "other", platform);
    assert.equal(hostServiceOwnership(text, platform, home).home, home);
  }
  // A definition that records no home is unknown, never absent: it is not this home's to remove.
  assert.equal(hostServiceOwnership(plist(null), "darwin", home).state, "unknown");
  assert.equal(hostServiceOwnership(unit(null), "linux", home).state, "unknown");
  assert.equal(hostServiceOwnership(null, "darwin", home).state, "absent");
});

test("uninstall removes this home's host service, keeps another's, and takes an unknown one only when explicit", async () => {
  const calls: string[] = [];
  const deps = (text: string | null, extra: Record<string, unknown> = {}) => ({
    platform: "linux" as const,
    installationHome: home,
    readDefinition: () => text,
    stop: () => { calls.push("stop"); },
    removeDefinition: () => { calls.push("remove"); },
    ...extra,
  });
  assert.deepEqual(await uninstallService(deps(null)), ["no phone host service was installed"]);
  assert.deepEqual(calls, []);

  await assert.rejects(uninstallService(deps(unit(other))), /another ClaudeRipple installation/);
  assert.deepEqual(calls, [], "another installation's host is never stopped or removed");

  await assert.rejects(uninstallService(deps(unit(null))), /does not record which installation/);
  assert.deepEqual(calls, [], "an unrecorded host is preserved, not guessed at");

  await assert.rejects(uninstallService({ ...deps(unit(null)), readDefinition: () => { throw new Error("permission denied"); } }), /could not be read/);
  assert.deepEqual(calls, []);

  const lines = await uninstallService(deps(unit(home)));
  assert.deepEqual(calls, ["stop", "remove"]);
  assert.match(lines[0]!, /removed .*clauderipple-host\.service/);

  calls.length = 0;
  await uninstallService(deps(unit(null), { explicit: true }));
  assert.deepEqual(calls, ["stop", "remove"], "remote uninstall is the explicit request that may take an unrecorded host");
});
