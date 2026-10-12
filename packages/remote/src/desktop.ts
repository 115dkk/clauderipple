// Claude Code's top-level transcripts are a read-only source. Discovery is bounded;
// only opening a timeline scans the transcript, into the same capped event log as host sessions.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { EventLog } from "./eventlog.ts";
import type { EventBody, SessionSummary, ToolCall } from "./protocol.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WINDOW = 256 * 1024;
const RECENT_MS = 14 * 24 * 60 * 60 * 1000;
type RecordValue = Record<string, unknown>;
type Summarize = (tool: string, input: RecordValue, cwd: string) => string;
interface Source { file: string; size: number; mtime: number; summary: SessionSummary }
interface Imported { size: number; mtime: number; log: EventLog; dir: string }
export interface DesktopOptions {
  projects?: string;
  now?: () => number;
  summarize: Summarize;
  excluded: () => Set<string>;
  processes?: () => string;
}

/** Match session flags, not UUIDs appearing in a prompt or another flag's value. */
export function processHasSession(output: string, id: string): boolean {
  if (!UUID.test(id)) return false;
  return output.split("\n").some(line => {
    const args = line.trim().split(/\s+/);
    return args.some((arg, i) => arg === `--resume=${id}` || arg === `--session-id=${id}` ||
      ((arg === "--session-id" || arg === "--resume") && args[i + 1] === id));
  });
}

