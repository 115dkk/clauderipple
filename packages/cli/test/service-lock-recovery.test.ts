import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { withServiceLock } from "../src/service-definition.ts";

function fixture(t: { after(fn: () => void): void }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cr-lock-recovery-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, key: path.join(root, "service") };
}

test("service lock recovers after its owner exits without finally", t => {
  const { root, key } = fixture(t);
  const module = new URL("../src/service-definition.ts", import.meta.url).href;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `import { withServiceLock } from ${JSON.stringify(module)}; withServiceLock(process.argv[1], () => process.exit(73), () => 'child-start');`, key], { env: { ...process.env, HOME: root }, encoding: "utf8" });
  assert.equal(result.status, 73, result.stderr);
  let entered = false;
  withServiceLock(key, () => { entered = true; }, pid => pid === process.pid ? "parent-start" : null);
  assert.equal(entered, true);
  assert.equal(fs.existsSync(`${key}.operation-lock`), false);
});

test("service lock recovers a reused PID only when its start identity differs", t => {
  const { key } = fixture(t);
  fs.mkdirSync(`${key}.operation-lock`);
  fs.writeFileSync(path.join(`${key}.operation-lock`, `${process.pid}-${"0".repeat(64)}.owner`), "");
  let entered = false;
  withServiceLock(key, () => { entered = true; }, pid => pid === process.pid ? "parent-start" : null);
  assert.equal(entered, true);
});

test("service lock never expires a live owner and preserves unknown locks", t => {
  const { key } = fixture(t);
  const lookup = () => "live-start";
  withServiceLock(key, () => {
    const ancient = new Date(0);
    fs.utimesSync(`${key}.operation-lock`, ancient, ancient);
    assert.throws(() => withServiceLock(key, () => assert.fail("live lock stolen"), lookup), { code: "ELOCKED" });
  }, lookup);
  fs.mkdirSync(`${key}.operation-lock`);
  assert.throws(() => withServiceLock(key, () => assert.fail("unknown lock stolen"), lookup), { code: "ELOCKED" });
});

test("service lock preserves a recorded owner when its process lookup fails", t => {
  const { key } = fixture(t);
  const lock = `${key}.operation-lock`;
  fs.mkdirSync(lock);
  const owner = path.join(lock, `4242-${"0".repeat(64)}.owner`);
  fs.writeFileSync(owner, "");
  assert.throws(() => withServiceLock(key, () => assert.fail("unknown owner stolen"), pid => pid === process.pid ? "self" : undefined), { code: "ELOCKED" });
  assert.equal(fs.existsSync(owner), true);
});
