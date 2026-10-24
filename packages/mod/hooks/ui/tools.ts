// A subagent's tool calls as the Agents pane words them: one short line of each call's input, and a
// run of calls headed in one line the way the Claude app heads it ("실행됨 명령 7개, 편집함 파일
// 1개"), with the lines its edits added and removed. Pure, so the tests can call it.
//
// The phone app's host words a run the same way (packages/remote/src/tool-details.ts
// `activitySummary`). The mod cannot import it: Claude Code loads the mod as its own folder
// (dist/mod in an npm install, scripts/build-npm.mjs), with no packages/remote beside it. So the
// rules are kept here too: kinds in the order they first appear, a file read or edited counted once,
// five or more kinds cut to the first three and the rest counted.

import { t } from '../i18n.ts'
import type { Lang } from '../i18n.ts'

/** Where the session runs and the user's home, to say paths short: relative to the one, `~` for the other. */
export type Place = { cwd?: string; home?: string }

/** One tool call as the pane holds it (view.ts AgentEntry's tool kind); an edit's lines added and removed. */
export type ToolCall = { id: string; tool: string; detail: string; state: 'running' | 'ok' | 'error'; added?: number; removed?: number }

type Activity = 'command' | 'read' | 'edit' | 'search' | 'web' | 'agent' | 'other'

