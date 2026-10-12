import type { SessionSummary } from "../src/protocol.ts";
import { lang } from "./i18n.ts";

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
/**
 * The app sidebar's rule (checked against live sessions 2026-10-12): unread outranks working,
 * and working is one state whether the main turn or only subagents run. Opening the phone never
 * changes Claude's read state. The transcript task count is not used here: tasks whose end was
 * never recorded linger in it, which made long-idle sessions blink.
 */
export function sidebarState(s: SessionSummary): string {
  if (s.pending > 0 || s.state === "waiting") return "waiting";
  if (s.state === "error") return "error";
  if (s.unread) return "unread";
  if (s.state === "running" || s.state === "starting" || s.background) return "running";
  return "read";
}
