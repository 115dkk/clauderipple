// Folders the phone can start a session in: recent ones first (this host's sessions, then the
// folders Claude Code itself has worked in), then plain browsing. A token holder can already run
// any command through a session, so browsing is not a boundary; it only lists directories.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { BrowseResult, FolderEntry } from "./protocol.ts";

const BROWSE_CAP = 300;
/** Scratch and worktree folders are noise in a "recent" list a person picks from. */
const NOISE = [/\/\.claude\/worktrees\//i, /^\/private\/tmp\//, /^\/tmp\//, /^\/var\/folders\//, /\/node_modules\//i];
export function noisyFolder(folder: string, temp = os.tmpdir()): boolean {
  const normalized = folder.replace(/\\/g, "/").replace(/\/$/, "") + "/";
  const tempRoot = temp.replace(/\\/g, "/").replace(/\/$/, "") + "/";
  return normalized.toLowerCase().startsWith(tempRoot.toLowerCase()) || NOISE.some(r => r.test(normalized));
}

export interface RecentSource { path: string; lastUsed: number; model?: string }

export async function isDirectory(p: string): Promise<boolean> {
  try { return (await fs.stat(p)).isDirectory(); } catch { return false; }
}

/** One path segment: no separators, control characters or the reserved names "." and "..". */
const FOLDER_NAME = /^[^/\\\u0000-\u001f]{1,100}$/;

/** Make a folder directly inside `parent`, returning its path. The name is one segment and must
 * not already exist; nothing outside `parent` can be reached. */
export async function makeFolder(parent: string, name: string): Promise<string> {
  const dir = path.resolve(parent || os.homedir());
  if (!(await isDirectory(dir))) throw new Error("That parent folder can't be opened");
  const segment = name.trim();
  if (!segment || segment === "." || segment === ".." || !FOLDER_NAME.test(segment)) throw new Error("Invalid folder name");
  const target = path.join(dir, segment);
  await fs.mkdir(target);
  return target;
}

export async function recentFolders(sources: RecentSource[], limit = 12): Promise<FolderEntry[]> {
  const best = new Map<string, RecentSource>();
  for (const s of sources) {
    if (!path.isAbsolute(s.path) || noisyFolder(s.path)) continue;
    const prev = best.get(s.path);
    if (!prev || s.lastUsed > prev.lastUsed) {
      // Keep the model the host knows about even when the CLI's own record is newer.
      const model = s.model ?? prev?.model;
      best.set(s.path, { path: s.path, lastUsed: s.lastUsed, ...(model ? { model } : {}) });
    } else if (s.model && !prev.model) best.set(s.path, { ...prev, model: s.model });
  }
  const sorted = Array.from(best.values()).sort((a, b) => b.lastUsed - a.lastUsed);
  const out: FolderEntry[] = [];
  for (const s of sorted) {
    if (out.length >= limit) break;
    if (!(await isDirectory(s.path))) continue;
    out.push({ path: s.path, name: path.basename(s.path) || s.path, lastUsed: s.lastUsed, ...(s.model ? { model: s.model } : {}) });
  }
  return out;
}

export async function browse(target: string | undefined, hidden = false, home = os.homedir()): Promise<BrowseResult> {
  const dir = path.resolve(target && target.trim() ? target : home);
  const dirents = await fs.readdir(dir, { withFileTypes: true });
  const names: string[] = [];
  for (const d of dirents) {
    if (!hidden && d.name.startsWith(".")) continue;
    if (d.isDirectory()) names.push(d.name);
    else if (d.isSymbolicLink() && (await isDirectory(path.join(dir, d.name)))) names.push(d.name);
  }
  names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
  const entries = names.slice(0, BROWSE_CAP).map((name) => ({ path: path.join(dir, name), name }));
  const parent = path.dirname(dir);
  return { path: dir, parent: parent === dir ? null : parent, home, entries, truncated: names.length > BROWSE_CAP };
}
