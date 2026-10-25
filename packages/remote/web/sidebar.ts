import type { SessionSummary } from "../src/protocol.ts";
import { lang, t } from "./i18n.ts";

/** Use the same folder fallback as the conversation header, also for blank metadata. */
export function sessionTitle(s: Pick<SessionSummary, "title" | "cwd">): string {
  return s.title.trim() || folderName(s.cwd);
}

export function sidebarLabel(name: string): string {
  if (name === "sidebar:ungrouped") return lang() === "ko" ? "그룹 없음" : "No group";
  if (name === "sidebar:phone") return lang() === "ko" ? "휴대폰에서 시작" : "Started on phone";
  if (name === "sidebar:routines") return lang() === "ko" ? "예약 작업" : "Scheduled tasks";
  if (name === "sidebar:pinned") return lang() === "ko" ? "고정됨" : "Pinned";
  if (name === "sidebar:recent") return lang() === "ko" ? "최근" : "Recent";
  return name;
}
const RECENT_MS = 60 * 60_000;

/** Needs a look now: working, waiting, background work, unread, or talked to in the last hour. */
export function isRecent(s: SessionSummary, now: number): boolean {
  return sidebarState(s) !== "read" || now - s.updatedAt < RECENT_MS;
}

/**
 * The app's groups in the app's order, with a 최근 section on top that the app lacks: the
 * sessions that need a look now (isRecent), newest first. Those leave their group so nothing
 * is listed twice.
 */
export function sidebarSections(sessions: SessionSummary[], groups?: string[], now = Date.now()): { name: string; sessions: SessionSummary[] }[] {
  const recent = sessions.filter(s => isRecent(s, now)).sort((a, b) => b.updatedAt - a.updatedAt);
  const rest = sessions.filter(s => !isRecent(s, now));
  const groupOf = (s: SessionSummary) => s.group ?? (s.origin === "desktop" ? "sidebar:ungrouped" : "sidebar:phone");
  const names = [...new Set([...(groups ?? []), ...rest.map(groupOf)])];
  return [{ name: sidebarLabel("sidebar:recent"), sessions: recent }, ...names.map(name => ({ name: sidebarLabel(name), sessions: rest.filter(s => groupOf(s) === name)
    .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || b.updatedAt - a.updatedAt) }))].filter(g => g.sessions.length > 0);
}
/** One glyph rule for the home list, conversation switcher and web sidebar. */
export function sidebarState(s: SessionSummary): string {
  switch (sessionGroup(s)) {
    case "input": return "waiting";
    case "failed": return "error";
    case "review": return "unread";
    case "working": return s.state === "running" || s.state === "starting" ? "running" : "background";
    case "done": return "read";
  }
}

// ---- the phone's session list: grouped by status (or folder), newest change first --------------

/** The list's five buckets, in the order they stack from the top. */
export type SessionGroup = "input" | "failed" | "review" | "working" | "done";
export const GROUP_ORDER: readonly SessionGroup[] = ["input", "failed", "review", "working", "done"];

/**
 * Classify only signals the host actually supplies. Desktop's local sidebar gives live approval
 * and active work precedence over unread completion (ion-dist shared-11 xC → shared-26 Kj,
 * checked 2026-10-25). An old wrap_up cannot block a new main turn. Background work alone does
 * not answer a blocked question. `review` here means unread output, NOT Desktop's PR-ready
 * bucket: PR/merge and completed-ack metadata are not part of this protocol.
 * A transcript task count is not liveness evidence; only `background` is.
 */
export function sessionGroup(s: SessionSummary): SessionGroup {
  if (s.pending > 0 || s.state === "waiting") return "input";
  if (s.state === "error") return "failed";
  if (s.state === "running" || s.state === "starting") return "working";
  if (s.attention?.reason === "question") return "input";
  if (s.background) return "working";
  if (s.attention?.reason === "finished" || s.unread) return "review";
  return "done";
}

export function groupLabel(group: SessionGroup): string {
  return t(`group.${group}` as Parameters<typeof t>[0]);
}

export type GroupMode = "status" | "folder";

/** Newest state change first: the host stamps `updatedAt` when a state changes, so this is that time. */
function byRecency(a: SessionSummary, b: SessionSummary): number {
  return b.updatedAt - a.updatedAt || a.id.localeCompare(b.id);
}

/** One separator for both platforms: a Windows host sends backslashes, a Linux/macOS host slashes. */
const pathForm = (value: string): string => value.replace(/\\/g, "/").replace(/\/+$/, "");
/** Drive letters are case-insensitive on Windows; a POSIX path keeps its case. */
const pathFold = (value: string): string => /^[A-Za-z]:/.test(pathForm(value)) ? pathForm(value).toLowerCase() : pathForm(value);

/** The last path segment, the way a folder is named in speech. `~` for the home folder. */
export function folderName(p: string, home?: string): string {
  if (home && pathFold(home) && pathFold(p) === pathFold(home)) return "~";
  const parts = pathForm(p).split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "/";
}

/** The folder's most recently changed session, for ordering folder sections. */
function folderRecency(sessions: SessionSummary[]): number {
  return sessions.reduce((max, s) => Math.max(max, s.updatedAt), 0);
}

/**
 * The list in the order the phone shows it. `status` (default) stacks the five buckets; `folder`
 * groups by working directory instead. Archived sessions are hidden unless `includeArchived`,
 * because archiving only sets a flag — the transcripts and files stay. Within a section, newest
 * state change first.
 */
export function groupSessions(sessions: SessionSummary[], mode: GroupMode = "status", opts: { includeArchived?: boolean; home?: string } = {}): { key: string; name: string; sessions: SessionSummary[] }[] {
  const list = opts.includeArchived ? sessions.slice() : sessions.filter(s => !s.archived);
  if (mode === "folder") {
    const byFolder = new Map<string, SessionSummary[]>();
    for (const s of list) { const bucket = byFolder.get(s.cwd); if (bucket) bucket.push(s); else byFolder.set(s.cwd, [s]); }
    return [...byFolder.entries()]
      .sort((a, b) => folderRecency(b[1]) - folderRecency(a[1]) || a[0].localeCompare(b[0]))
      .map(([cwd, group]) => ({ key: `folder:${cwd}`, name: folderName(cwd, opts.home), sessions: group.sort(byRecency) }));
  }
  return GROUP_ORDER
    .map(group => ({ key: `group:${group}`, name: groupLabel(group), sessions: list.filter(s => sessionGroup(s) === group).sort(byRecency) }))
    .filter(section => section.sessions.length > 0);
}
