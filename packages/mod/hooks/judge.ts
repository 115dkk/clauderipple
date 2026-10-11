import type { Domain, Effort, JudgeInput, Level, Pick, Settings, Verdict, WorkerVerdict } from '../types'
import { DOMAINS, LEVELS } from './settings.ts'
import { t } from './i18n.ts'
import type { Lang } from './i18n.ts'

const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

export const EFFORT_JUDGE_SYSTEM = `Choose the cheapest reasoning effort that can do this work well. This is a coding agent able to inspect files, run commands, and edit code, not merely answer a chat question.
Assess work volume, uncertainty, and the cost of mistakes, not message length. A short choice approving a build inherits the size of that build. Corrections and steering retain at least the running effort; closing remarks need little effort. "Think hard" or thorough reasoning requires at least high; an explicit quick answer calls for low.
Use low for simple direct tasks, medium for ordinary bounded work, high for substantial debugging or multi-step changes, xhigh for unusually difficult investigation, and max only for the hardest open-ended problems. Consider the current model's strength.
Return only JSON {"effort":"low|medium|high|xhigh|max","sure":0.0,"why":"short reason"}. Confidence is between zero and one. The reason uses the user's language and at most six words.`

/** A terse continuation usually carries no new scope; answers to questions are handled separately. */
export function isShortFollowUp(text: string): boolean {
  const trimmed = text.trim()
  return trimmed.length > 0 && trimmed.length <= 12 && trimmed.split(/\s+/).length <= 2
}

export function looksLikeQuestion(assistantTail: string): boolean {
  return assistantTail.slice(-400).includes('?')
}

/** The caller resolves slash commands so skills can be judged while host commands stay untouched. */
export function shouldJudge(input: {
  text: string; origin: string; auto: boolean; hostCommand?: boolean; modelId?: string
  attachments?: readonly { type: string }[]; current?: Pick | null; assistantTail?: string
}): boolean {
  if (!input.auto || !['composer', 'bridge', 'sdk'].includes(input.origin) || (!input.text.trim() && !input.attachments?.length) || input.hostCommand) return false
  if (input.modelId !== undefined && !isCacheSafeModel(input.modelId)) return false
  const followup = input.current && input.current.by !== 'manual' && !input.text.trim().startsWith('/') &&
    !input.attachments?.length && isShortFollowUp(input.text) && !looksLikeQuestion(input.assistantTail ?? '')
  return !followup
}

function recent(input: JudgeInput): string {
  const user = input.messages.findLast(message => message.role === 'user' && message.text.trim())
  const assistant = input.messages.findLast(message => message.role === 'assistant' && message.text.trim())
  return [user && `user: ${user.text.slice(0, 400)}`, assistant && `assistant: ${assistant.text.slice(-2000)}`].filter(Boolean).join('\n')
}

function nextText(input: JudgeInput, limit: number): string {
  const counts: Record<string, number> = {}
  for (const attachment of input.attachments ?? []) counts[attachment.type] = (counts[attachment.type] ?? 0) + 1
  const attachments = Object.entries(counts).map(([type, count]) => `${type}: ${count}`).join(', ')
  return [input.next.slice(0, limit), attachments && `Attachments (${attachments}).`,
    input.midTurn && 'Steering a running turn: keep its effort for corrections and additions.'].filter(Boolean).join('\n')
}