function object(value: unknown): RecordValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
}
const str = (value: unknown): string => typeof value === "string" ? value : "";
function record(line: string): RecordValue | null {
  try { return object(JSON.parse(line)); } catch { return null; } // Untrusted JSONL boundary.
}
function text(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap(value => {
    const block = object(value);
    return block?.type === "text" ? [str(block.text)] : block?.type === "image" ? ["[image]"] : [];
  }).join("\n\n");
}
function prompt(r: RecordValue): string {
  if (r.type !== "user" || r.isSidechain === true || r.isMeta === true) return "";
  const message = object(r.message);
  const body = text(message?.content).trim();
  // CLI-generated command/context messages are not the person's first prompt.
  return /^(<local-command-|<command-name>|<system-reminder>|\[Request interrupted)/.test(body) ? "" : body;
}
function title(value: string): string { return value.trim().replace(/\s+/g, " ").slice(0, 160); }

/** Unknown records and malformed block shapes never become events. */
export function transcriptEvents(line: string, cwd: string, summarize: Summarize): { at: number | null; bodies: EventBody[] } {
  const r = record(line);
  const bodies: EventBody[] = [];
  if (!r || r.isSidechain === true) return { at: null, bodies };
  const time = typeof r.timestamp === "string" ? Date.parse(r.timestamp) : NaN;
  const at = Number.isFinite(time) ? time : null;
  const message = object(r.message);
  if (r.type === "user") {
    const p = prompt(r);
    if (p) bodies.push({ kind: "user", text: p, clientMsgId: str(r.uuid) });
    for (const value of Array.isArray(message?.content) ? message.content : []) {
      const b = object(value);
      if (b?.type === "tool_result" && typeof b.tool_use_id === "string") {
        bodies.push({ kind: "tool_result", toolUseId: b.tool_use_id, ok: b.is_error !== true, text: text(b.content) });
      }
    }
  } else if (r.type === "assistant" && message && Array.isArray(message.content)) {
    const tools: ToolCall[] = [];
    for (const value of message.content) {
      const b = object(value);
      if (b?.type !== "tool_use" || typeof b.id !== "string" || typeof b.name !== "string") continue;
      const input = object(b.input) ?? {};
      tools.push({ id: b.id, name: b.name, summary: summarize(b.name, input, cwd), input: JSON.stringify(input, null, 2) });
    }
    const body = text(message.content);
    if (body || tools.length) bodies.push({ kind: "assistant", msg: str(r.uuid) || str(message.id), model: str(message.model), text: body, tools });
  } else if (r.type === "result") {
    const ok = r.subtype === "success" && r.is_error !== true;
    bodies.push({ kind: "result", ok, ...(!ok ? { error: str(r.result) || str(r.subtype) } : {}), ms: typeof r.duration_ms === "number" ? r.duration_ms : 0, turns: typeof r.num_turns === "number" ? r.num_turns : 0 });
  } else if (r.type === "system" && r.subtype === "turn_duration" && typeof r.durationMs === "number") {
    bodies.push({ kind: "result", ok: true, ms: r.durationMs, turns: 1 });
  }
  return { at, bodies };
}

/** Complete lines only: a partial head/tail record must not be interpreted. */
function windowLines(fd: number, size: number, tail: boolean): string[] {
  const start = tail ? Math.max(0, size - WINDOW) : 0;
  const buffer = Buffer.alloc(Math.min(size - start, WINDOW));
  const n = fs.readSync(fd, buffer, 0, buffer.length, start);
  let data = buffer.toString("utf8", 0, n);
  if (start > 0) data = data.slice(data.indexOf("\n") + 1);
  if (start + n < size || !data.endsWith("\n")) data = data.slice(0, Math.max(0, data.lastIndexOf("\n")));
  return data.split("\n");
}
function missing(error: unknown): boolean {
  return ["ENOENT", "ENOTDIR", "ELOOP"].includes((error as NodeJS.ErrnoException).code ?? "");
}

export class DesktopSessions {
  private opts: DesktopOptions;
  private projects: string;
  private sources = new Map<string, Source>();
  private imported = new Map<string, Imported>();
  private temp: string | null = null;
  private scannedAt = -Infinity;

  constructor(opts: DesktopOptions) {
    this.opts = opts;
    this.projects = path.resolve(opts.projects ?? path.join(os.homedir(), ".claude", "projects"));
  }

  list(): SessionSummary[] {
    this.refresh();
    const excluded = this.opts.excluded();
    return Array.from(this.sources.values()).filter(s => !excluded.has(s.summary.id)).map(s => {
      const cached = this.imported.get(s.summary.id);
      return cached && cached.size === s.size && cached.mtime === s.mtime
        ? { ...s.summary, lastSeq: cached.log.lastSeq, epoch: cached.log.epoch } : s.summary;
    });
  }

  has(id: string): boolean {
    if (!UUID.test(id) || this.opts.excluded().has(id)) return false;
    this.refresh();
    return this.sources.has(id);
  }

  continuation(id: string): { summary: SessionSummary; open: boolean } {
    if (!this.has(id)) throw new Error("no such session");
    const source = this.sources.get(id)!;
    const fd = this.open(source.file);
    try {
      const stat = fs.fstatSync(fd);
      const current = this.readSummary(id, source.file, stat);
      if (!current) throw new Error("transcript has no working folder");
      const processes = this.opts.processes?.() ?? execFileSync("ps", ["-axo", "pid,command"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
      return { summary: current.summary, open: processHasSession(processes, id) || stat.mtimeMs >= (this.opts.now ?? Date.now)() - 60_000 };
    } finally { fs.closeSync(fd); }
  }

  /** Convert directly into the durable host log, preserving timestamps and externalized blobs. */
  importInto(id: string, dir: string, now: () => number): EventLog {
    if (!this.has(id)) throw new Error("no such session");
    const source = this.sources.get(id)!;
    const fd = this.open(source.file);
    let at = source.summary.createdAt;
    let importing = true;
    const log = EventLog.open({ dir, now: () => importing ? at : now() });
    try {
      scanLines(fd, fs.fstatSync(fd).size, line => {
        const parsed = transcriptEvents(line, source.summary.cwd, this.opts.summarize);
        at = parsed.at ?? at;
        for (const body of parsed.bodies) log.append(body.kind === "user" && !body.clientMsgId ? { ...body, clientMsgId: `desktop-${log.lastSeq + 1}` } : body);
      });
      importing = false;
      return log;
    } catch (error) { log.close(); throw error; }
    finally { fs.closeSync(fd); }
  }

  private refresh(): void {
    const now = (this.opts.now ?? Date.now)();
    if (now - this.scannedAt < 5000) return;
    this.scannedAt = now;
    const candidates: { id: string; file: string; stat: fs.Stats }[] = [];
    const excluded = this.opts.excluded();
    try {
      for (const project of fs.readdirSync(this.projects, { withFileTypes: true })) {
        if (!project.isDirectory()) continue; // Never follow project symlinks or recurse.
        const dir = path.join(this.projects, project.name);
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const id = entry.name.slice(0, -6);
          if (!entry.isFile() || !entry.name.endsWith(".jsonl") || !UUID.test(id) || excluded.has(id)) continue;
          const file = path.join(dir, entry.name);
          const stat = fs.lstatSync(file);
          if (stat.isFile() && stat.mtimeMs >= now - RECENT_MS) candidates.push({ id, file, stat });
        }
      }
    } catch (error) { if (!missing(error)) throw error; }
    candidates.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
    const next = new Map<string, Source>();
    for (const { id, file, stat } of candidates) {
      if (next.size >= 50) break;
      if (next.has(id)) continue;
      const source = this.readSummary(id, file, stat);
      if (source) next.set(id, source);
    }
    this.sources = next;
    for (const [id, cached] of this.imported) if (!next.has(id)) { this.dispose(cached); this.imported.delete(id); }
  }

  /** Resolve both directories and the file; a replaced symlink may not escape projects/. */
  private open(file: string): number {
    const root = fs.realpathSync(this.projects);
    const real = fs.realpathSync(file);
    if (!real.startsWith(root + path.sep) || path.relative(root, real).split(path.sep).length !== 2) throw new Error("transcript outside projects");
    return fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  }

  private readSummary(id: string, file: string, stat: fs.Stats): Source | null {
    let fd: number;
    try { fd = this.open(file); } catch (error) { if (missing(error)) return null; throw error; }
    try {
      let cwd = "", model = "", ownTitle = "", firstPrompt = "";
      let createdAt = stat.birthtimeMs;
      for (const line of [...windowLines(fd, stat.size, false), ...windowLines(fd, stat.size, true)]) {
        const r = record(line);
        if (!r || r.isSidechain === true) continue;
        if (!cwd && typeof r.cwd === "string") cwd = r.cwd;
        if (!firstPrompt) firstPrompt = title(prompt(r));
        if (r.type === "custom-title" && typeof r.customTitle === "string") ownTitle = title(r.customTitle);
        if (r.type === "summary" && typeof r.summary === "string" && !ownTitle) ownTitle = title(r.summary);
        const m = object(r.message);
        if (r.type === "assistant" && typeof m?.model === "string") model = m.model;
        const at = typeof r.timestamp === "string" ? Date.parse(r.timestamp) : NaN;
        if (Number.isFinite(at)) createdAt = Math.min(createdAt, at);
      }
      if (!cwd) return null;
      return { file, size: stat.size, mtime: stat.mtimeMs, summary: { id, title: ownTitle || firstPrompt || id, cwd, model, effort: null, state: "stopped", pending: 0, createdAt, updatedAt: stat.mtimeMs, lastSeq: 0, epoch: "", origin: "desktop", readOnly: false } };
    } finally { fs.closeSync(fd); }
  }

  log(id: string): EventLog {
    if (!this.has(id)) throw new Error("no such session");
    const source = this.sources.get(id)!;
    const fd = this.open(source.file);
    try {
      const stat = fs.fstatSync(fd);
      const cached = this.imported.get(id);
      if (cached && cached.size === stat.size && cached.mtime === stat.mtimeMs) return cached.log;
      if (cached) { this.dispose(cached); this.imported.delete(id); }
      this.temp ??= fs.mkdtempSync(path.join(os.tmpdir(), "ripple-desktop-"));
      const dir = fs.mkdtempSync(path.join(this.temp, "snapshot-"));
      const log = this.importInto(id, dir, this.opts.now ?? Date.now);
      this.imported.set(id, { size: stat.size, mtime: stat.mtimeMs, log, dir });
      return log;
    } finally { fs.closeSync(fd); }
  }

  private dispose(cached: Imported): void { cached.log.close(); fs.rmSync(cached.dir, { recursive: true, force: true }); }
  close(): void {
    for (const cached of this.imported.values()) this.dispose(cached);
    this.imported.clear();
    if (this.temp) fs.rmSync(this.temp, { recursive: true, force: true });
    this.temp = null;
  }
}

// Streaming chunks, not readFileSync: no full-file buffer, even for a multi-GB transcript.
function scanLines(fd: number, size: number, visit: (line: string) => void): void {
  const buffer = Buffer.alloc(WINDOW);
  let carry = Buffer.alloc(0);
  for (let offset = 0; offset < size;) {
    const n = fs.readSync(fd, buffer, 0, Math.min(buffer.length, size - offset), offset);
    if (!n) break;
    offset += n;
    const data = Buffer.concat([carry, buffer.subarray(0, n)]);
    let start = 0;
    for (let end = data.indexOf(10); end !== -1; end = data.indexOf(10, start)) {
      visit(data.toString("utf8", start, end));
      start = end + 1;
    }
    carry = Buffer.from(data.subarray(start));
  }
  // An in-flight unterminated append is ignored until the next snapshot.
}