export function activityOf(tool: string): Activity {
  if (['Bash', 'BashOutput', 'KillShell'].includes(tool)) return 'command'
  if (tool === 'Read') return 'read'
  if (['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(tool)) return 'edit'
  if (['Grep', 'Glob', 'LS'].includes(tool)) return 'search'
  if (['WebSearch', 'WebFetch'].includes(tool)) return 'web'
  if (['Task', 'Agent'].includes(tool)) return 'agent'
  return 'other'
}

/** A directory without its trailing slash; nothing for one that cannot shorten a path (`/`, `~`). */
function dir(path: string | undefined): string | undefined {
  const bare = path?.replace(/\/+$/, '')
  return bare && bare.startsWith('/') ? bare : undefined
}

/** A path relative to the session's folder, else under `~`, else as given. */
export function shortPath(path: string, place: Place): string {
  const cwd = dir(place.cwd)
  const home = dir(place.home)
  if (cwd) {
    if (path === cwd) return '.'
    if (path.startsWith(cwd + '/')) return path.slice(cwd.length + 1)
  }
  if (home) {
    if (path === home) return '~'
    if (path.startsWith(home + '/')) return '~' + path.slice(home.length)
  }
  return path
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Every absolute path in a command said short, as shortPath says one. */
function shortPaths(text: string, place: Place): string {
  let out = text
  const cwd = dir(place.cwd)
  const home = dir(place.home)
  if (cwd) out = out.replace(new RegExp(escape(cwd) + '(/|(?![\\w.-]))', 'g'), (_m, slash: string) => slash ? '' : '.')
  if (home) out = out.replace(new RegExp(escape(home) + '(?=/|(?![\\w.-]))', 'g'), '~')
  return out
}

/** A `cd <dir> &&` (or `;`, or a line of its own) at the head of a command: it says nothing about what it does. */
const CD = /^\s*cd\s+(?:"[^"]*"|'[^']*'|[^\s;&|]+)\s*(?:&&|;|\n)\s*/

/** A command as a line: without the `cd` it opens with, its first line only, its paths short. */
export function commandLine(command: string, place: Place = {}): string {
  let rest = command
  for (let i = 0; i < 3 && CD.test(rest); i++) rest = rest.replace(CD, '')
  const first = rest.split('\n').find(line => line.trim()) ?? ''
  return shortPaths(first.trim(), place)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : JSON.stringify(value)
}

function firstLine(value: string): string {
  return (value.split('\n').find(line => line.trim()) ?? '').trim()
}

/**
 * A tool call's input in one line: a command's own description when it gave one, else the command;
 * a file's path; a search's pattern (and where). Paths short, multi-line input its first line.
 */
export function toolDetail(tool: string, input: Readonly<Record<string, unknown>>, place: Place = {}): string {
  if (tool === 'Bash') {
    const description = firstLine(text(input.description))
    if (description) return description
    return commandLine(text(input.command), place)
  }
  if (tool === 'Grep' || tool === 'Glob') {
    const where = text(input.path)
    return [firstLine(text(input.pattern)), where ? shortPath(where, place) : ''].filter(Boolean).join(' · ')
  }
  const path = text(input.file_path ?? input.notebook_path ?? input.path)
  if (path) return shortPath(firstLine(path), place)
  const detail = input.command ?? input.pattern ?? input.query ?? input.url ?? input.description ?? input.prompt ?? ''
  return shortPaths(firstLine(text(detail)), place)
}

/** A text's lines, a newline that ends it closing the last rather than opening another. */
function linesOfText(value: unknown): string[] {
  const body = typeof value === 'string' ? value : ''
  if (!body) return []
  const lines = body.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

/**
 * Lines `after` adds and `before` loses, as the phone app's diff counts them: walk both, and where
 * they part, skip to the nearest line they share again (fewest lines skipped on both sides).
 */
function changed(before: unknown, after: unknown): { added: number; removed: number } {
  const a = linesOfText(before)
  const b = linesOfText(after)
  const where = new Map<string, number[]>()
  b.forEach((line, at) => { const list = where.get(line); if (list) list.push(at); else where.set(line, [at]) })
  let i = 0
  let j = 0
  let added = 0
  let removed = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue }
    let best: { i: number; j: number; skip: number } | undefined
    for (let k = i; k < a.length; k++) {
      if (best && k - i > best.skip) break
      const list = where.get(a[k]!)
      if (!list) continue
      // The first place at or past j: a repeated line may occur thousands of times.
      let lo = 0
      let hi = list.length
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (list[mid]! < j) lo = mid + 1; else hi = mid }
      const next = list[lo]
      if (next === undefined) continue
      const skip = k - i + next - j
      if (!best || skip < best.skip) best = { i: k, j: next, skip }
    }
    if (!best) break
    removed += best.i - i
    added += best.j - j
    i = best.i
    j = best.j
  }
  return { added: added + b.length - j, removed: removed + a.length - i }
}

/**
 * Lines an edit adds and removes, from what the model sent it (a subagent's transcript keeps no
 * result to read a patch from): an Edit's old and new text, a MultiEdit's every pair, a Write's
 * whole content as added. Nothing for any other tool.
 */
export function editLines(tool: string, input: Readonly<Record<string, unknown>>): { added: number; removed: number } | undefined {
  if (tool === 'Edit') return changed(input.old_string, input.new_string)
  if (tool === 'Write') return { added: linesOfText(input.content).length, removed: 0 }
  if (tool === 'MultiEdit' && Array.isArray(input.edits)) {
    let added = 0
    let removed = 0
    for (const edit of input.edits) {
      if (!edit || typeof edit !== 'object') continue
      const one = changed((edit as Record<string, unknown>).old_string, (edit as Record<string, unknown>).new_string)
      added += one.added
      removed += one.removed
    }
    return { added, removed }
  }
  return undefined
}

/** The lines a run's answered edits added and removed; nothing when it changed none. */
export function runDiff(run: readonly ToolCall[]): { added: number; removed: number } | undefined {
  let added = 0
  let removed = 0
  for (const call of run) {
    if (call.state !== 'ok') continue
    added += call.added ?? 0
    removed += call.removed ?? 0
  }
  return added || removed ? { added, removed } : undefined
}

/** A run's head in one line, and how many of its calls failed. */
export function runSummary(run: readonly ToolCall[], lang: Lang): { text: string; failed: number } {
  const counts = new Map<Activity, number>()
  const files = new Set<string>()
  for (const call of run) {
    const kind = activityOf(call.tool)
    const file = (kind === 'read' || kind === 'edit') && call.detail ? kind + ':' + call.detail : ''
    if (!file || !files.has(file)) counts.set(kind, (counts.get(kind) ?? 0) + 1)
    if (file) files.add(file)
  }
  const word = (key: string, count: number) => t(lang, 'agents.act.' + key + (count === 1 ? 'One' : ''), { count })
  const parts = [...counts]
  const shown = parts.length >= 5 ? parts.slice(0, 3) : parts
  const rest = parts.slice(shown.length).reduce((sum, [, n]) => sum + n, 0)
  return {
    text: [...shown.map(([kind, n]) => word(kind, n)), ...(rest ? [word('more', rest)] : [])].join(', '),
    failed: run.filter(call => call.state === 'error').length,
  }
}