/** Keep options in the assistant tail, since a one-letter answer may approve substantial work. */
export function judgeContext(input: JudgeInput): string {
  return [
    `Current: ${input.current?.model ?? 'unknown'} / ${input.current?.effort ?? 'medium'}`,
    recent(input) && `Recent conversation:\n${recent(input)}`,
    input.contextPercent !== undefined && Number.isFinite(input.contextPercent) && `Context: ${Math.round(input.contextPercent)}%`,
    `Next message:\n${nextText(input, 2000)}`,
  ].filter(Boolean).join('\n\n')
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function confidence(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined
}

function effort(value: unknown): Effort | undefined {
  return EFFORTS.includes(value as Effort) ? value as Effort : undefined
}

/** JSON is a boundary: prose and fences are harmless, malformed objects are not verdicts. */
export function parseEffortVerdict(text: string): Verdict | undefined {
  const value = verdictObject(text)
  const level = effort(value?.effort)
  if (!level) return undefined
  const sure = confidence(value?.sure)
  return { effort: level, ...(sure !== undefined ? { sure } : {}), why: typeof value?.why === 'string' ? value.why.slice(0, 60) : '' }
}

/** Shared boundary decoder keeps effort and worker fields on the same object. */
export function verdictObject(text: string): Record<string, unknown> | undefined {
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    for (let end = text.lastIndexOf('}'); end > start; end = text.lastIndexOf('}', end - 1)) {
      try {
        const value: unknown = JSON.parse(text.slice(start, end + 1))
        const parsed = record(value)
        if (parsed) return parsed
      } catch {
        // Try a smaller span: a judge can put braces in its surrounding prose.
      }
    }
  }
  return undefined
}

const effortCriteria = {
  low: 'Small direct work with little uncertainty or planning.',
  medium: 'Ordinary bounded coding with a few inspections or edits.',
  high: 'Substantial multi-step coding or debugging where mistakes matter.',
  xhigh: 'Difficult extended investigation with interacting constraints.',
  max: 'Exceptional open-ended research or the hardest reasoning problems.',
}
const levelCriteria = {
  light: 'Mechanical chores, repeated changes, or simple lookups.',
  standard: 'Implement a designed change, research, summarize documentation, or review.',
  deep: 'Careful high-stakes reasoning, subtle debugging, architecture, or security.',
}
const domainCriteria: Record<Domain, string> = {
  design: 'Visual composition, branding, taste, look and voice of copy.',
  frontend: 'Frontend UI implementation, components, styles and interactions.',
  backend: 'Server application logic, APIs and authentication.', infra: 'Infrastructure, deployment, networks and operations.',
  data: 'Data processing, schemas, queries and analysis.', test: 'Tests, quality assurance and verification.',
  docs: 'Documentation, technical writing and summaries.', research: 'Investigation and research.', general: 'Other or cross-domain work.',
}

function jevBody(input: JudgeInput, task: string) {
  return {
    model: 'jev-latest' as const,
    state: { task, current_model: input.current?.model ?? null, current_effort: input.current?.effort ?? null,
      recent_conversation: recent(input), next_message: nextText(input, 4000) },
    questions: { effort: { type: 'choice' as const, instructions: 'Select the effort needed for this work.', criteria: { ...effortCriteria } } },
  }
}

export function jevEffortRequest(input: JudgeInput) {
  return jevBody(input, EFFORT_JUDGE_SYSTEM)
}

/** Capability and kind of work are independent; the judge never chooses a provider. */
export function jevWorkerRequest(input: { description: string; prompt: string }) {
  const body = jevBody({ messages: [], next: `${input.description}\n${input.prompt.slice(0, 3000)}` }, 'Choose the domain, capability level and reasoning effort for a delegated coding task. Judge scope and risk independently of the domain.')
  return { ...body, questions: { ...body.questions,
    domain: { type: 'choice' as const, instructions: 'Select the domain of this task.', criteria: { ...domainCriteria } },
    level: { type: 'choice' as const, instructions: 'Select the capability level needed.', criteria: { ...levelCriteria } },
  } }
}

function answers(json: unknown): Record<string, unknown> | undefined {
  const root = record(json)
  return record(root?.answers) ?? record(record(root?.result)?.answers)
}

function answerSure(answer: Record<string, unknown>): number | undefined {
  return confidence(answer.confidence ?? record(answer.probabilities)?.[String(answer.choice)])
}

/** Torn between levels, Jev leaves a session at the effort it runs when that effort is still a plausible answer. */
export function parseJevEffort(json: unknown, current?: { effort: Effort } | null, lang: Lang = 'en'): Verdict | undefined {
  const answer = record(answers(json)?.effort)
  const level = effort(answer?.choice)
  if (!answer || !level) return undefined
  const sure = answerSure(answer)
  const odds = record(answer.probabilities)
  const plausible = current && (!odds || (confidence(odds[current.effort]) ?? 0) >= 0.25)
  if (sure !== undefined && sure < 0.5 && current && current.effort !== level && plausible) return { effort: current.effort, sure, why: t(lang, 'judge.keptUnsure') }
  return { effort: level, ...(sure !== undefined ? { sure } : {}), why: '' }
}

