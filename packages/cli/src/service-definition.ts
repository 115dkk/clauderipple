// Service definitions are account-wide, not installation-local. Every writer/controller takes
// this lock; uncooperative/older writers are detected by a generation check around external work.
// Never steal a stale lock: synchronous supervisor calls can outlast a lease/heartbeat, and a
// crashed operation must leave an explicit incomplete result rather than admit a second writer.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function acquireServiceLock(key: string): () => void {
  const lock = `${key}.operation-lock`;
  fs.mkdirSync(path.dirname(lock), { recursive: true, mode: 0o700 });
  try {
    fs.mkdirSync(lock, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    throw Object.assign(new Error(`서비스 작업 잠금이 있어 작업을 중단했습니다. 다른 작업이 끝났는지 확인해 주세요. (${lock})`), { code: "ELOCKED" });
  }
  return () => fs.rmdirSync(lock);
}

export function withServiceLock<T>(key: string, body: () => T): T {
  const release = acquireServiceLock(key);
  try { return body(); } finally { release(); }
}

export async function withServiceLockAsync<T>(key: string, body: () => Promise<T>): Promise<T> {
  const release = acquireServiceLock(key);
  try { return await body(); } finally { release(); }
}

/** Stable content generation, including the distinct absent generation. Never logs the contents. */
export function definitionGeneration(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value) ?? "undefined").digest("hex");
}

export function assertGeneration(read: () => unknown, expected: string): void {
  if (definitionGeneration(read()) !== expected) throw new Error("서비스 정의가 작업 중에 변경되어 작업을 중단했습니다. 현재 설치의 서비스 상태를 다시 확인해 주세요.");
}

/** Inspect errors are not absence, and a symlink is not a definition this installation may replace. */
export function readServiceFile(file: string): string | null {
  try {
    if (!fs.lstatSync(file).isFile()) throw new Error(`서비스 정의가 일반 파일이 아니므로 보존했습니다. (${file})`);
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function writeServiceFile(file: string, text: string, mode = 0o600): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.new-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  try {
    const fd = fs.openSync(tmp, "wx", mode);
    try { fs.writeFileSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  } finally {
    try { fs.unlinkSync(tmp); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
}

type FileGuard<Args extends unknown[], Result> = { run: (...args: Args) => Result; check: () => void; write: (text: string, mode?: number) => void; remove: () => void };

export function withServiceFile<Args extends unknown[], Result, T>(file: string, run: (...args: Args) => Result, body: (guard: FileGuard<Args, Result>) => T): T {
  return withServiceLock(file, () => {
    const read = () => readServiceFile(file);
    let generation = definitionGeneration(read());
    const check = () => assertGeneration(read, generation);
    const guard: FileGuard<Args, Result> = {
      check,
      run: (...args) => {
        check();
        const result = run(...args);
        check();
        return result;
      },
      write: (text, mode) => {
        check();
        writeServiceFile(file, text, mode);
        generation = definitionGeneration(text);
      },
      remove: () => {
        check();
        fs.rmSync(file, { force: true });
        generation = definitionGeneration(null);
      },
    };
    const result = body(guard);
    check();
    return result;
  });
}
