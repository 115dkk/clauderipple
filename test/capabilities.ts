import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Expected paths written with "/" match what `path` produces only with this separator. */
export const posixPaths = path.sep === "/";

function probePosixModes(): boolean {
  let dir: string | undefined;
  let supported = false;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "clauderipple-modes-"));
    const file = path.join(dir, "probe");
    fs.writeFileSync(file, "", { mode: 0o600 });
    fs.chmodSync(file, 0o600);
    if ((fs.statSync(file).mode & 0o777) !== 0o600) return false;
    fs.chmodSync(dir, 0o700);
    supported = (fs.statSync(dir).mode & 0o777) === 0o700;
  } catch {
    supported = false;
  } finally {
    if (dir) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        supported = false;
      }
    }
  }
  return supported;
}

/** POSIX file and directory permission bits are both preserved only when this probe succeeds. */
export const posixModes = probePosixModes();

export const needsPosixPaths = posixPaths ? false : "needs POSIX path separators";
export const needsPosixModes = posixModes ? false : "needs POSIX permission bits";