export function parseJevWorker(json: unknown): WorkerVerdict | undefined {
  const reply = answers(json)
  const domainAnswer = record(reply?.domain)
  const levelAnswer = record(reply?.level)
  const effortAnswer = record(reply?.effort)
  const selectedEffort = effort(effortAnswer?.choice)
  if (!domainAnswer || !DOMAINS.includes(domainAnswer.choice as Domain) || !levelAnswer || !LEVELS.includes(levelAnswer.choice as Level) || !effortAnswer || !selectedEffort) return undefined
  const scores = [answerSure(domainAnswer), answerSure(levelAnswer), answerSure(effortAnswer)].filter((score): score is number => score !== undefined)
  return { domain: domainAnswer.choice as Domain, level: levelAnswer.choice as Level, effort: selectedEffort, ...(scores.length ? { sure: Math.min(...scores) } : {}), why: '' }
}

export function jevUsage(json: unknown): number {
  const usage = record(record(json)?.usage)
  return [usage?.input_tokens, usage?.output_tokens].reduce<number>((sum, count) => sum + (typeof count === 'number' && Number.isFinite(count) && count >= 0 ? count : 0), 0)
}

export function jevFailure(status: number | 'timeout' | 'network', lang: Lang = 'en'): string {
  if (status === 401 || status === 403) return t(lang, 'toasts.jevRejected')
  if (status === 402) return t(lang, 'toasts.jevCredits')
  if (status === 429) return t(lang, 'toasts.jevRateLimited')
  if (status === 'timeout') return t(lang, 'toasts.jevTimeout')
  if (status === 'network') return t(lang, 'toasts.jevNetwork')
  return t(lang, 'toasts.jevHttp', { status })
}

export function parseJevKey(fileText: string): string | undefined {
  const value = /^[ \t]*TYPESAFE_API_KEY[ \t]*=[ \t]*([^\r\n]*)/m.exec(fileText)?.[1]?.trim()
  if (!value) return undefined
  const unquoted = ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) ? value.slice(1, -1).trim() : value
  return unquoted || undefined
}

export function tipped(level: Effort, sure: number | undefined, bias: Settings['bias']): Effort {
  if (!bias || sure === undefined || !Number.isFinite(sure) || sure < 0 || sure >= (Math.abs(bias) === 2 ? 0.85 : 0.65)) return level
  return EFFORTS[Math.max(0, Math.min(4, EFFORTS.indexOf(level) + Math.sign(bias)))]!
}

export function bounded(level: Effort, floor: Effort, ceiling: Effort): Effort {
  const min = EFFORTS.indexOf(floor)
  const max = Math.max(min, EFFORTS.indexOf(ceiling))
  return EFFORTS[Math.max(min, Math.min(max, EFFORTS.indexOf(level)))]!
}

export function capped(level: Effort, saving: boolean): Effort {
  return saving && EFFORTS.indexOf(level) > 1 ? 'medium' : level
}

/** Save is last, so even a high floor cannot defeat the subscription-saving cap. */
export function finalEffort(verdict: Verdict, settings: Settings, saving: boolean, lang: Lang = 'en'): { effort: Effort; why: string } {
  const adjusted = bounded(tipped(verdict.effort, verdict.sure, settings.bias), settings.floor, settings.ceiling)
  const result = capped(adjusted, saving)
  return { effort: result, why: result !== adjusted ? t(lang, 'toasts.saveMode') : adjusted !== verdict.effort ? t(lang, 'toasts.yourSettings') : verdict.why }
}

export function isCacheSafeModel(modelId: string): boolean {
  return /(?:opus|sonnet|haiku)-5-5(?:$|[^\d])/.test(modelId)
}
