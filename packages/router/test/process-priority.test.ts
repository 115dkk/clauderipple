import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { raiseWindowsProcessPriority } from "../src/process-priority.ts";

const normal = os.constants.priority.PRIORITY_NORMAL;

test("Windows below-normal process raises itself to Normal and logs once", () => {
  const set: number[] = [];
  const logs: string[] = [];
  raiseWindowsProcessPriority({
    platform: "win32",
    getPriority: () => normal + 10,
    setPriority: priority => set.push(priority),
    log: line => logs.push(line),
  });
  assert.deepEqual(set, [normal]);
  assert.deepEqual(logs, [`process priority: raised itself from below normal (${normal + 10}) to normal`]);
});

test("Windows Normal and above-normal processes are untouched", () => {
  for (const priority of [normal, normal - 1]) {
    let touched = false;
    const logs: string[] = [];
    raiseWindowsProcessPriority({
      platform: "win32",
      getPriority: () => priority,
      setPriority: () => { touched = true; },
      log: line => logs.push(line),
    });
    assert.equal(touched, false);
    assert.deepEqual(logs, []);
  }
});

test("non-Windows platforms do not inspect or change priority", () => {
  for (const platform of ["linux", "darwin"] as const) {
    let inspected = false;
    let touched = false;
    raiseWindowsProcessPriority({
      platform,
      getPriority: () => { inspected = true; return normal + 10; },
      setPriority: () => { touched = true; },
      log: () => assert.fail("non-Windows priority changes must not log"),
    });
    assert.equal(inspected, false);
    assert.equal(touched, false);
  }
});

test("a Windows priority change failure is logged without throwing", () => {
  const logs: string[] = [];
  assert.doesNotThrow(() => raiseWindowsProcessPriority({
    platform: "win32",
    getPriority: () => normal + 10,
    setPriority: () => { throw new Error("Access is denied"); },
    log: line => logs.push(line),
  }));
  assert.deepEqual(logs, ["process priority: failed to raise itself to normal: Access is denied"]);
});
