import type { SessionSummary } from "../src/protocol.ts";
import { lang } from "./i18n.ts";

export function sidebarLabel(name: string): string {
  if (name === "sidebar:ungrouped") return lang() === "ko" ? "그룹 없음" : "No group";
  if (name === "sidebar:phone") return lang() === "ko" ? "휴대폰에서 시작" : "Started on phone";
  if (name === "sidebar:routines") return lang() === "ko" ? "예약 작업" : "Scheduled tasks";
  if (name === "sidebar:pinned") return lang() === "ko" ? "고정됨" : "Pinned";
  return name;
}
export function sidebarSections(sessions: SessionSummary[], groups?: string[]): { name: string; sessions: SessionSummary[] }[] {
  const names = [...new Set([...(groups ?? []), ...sessions.map(s => s.group ?? (s.origin === "desktop" ? "sidebar:ungrouped" : "sidebar:phone"))])];
  return names.map(name => ({ name: sidebarLabel(name), sessions: sessions.filter(s => (s.group ?? (s.origin === "desktop" ? "sidebar:ungrouped" : "sidebar:phone")) === name)
    .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || b.updatedAt - a.updatedAt) })).filter(g => g.sessions.length > 0);
}
/** Opening the phone never changes Claude's read state. Keep the desktop's unread flag intact. */
export function sidebarState(s: SessionSummary): string {
  if (s.pending > 0 || s.state === "waiting") return "waiting";
  if (s.state === "running" || s.state === "starting" || s.state === "error") return s.state;
  return s.unread ? "unread" : "read";
}
