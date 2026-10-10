// Engine wiring lives here: imported logic and drawings never receive the engine interface.
// Timers own background work; hooks only admit/rewrite a request and record its result.
import { atom, read, update } from 'claude-code'
import type { AgentSpawnInput, EngineInterface, ModelCompleteResult, ModelForkResult, Register, RenderElement, RenderInput, ToolCallInput, TurnStepInput, TurnUsage } from 'claude-code'
import type { AgentRec, Effort, JudgeInput, JudgeKind, Pick, Settings, StatusRequest, TierTarget, Verdict, WorkerPick, WorkerVerdict } from '../types'
import { DOMAINS, normalizeSettings } from './settings'
import { debugText, langFrom, t } from './i18n'
import type { Lang } from './i18n'
import { EFFORT_JUDGE_SYSTEM, finalEffort, isCacheSafeModel, isShortFollowUp, jevEffortRequest, jevFailure, jevUsage, jevWorkerRequest, judgeContext, parseEffortVerdict, parseJevEffort, parseJevKey, parseJevWorker, shouldJudge } from './judge'
import { WORKER_JUDGE_SYSTEM, agentProvider, candidateUsable, chatgptUsable, parseWorkerVerdict, readMarker, resolvedRule, resolveWorker, routerModelOptions, scoreModels, spawnModel, takesOver, workerCandidates, workerJudgeInput, zenJev } from './workers'
import { MARKER, agentModel, fixSpawn } from './worker'
import type { Spawn, WorkerFix } from './worker'
import { afterPing, nextMemo, restoreFromResume, shouldPing } from './cache'
import { bandPriority, coldAlert, hotAlert, hottest, saveUntil as limitSaveUntil, swampAlert, swamped } from './session'
import { COMPACT_SYSTEM, compactResult, serializeTranscript } from './compact'
import { ADVICE_SYSTEM, FULL_PROMPT, QUICK_PROMPT, adviceDue, adviceInput, parseAdvice, wrapForNewChat } from './handoff'
import { addJudge, addPrompt, addRequest, addWarm, addWorker, emptyStats, formatStats, weighted } from './stats'
import { renderBand, renderFooter } from './ui/band'
import { renderAlert } from './ui/alerts'
import { renderSettings } from './ui/settings'
import { renderSetup } from './ui/setup'
import { renderAgents } from './ui/agents'
import { renderLog } from './ui/log'
import { EFFORTS, countdown, modelName, routeOf, targetLabel, targetValue } from './ui/view'
import type { AlertActions, AlertView, BandActions, DashboardView, Frame, SettingsActions, SettingsView, SetupActions } from './ui/view'

const line = atom({ plugin: 'ripple', key: 'line' } as const, null)
const last = atom({ plugin: 'ripple', key: 'last' } as const, null)
const requests = atom({ plugin: 'ripple', key: 'requests' } as const, [])
const logOpen = atom({ plugin: 'ripple', key: 'logOpen' } as const, false)
const onlySession = atom({ plugin: 'ripple', key: 'onlySession' } as const, false)
const bandHidden = atom({ plugin: 'ripple', key: 'bandHidden' } as const, false)
const settings = atom({ plugin: 'ripple', key: 'settings' } as const, null)
const lang = atom({ plugin: 'ripple', key: 'lang' } as const, 'en')
const pick = atom({ plugin: 'ripple', key: 'pick' } as const, null)
const deciding = atom({ plugin: 'ripple', key: 'deciding' } as const, false)
const decidingSince = atom({ plugin: 'ripple', key: 'decidingSince' } as const, null)
const paused = atom({ plugin: 'ripple', key: 'paused' } as const, false)
const heldPick = atom({ plugin: 'ripple', key: 'heldPick' } as const, null)
const appEffort = atom({ plugin: 'ripple', key: 'appEffort' } as const, null)
const modelIs = atom({ plugin: 'ripple', key: 'modelIs' } as const, null)
const lastRequest = atom({ plugin: 'ripple', key: 'lastRequest' } as const, null)
const lastSpawn = atom({ plugin: 'ripple', key: 'lastSpawn' } as const, null)
const agents = atom({ plugin: 'ripple', key: 'agents' } as const, [])
const cache = atom({ plugin: 'ripple', key: 'cache' } as const, null)
const warm = atom({ plugin: 'ripple', key: 'warm' } as const, { pings: 0, cost: 0 })
const lastRealReplyAt = atom({ plugin: 'ripple', key: 'lastRealReplyAt' } as const, null)
const context = atom({ plugin: 'ripple', key: 'context' } as const, null)
const hot = atom({ plugin: 'ripple', key: 'hot' } as const, null)
const limit = atom({ plugin: 'ripple', key: 'limit' } as const, null)
const hotHidden = atom({ plugin: 'ripple', key: 'hotHidden' } as const, null)
const saveUntil = atom({ plugin: 'ripple', key: 'saveUntil' } as const, null)
const swampHidden = atom({ plugin: 'ripple', key: 'swampHidden' } as const, null)
const coldHidden = atom({ plugin: 'ripple', key: 'coldHidden' } as const, false)
const judgeDown = atom({ plugin: 'ripple', key: 'judgeDown' } as const, null)
const judgeDownHidden = atom({ plugin: 'ripple', key: 'judgeDownHidden' } as const, null)
const advice = atom({ plugin: 'ripple', key: 'advice' } as const, null)
const adviceQueue = atom({ plugin: 'ripple', key: 'adviceQueue' } as const, null)
const promptCount = atom({ plugin: 'ripple', key: 'promptCount' } as const, 0)
const handoff = atom({ plugin: 'ripple', key: 'handoff' } as const, null)
const handoffQueued = atom({ plugin: 'ripple', key: 'handoffQueued' } as const, false)
const handoffWaiting = atom({ plugin: 'ripple', key: 'handoffWaiting' } as const, false)
const handoffChoiceKind = atom({ plugin: 'ripple', key: 'handoffChoiceKind' } as const, 'quick')
const handoffChoiceAfter = atom({ plugin: 'ripple', key: 'handoffChoiceAfter' } as const, 'continue')
const resultCard = atom({ plugin: 'ripple', key: 'result' } as const, null)
const panel = atom({ plugin: 'ripple', key: 'panel' } as const, null)
const busy = atom({ plugin: 'ripple', key: 'busy' } as const, false)
const stats = atom({ plugin: 'ripple', key: 'stats' } as const, emptyStats())
const settingsDraft = atom({ plugin: 'ripple', key: 'settingsDraft' } as const, null)
const settingsTab = atom({ plugin: 'ripple', key: 'settingsTab' } as const, 'effort')
const setupStep = atom({ plugin: 'ripple', key: 'setupStep' } as const, 1)
const compactNote = atom({ plugin: 'ripple', key: 'compactNote' } as const, '')
const effortMenuOpen = atom({ plugin: 'ripple', key: 'effortMenuOpen' } as const, false)
const agentsOpen = atom({ plugin: 'ripple', key: 'agentsOpen' } as const, false)
const agentsShowDone = atom({ plugin: 'ripple', key: 'agentsShowDone' } as const, false)
const jev = atom({ plugin: 'ripple', key: 'jev' } as const, { source: null, test: { state: 'idle' } })
const agentOptions = atom({ plugin: 'ripple', key: 'agentOptions' } as const, [])
const routerModels = atom({ plugin: 'ripple', key: 'routerModels' } as const, [])
const modelScores = atom({ plugin: 'ripple', key: 'modelScores' } as const, null)
const workerUi = atom({ plugin: 'ripple', key: 'workerUi' } as const, { section: 'general', page: 0 })
const skills = atom({ plugin: 'ripple', key: 'skills' } as const, [])
const demo = atom({ plugin: 'ripple', key: 'demo' } as const, null)

const LOG_PANE = 'ripple-log'
const AGENTS_PANE = 'ripple-agents'
const HAIKU = 'claude-haiku-5-5'
const EXECUTOR = 'Do the assigned task yourself. Inspect the relevant files, implement what was asked, and verify the result. Report the outcome concisely, citing evidence and marking uncertainty. Never delegate to another agent. Do not create unrequested files or commit unless explicitly asked.'
let timersStarted = false
let polling = false
let ticking = false
let forking = false
let forkUsage: TurnUsage | null = null
let cacheBoundary: string | undefined
let judgeSequence = 0
let generation = 0
let carriedPick = false

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}
function effortOf(value: unknown): Effort | undefined {
  return typeof value === 'string' && EFFORTS.includes(value as Effort) ? value as Effort : undefined
}
function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
async function report($: EngineInterface, where: string, error: unknown): Promise<void> {
  await $.ui.log(t(await read($, lang), 'commands.debugLog', { where, reason: reason(error) }), { to: 'debug' })
}
async function userHome($: EngineInterface): Promise<string> {
  return (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '~'
}
async function rippleHome($: EngineInterface): Promise<string> {
  return (await $.env.get('CLAUDERIPPLE_HOME')) ?? `${await userHome($)}/.clauderipple`
}
async function claudeHome($: EngineInterface): Promise<string> {
  return (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${await userHome($)}/.claude`
}
async function optionalFile($: EngineInterface, path: string): Promise<string | undefined> {
  try { return await $.fs.read(path) }
  catch (error) { await report($, 'optional file', error); return undefined }
}
async function adminUrl($: EngineInterface): Promise<string> {
  const text = await optionalFile($, `${await rippleHome($)}/config.json`)
  if (!text) return 'http://127.0.0.1:8792'
  const config = object(JSON.parse(text))
  const admin = object(config.admin).port
  const listen = object(config.listen).port
  const port = typeof admin === 'number' ? admin : (typeof listen === 'number' ? listen : 8791) + 1
  return `http://127.0.0.1:${port}`
}
async function currentSettings($: EngineInterface): Promise<Settings> {
  return normalizeSettings(await read($, settings))
}
async function resolveLanguage($: EngineInterface, s: Settings): Promise<Lang> {
  if (s.language !== 'auto') return s.language
  try {
    const value = (await $.settings.read()).language
    const host = langFrom(typeof value === 'string' ? value : undefined)
    if (host) return host
  } catch (error) { await report($, 'language settings', error) }
  // On a Mac the system language comes before LANG: a session the desktop app starts can carry
  // LANG=en_US on a Korean Mac (seen 2026-10-10: Korean headless, English in the Code tab).
  // The engine exposes no platform noun. Avoid running macOS defaults elsewhere.
  if (await $.env.get('OS') !== 'Windows_NT') {
    try {
      const platform = await $.process.run(['uname', '-s'], { timeoutMs: 2000 })
      if (platform.exitCode === 0 && platform.stdout.trim() === 'Darwin') {
        const apple = await $.process.run(['defaults', 'read', '-g', 'AppleLocale'], { timeoutMs: 2000 })
        const mac = apple.exitCode === 0 ? langFrom(apple.stdout) : undefined
        if (mac) return mac
        if (apple.exitCode !== 0) await report($, 'language locale', apple.stderr)
      }
    } catch (error) { await report($, 'language locale', error) }
  }
  return langFrom(await $.env.get('LANG')) ?? langFrom(await $.env.get('LC_ALL')) ?? 'en'
}
async function registerAuto($: EngineInterface, s: Settings): Promise<void> {
  if (s.agentAuto === 'off') return
  await $.agent.register({ name: 'auto', description: 'Delegate any task here; ClaudeRipple picks the model and reasoning effort for it.', prompt: EXECUTOR, disallowedTools: ['Agent'] })
}
async function loadSettings($: EngineInterface): Promise<void> {
  const s = normalizeSettings(await $.store.get('settings'))
  if ((await $.store.get('setupDone')) === true) s.setupDone = true
  await update($, settings, () => s)
  const resolved = await resolveLanguage($, s)
  await update($, lang, () => resolved)
  const hidden = (await $.store.get('bandHidden')) === true
  await update($, bandHidden, () => hidden)
  if (!(await read($, pick))) {
    const carried = object(await $.store.get('pick'))
    const level = effortOf(carried.effort)
    if (level && ['haiku', 'jev', 'model', 'manual', 'followup'].includes(String(carried.by))) {
      carriedPick = true
      await update($, pick, () => ({ effort: level, why: typeof carried.why === 'string' ? carried.why : '', by: carried.by as Pick['by'], at: typeof carried.at === 'number' ? carried.at : 0 }))
    }
  }
  await registerAuto($, s)
}
async function saveSettings($: EngineInterface, s: Settings): Promise<void> {
  const previous = await currentSettings($)
  const normalized = normalizeSettings(s)
  await $.store.set('settings', normalized)
  await update($, settings, () => normalized)
  const resolved = await resolveLanguage($, normalized)
  await update($, lang, () => resolved)
  await registerAuto($, normalized)
  if (!normalized.effortAuto) await update($, heldPick, () => null)
  if (normalized.keepWarm && !previous.keepWarm) await update($, warm, value => ({ ...value, stopped: undefined }))
}
async function installPick($: EngineInterface, value: Pick): Promise<void> {
  carriedPick = false
  await update($, pick, () => value)
  await $.store.set('pick', value)
}

// The engine's pane list is authoritative: a reload can close panes without sending ui.close.
async function isLogUp($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes()).some(p => p.id === LOG_PANE)
}
async function syncPanes($: EngineInterface): Promise<void> {
  const panes = await $.ui.panes()
  const log = panes.some(p => p.id === LOG_PANE)
  const agent = panes.some(p => p.id === AGENTS_PANE)
  if (log !== await read($, logOpen)) await update($, logOpen, () => log)
  if (agent !== await read($, agentsOpen)) await update($, agentsOpen, () => agent)
}
async function toggleLog($: EngineInterface): Promise<boolean> {
  const language = await read($, lang)
  const open = await isLogUp($)
  if (open) await $.ui.close({ id: LOG_PANE })
  else await $.ui.open({ id: LOG_PANE, title: t(language, 'commands.logTitle') })
  await syncPanes($)
  if (!open) await refreshRouter($)
  return !open
}
async function toggleAgents($: EngineInterface): Promise<void> {
  const language = await read($, lang)
  const open = (await $.ui.panes()).some(p => p.id === AGENTS_PANE)
  if (open) await $.ui.close({ id: AGENTS_PANE })
  else await $.ui.open({ id: AGENTS_PANE, title: t(language, 'commands.agentsTitle') })
  await syncPanes($)
}
async function toggleBar($: EngineInterface): Promise<boolean> {
  const hidden = !await read($, bandHidden)
  await $.store.set('bandHidden', hidden)
  await update($, bandHidden, () => hidden)
  return !hidden
}
async function refreshRouter($: EngineInterface): Promise<void> {
  const language = await read($, lang)
  if (polling) return
  polling = true
  try {
    await syncPanes($)
    const open = await isLogUp($)
    if (!open && await read($, bandHidden)) return
    const session = await $.session.id()
    const admin = await adminUrl($)
    const own = await $.http.fetch(`${admin}/api/requests?kind=messages&n=${open ? 60 : 1}&session=${encodeURIComponent(session)}`)
    if (!own.ok) throw new Error(t(language, 'commands.routerHttp', { status: own.status }))
    const mine = (object(JSON.parse(own.text)).requests ?? []) as StatusRequest[]
    const newest = mine[0] ?? null
    const notice = newest && newest.session === undefined ? t(language, 'band.routerRestart') : null
    if (notice !== await read($, line)) await update($, line, () => notice)
    // Do not show a route belonging to another chat from a router without session support.
    const route = notice ? null : newest
    if (JSON.stringify(route) !== JSON.stringify(await read($, last))) await update($, last, () => route)
    if (!open) return
    let shown = mine
    if (!await read($, onlySession)) {
      const all = await $.http.fetch(`${admin}/api/requests?kind=messages&n=60`)
      if (!all.ok) throw new Error(t(language, 'commands.routerHttp', { status: all.status }))
      shown = (object(JSON.parse(all.text)).requests ?? []) as StatusRequest[]
    }
    const rows = shown.map(record => ({ ...record, mine: record.session === session }))
    if (JSON.stringify(rows) !== JSON.stringify(await read($, requests))) await update($, requests, () => rows)
  } catch (error) {
    if (await read($, line) !== t(language, 'band.routerDown')) await update($, line, () => t(language, 'band.routerDown'))
    await report($, 'router poll', error)
  } finally { polling = false }
}

// Files and availability are sampled at spawn, not cached across quota/account changes.
async function workerFiles($: EngineInterface): Promise<Map<string, string>> {
  const text = await optionalFile($, `${await rippleHome($)}/generated-agents.json`)
  const names = text ? strings(object(JSON.parse(text)).agents) : []
  const files = new Map<string, string>()
  for (const name of names) {
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) continue
    const file = await optionalFile($, `${await claudeHome($)}/agents/${name}.md`)
    if (file && agentModel(file)) files.set(name, file)
  }
  return files
}
async function workerFix($: EngineInterface, spawn: Spawn): Promise<WorkerFix | null> {
  const text = await optionalFile($, `${await rippleHome($)}/generated-agents.json`)
  if (!text || !strings(object(JSON.parse(text)).agents).includes(spawn.subagentType)) return null
  if (!/^[A-Za-z0-9_.-]+$/.test(spawn.subagentType)) return null
  const file = await optionalFile($, `${await claudeHome($)}/agents/${spawn.subagentType}.md`)
  const model = file ? agentModel(file) : undefined
  return model ? fixSpawn(spawn, model) : null
}
async function availability($: EngineInterface): Promise<boolean> {
  try {
    const status = await $.http.fetch(`${await adminUrl($)}/api/status`)
    return status.ok ? chatgptUsable(JSON.parse(status.text)) : true
  } catch (error) { await report($, 'availability unknown', error); return true }
}
async function choices($: EngineInterface): Promise<void> {
  const files = await workerFiles($)
  const s = await currentSettings($)
  const targets: TierTarget[] = [...files.keys()].map(agent => ({ agent }))
  targets.push(...['sonnet', 'opus', 'haiku'].map(model => ({ agent: 'general-purpose', model })), ...DOMAINS.flatMap(domain => { const r = s.rules[domain]; return r.mode === 'pin' ? Object.values(r.targets) : [] }), s.fallback)
  const unique = [...new Map(targets.map(t => [targetValue(t), t])).values()]
  await update($, agentOptions, () => unique.map(t => ({ value: targetValue(t), label: targetLabel(t), available: t.agent === 'general-purpose' || files.has(t.agent) })))
  await refreshModels($)
  const commands = await $.command.list()
  await update($, skills, () => commands.filter(c => c.source !== 'builtin' && !c.name.startsWith('ripple')).map(c => c.name))
  await jevKey($)
}

async function refreshModels($: EngineInterface): Promise<void> {
  const response = await $.http.fetch(`${await adminUrl($)}/api/config`)
  if (!response.ok) throw new Error(t(await read($, lang), 'commands.routerHttp', { status: response.status }))
  await update($, routerModels, () => routerModelOptions(JSON.parse(response.text)))
}
async function scores($: EngineInterface): Promise<import('../types').ModelScore[]> {
  const now = await $.clock.now()
  const cached = await read($, modelScores)
  if (cached && cached.until > now) return cached.models
  try {
    const response = await $.http.fetch(`${await adminUrl($)}/api/model-scores`)
    if (!response.ok) throw new Error(t(await read($, lang), 'commands.routerHttp', { status: response.status }))
    const models = scoreModels(JSON.parse(response.text))
    await update($, modelScores, () => ({ until: now + 600000, models }))
    return models
  } catch (error) {
    await report($, 'model scores', error)
    await update($, modelScores, () => ({ until: now + 600000, models: cached?.models ?? [] }))
    return cached?.models ?? []
  }
}
async function jevKey($: EngineInterface, jevSource?: Settings['jevSource']): Promise<string | undefined> {
  const selected = jevSource ?? normalizeSettings(await read($, settingsDraft) ?? await read($, settings)).jevSource
  if (selected === 'zen') {
    const file = await optionalFile($, `${await rippleHome($)}/config.json`)
    const key = file ? zenJev(JSON.parse(file)).authorization : undefined
    await update($, jev, value => ({ ...value, source: key ? 'zen' as const : null }))
    return key
  }
  const env = (await $.env.get('TYPESAFE_API_KEY'))?.trim()
  if (env) {
    if ((await read($, jev)).source !== 'env') await update($, jev, value => ({ ...value, source: 'env' as const }))
    return env
  }
  const file = await optionalFile($, `${await userHome($)}/.config/jev/.env`)
  const key = file ? parseJevKey(file) : undefined
  const source: 'pasted' | 'file' | null = key ? ((await read($, jev)).source === 'pasted' ? 'pasted' : 'file') : null
  if ((await read($, jev)).source !== source) await update($, jev, value => ({ ...value, source }))
  return key
}
async function saveJevKey($: EngineInterface, input: string): Promise<void> {
  const language = await read($, lang)
  const key = parseJevKey(input) ?? input.trim()
  if (!key || /[\r\n]/.test(key)) throw new Error(t(language, 'toasts.keySingle'))
  const path = `${await userHome($)}/.config/jev/.env`
  const old = await optionalFile($, path) ?? ''
  const entry = `TYPESAFE_API_KEY=${key}`
  const text = /^[ \t]*TYPESAFE_API_KEY[ \t]*=/m.test(old)
    ? old.replace(/^[ \t]*TYPESAFE_API_KEY[ \t]*=[^\r\n]*/gm, () => entry)
    : old + (old && !old.endsWith('\n') ? '\n' : '') + entry + '\n'
  await $.fs.write(path, text)
  const mode = await $.process.run(['chmod', '600', path])
  if (mode.exitCode !== 0) throw new Error(t(language, 'toasts.keyPrivateFailed'))
  await update($, jev, () => ({ source: 'pasted' as const, test: { state: 'idle' as const } }))
  await update($, judgeDown, () => null)
  await $.ui.toast(t(language, 'toasts.keySaved'))
}
async function down($: EngineInterface, message: string): Promise<void> {
  if (await read($, judgeDown) !== message) {
    await update($, judgeDown, () => message)
    await $.ui.toast(t(await read($, lang), 'toasts.judgeDown', { reason: message }))
  }
}

type Judged = { verdict: Verdict | WorkerVerdict | undefined; by: JudgeKind; ms: number; error?: string }
async function completeJudge($: EngineInterface, model: string, system: string, prompt: string): Promise<ModelCompleteResult> {
  return $.model.complete({ model, system, prompt, maxTokens: 160, timeoutMs: 6000, effort: 'low' })
}
async function judge($: EngineInterface, s: Settings, input: JudgeInput | { description: string; prompt: string }, worker: boolean, testing = false): Promise<Judged> {
  const language = await read($, lang)
  const started = await $.clock.now()
  const system = worker ? WORKER_JUDGE_SYSTEM : EFFORT_JUDGE_SYSTEM
  const prompt = 'description' in input ? workerJudgeInput(input) : judgeContext(input)
  let failure: string | undefined
  let by: JudgeKind = s.judge
  let verdict: Verdict | WorkerVerdict | undefined
  if (s.judge === 'jev') {
    try {
      const key = await jevKey($, s.jevSource)
      if (!key) throw new Error(t(language, s.jevSource === 'zen' ? 'jev.zenMissing' : 'toasts.keyMissing'))
      const body = 'description' in input ? jevWorkerRequest(input) : jevEffortRequest(input)
      let model = 'jev-latest'
      if (s.jevSource === 'zen') {
        const file = await optionalFile($, `${await rippleHome($)}/config.json`)
        model = file ? zenJev(JSON.parse(file)).model : model
      }
      const response = await Promise.race([
        $.http.fetch(s.jevSource === 'zen' ? 'https://opencode.ai/zen/v1/systemone' : 'https://api.typesafe.ai/v1/systemone', { method: 'POST', headers: { 'content-type': 'application/json', authorization: s.jevSource === 'zen' ? key : `Bearer ${key}` }, body: JSON.stringify({ ...body, model }) }),
        $.clock.sleep(3000).then(() => null),
      ])
      if (!response) throw new Error(jevFailure('timeout', language))
      if (!response.ok) throw new Error(jevFailure(response.status, language))
      const json: unknown = JSON.parse(response.text)
      verdict = worker ? parseJevWorker(json) : parseJevEffort(json)
      await update($, stats, value => addJudge(value, 'jev', 0, jevUsage(json)))
      if (!verdict || (verdict.sure !== undefined && verdict.sure < 0.5)) throw new Error(t(language, 'toasts.jevUnsure'))
    } catch (error) { failure = reason(error); verdict = undefined }
  }
  if (s.judge === 'model') {
    try {
      const answer = await completeJudge($, s.judgeModel, system, prompt)
      await update($, stats, value => addJudge(value, 'model', 0, answer.usage.input_tokens + answer.usage.output_tokens))
      verdict = answer.isAnswered ? (worker ? parseWorkerVerdict(answer.text) : parseEffortVerdict(answer.text)) : undefined
      if (!verdict) failure = t(language, 'toasts.routerNoVerdict')
    } catch (error) { failure = reason(error) }
  }
  if (!verdict) {
    by = 'haiku'
    try {
      let answer = await completeJudge($, HAIKU, system, prompt)
      await update($, stats, value => addJudge(value, 'haiku', 0, answer.usage.input_tokens + answer.usage.output_tokens))
      if (!answer.isAnswered) {
        answer = await completeJudge($, 'haiku', system, prompt)
        await update($, stats, value => addJudge(value, 'haiku', 0, answer.usage.input_tokens + answer.usage.output_tokens))
      }
      verdict = answer.isAnswered ? (worker ? parseWorkerVerdict(answer.text) : parseEffortVerdict(answer.text)) : undefined
      if (!verdict) failure ??= t(language, 'toasts.haikuNoVerdict')
    } catch (error) { failure ??= reason(error) }
  }
  const ms = Math.max(0, await $.clock.now() - started)
  await update($, stats, value => ({ ...value, judge: { ...value.judge, ms: value.judge.ms + ms } }))
  if (!testing) {
    if (failure) await down($, failure)
    else if (await read($, judgeDown)) await update($, judgeDown, () => null)
  }
  return { verdict, by, ms, ...(failure ? { error: failure } : {}) }
}
async function testJudge($: EngineInterface): Promise<void> {
  const language = await read($, lang)
  await update($, jev, value => ({ ...value, test: { state: 'testing' as const } }))
  try {
    const s = normalizeSettings(await read($, settingsDraft) ?? await read($, settings))
    const judged = await judge($, s, { messages: [], next: 'Rename a local variable in one function and verify the result.' }, false, true)
    const ok = !!judged.verdict && !judged.error
    await update($, jev, value => ({ ...value, test: { state: ok ? 'ok' as const : 'fail' as const, message: `${judged.ms} ms · ${judged.verdict?.effort ? t(language, 'band.' + judged.verdict.effort).toLowerCase() : t(language, 'toasts.noVerdict')} · ${judged.error ?? judged.by}` } }))
  } catch (error) {
    await update($, jev, value => ({ ...value, test: { state: 'fail' as const, message: reason(error) } }))
  }
}

async function requestPick($: EngineInterface, e: AgentSpawnInput, s: Settings): Promise<{ input: AgentSpawnInput; pick: WorkerPick } | { deny: string }> {
  const language = await read($, lang)
  const files = await workerFiles($)
  try { await refreshModels($) } catch (error) { await report($, 'worker catalogue', error) }
  const candidates = workerCandidates(files, await read($, routerModels))
  const pinnedCandidates = [...files].flatMap(([agent, file]) => { const model = agentModel(file)?.replace(/@[^@]*$/, ''); const provider = agentProvider(file); return model && provider ? [{ target: { agent }, model, provider }] : [] })
  const usable = await availability($)
  const marker = readMarker(e.prompt)
  const explicit = marker && !['auto', 'ripple'].includes(marker.name) ? marker : null
  let verdict: WorkerVerdict = { domain: 'general', level: 'standard', effort: 'high', why: t(language, 'toasts.judgeUnavailable') }
  let by: WorkerPick['by'] = 'default'
  let ms = 0
  let target: TierTarget | undefined
  if (explicit) {
    // Agent names and their file-model ids are both valid explicit routing notes.
    const name = files.has(explicit.name) ? explicit.name : [...files].find(([, f]) => agentModel(f)?.replace(/@[^@]*$/, '').toLowerCase() === explicit.name)?.[0]
    target = name ? { agent: name } : { agent: 'general-purpose', model: explicit.name }
    verdict = { domain: 'general', level: 'standard', effort: effortOf(explicit.level) ?? 'high', why: t(language, 'toasts.explicitMarker') }
    by = 'marker'
  } else {
    const judged = await judge($, s, { description: e.description, prompt: e.prompt }, true)
    if (judged.verdict && 'domain' in judged.verdict) { verdict = judged.verdict; by = judged.by }
    ms = judged.ms
  }
  const explicitCandidate = target ? pinnedCandidates.find(c => c.target.agent === target!.agent) ?? (target.agent === 'general-purpose' ? { target, model: target.model ?? 'sonnet', provider: (await read($, routerModels)).find(m => m.value.toLowerCase() === target!.model)?.provider ?? 'anthropic' } : undefined) : undefined
  if (explicitCandidate && s.providers[explicitCandidate.provider] === false) return { deny: t(language, 'workers.disabled', { provider: explicitCandidate.provider }) }
  const resolved = explicitCandidate && candidateUsable(explicitCandidate, s, usable)
    ? { target: target!, effort: verdict.effort }
    : resolveWorker(verdict, s, resolvedRule(verdict.domain, s).mode === 'auto' && !target ? candidates : pinnedCandidates, resolvedRule(verdict.domain, s).mode === 'auto' && !target ? await scores($) : [], usable, language, pinnedCandidates)
  const selected = resolved.target
  if (!selected) return { deny: t(language, 'workers.none') }
  const fallbackReason = resolved.fallbackReason
  verdict = { ...verdict, effort: resolved.effort }
  const model = spawnModel(selected, verdict.effort, files.has(selected.agent) ? agentModel(files.get(selected.agent)!) : undefined)
  let prompt = e.prompt
  if (marker) prompt = prompt.replace(MARKER, '').replace(/^\s*\n/, '')
  const value: WorkerPick = { ...verdict, ...resolved, target: selected, by, ms, ...(fallbackReason ? { fallbackReason } : {}) }
  if (fallbackReason) await $.ui.toast(t(language, 'toasts.workerFallback', { reason: fallbackReason, name: targetLabel(selected) }))
  await update($, lastSpawn, () => value)
  await update($, stats, current => addWorker(current, verdict.level))
  return { input: { ...e, subagentType: selected.agent, model, prompt }, pick: value }
}

async function toggleAuto($: EngineInterface): Promise<void> {
  const s = await currentSettings($)
  await saveSettings($, { ...s, effortAuto: !s.effortAuto })
}
async function toggleWarm($: EngineInterface): Promise<void> {
  const s = await currentSettings($)
  await saveSettings($, { ...s, keepWarm: !s.keepWarm })
}
async function toggleSave($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const active = (await read($, saveUntil) ?? 0) > now
  const until = active ? null : limitSaveUntil(await read($, hot), now)
  await update($, saveUntil, () => until)
}
async function manualPick($: EngineInterface, effort: Effort): Promise<void> {
  const language = await read($, lang)
  await saveSettings($, { ...await currentSettings($), effortAuto: false })
  await installPick($, { effort, by: 'manual', why: t(language, 'toasts.yourPick'), at: await $.clock.now() })
  const draft = await $.prompt.read()
  if (!draft.text.trim() || /^\/effort\s+\w+\s*$/.test(draft.text)) {
    await $.prompt.fill({ text: `/effort ${effort}`, mode: 'replace' })
    await $.ui.toast(t(language, 'toasts.effortEnter'))
  }
}
// A draft is cloned through normalization, never aliased to saved settings.
async function startPanel($: EngineInterface, which: 'settings' | 'setup'): Promise<void> {
  const s = await currentSettings($)
  await update($, settingsDraft, () => normalizeSettings(s))
  if (which === 'setup') await update($, setupStep, () => 1)
  await update($, panel, () => which)
  await choices($)
}
async function patchDraft($: EngineInterface, change: Partial<Settings>): Promise<void> {
  const current = normalizeSettings(await read($, settingsDraft) ?? await read($, settings))
  await update($, settingsDraft, () => normalizeSettings({ ...current, ...change }))
  if (change.jevSource) { await update($, jev, value => ({ ...value, test: { state: 'idle' as const } })); await jevKey($, change.jevSource) }
}
async function finishSettings($: EngineInterface, setup: boolean, skip = false): Promise<void> {
  const draft = normalizeSettings(skip ? await read($, settings) : await read($, settingsDraft))
  await saveSettings($, { ...draft, setupDone: setup || draft.setupDone })
  if (setup) await $.store.set('setupDone', true)
  await update($, panel, () => null)
  await update($, settingsDraft, () => null)
  await $.ui.toast(t(await read($, lang), 'toasts.settingsSaved'))
}
async function openHandoff($: EngineInterface): Promise<void> {
  const active = await read($, handoff)
  if (active && ['writing', 'clearing'].includes(active.stage)) return
  const choice = object(await $.store.get('handoffChoice'))
  await update($, handoffChoiceKind, () => choice.kind === 'full' ? 'full' : 'quick')
  const after = ['continue', 'confirm', 'copy'].includes(String(choice.after)) ? choice.after as Settings['handoffAfter'] : (await currentSettings($)).handoffAfter
  await update($, handoffChoiceAfter, () => after)
  await update($, panel, value => value === 'handoff' ? null : 'handoff')
}
async function queueHandoff($: EngineInterface, kind?: 'quick' | 'full'): Promise<void> {
  const active = await read($, handoff)
  if (active && ['writing', 'clearing'].includes(active.stage)) return
  const selected = kind ?? await read($, handoffChoiceKind)
  const after = kind ? (await currentSettings($)).handoffAfter : await read($, handoffChoiceAfter)
  await update($, handoffChoiceKind, () => selected)
  await update($, handoffChoiceAfter, () => after)
  await $.store.set('handoffChoice', { kind: selected, after })
  await update($, handoff, () => ({ stage: 'writing', kind: selected }))
  await update($, panel, () => null)
  await update($, advice, () => null)
  await update($, handoffQueued, () => true)
}
async function copyHandoff($: EngineInterface): Promise<void> {
  const language = await read($, lang)
  const value = await read($, handoff)
  if (!value?.text) return
  const text = wrapForNewChat(value.text, 'continue', value.kind, !!(await currentSettings($)).handoffSkill)
  try {
    const copied = await $.ui.copy({ text })
    if (!copied.isCopied) throw new Error(copied.reason)
  } catch (error) {
    await $.prompt.fill({ text, mode: 'replace' })
    await $.ui.toast(t(language, 'toasts.clipboardFallback'))
    await report($, 'copy fallback', error)
  }
  await update($, handoff, () => ({ ...value, stage: 'copied' }))
}
async function finishHandoff($: EngineInterface): Promise<void> {
  const value = await read($, handoff)
  if (!value?.text || value.stage !== 'writing') return
  const s = await currentSettings($)
  const after = await read($, handoffChoiceAfter)
  if (after === 'copy') { await copyHandoff($); return }
  const text = wrapForNewChat(value.text, after, value.kind, !!s.handoffSkill)
  await update($, handoff, () => ({ ...value, stage: 'clearing' }))
  await $.command.run({ command: 'clear', args: '' })
  // clear resets atoms; this timer owns the captured continuation and restores the result card.
  await update($, handoff, () => ({ ...value, stage: 'done' }))
  await $.prompt.submit({ text })
}
async function fork($: EngineInterface, prompt: string): Promise<ModelForkResult | null> {
  const epoch = generation
  forking = true
  forkUsage = null
  try {
    const answer = await $.model.fork({ prompt })
    // Real forks dispatch turn.step; test stubs and older engines can provide only the result.
    const usage = answer && 'usage' in answer ? answer.usage : forkUsage
    if (usage && epoch === generation) {
      await update($, stats, value => addWarm(value, usage))
      if ((usage.cache_read_input_tokens ?? 0) > 0) {
        const memo = nextMemo(await read($, cache), usage, await $.clock.now())
        await update($, cache, () => memo)
      }
    }
    return answer
  } finally { forking = false; forkUsage = null }
}
async function driveHandoff($: EngineInterface): Promise<void> {
  const language = await read($, lang)
  const value = await read($, handoff)
  if (!value || value.stage !== 'writing' || await read($, busy)) return
  if (!value.text && !await read($, handoffQueued)) return
  try {
    if (value.text) { await finishHandoff($); return }
    await update($, handoffQueued, () => false)
    if (value.kind === 'quick') {
      let answer: ModelForkResult | null = null
      try { answer = await fork($, QUICK_PROMPT) }
      catch (error) { await report($, 'quick fork fallback', error) }
      if (answer?.isAnswered && answer.text.trim()) {
        await update($, handoff, () => ({ ...value, text: answer.text }))
        await finishHandoff($)
        return
      }
    }
    await update($, handoffWaiting, () => true)
    const s = await currentSettings($)
    if (value.kind === 'full' && s.handoffSkill) {
      const [command, ...args] = s.handoffSkill.split(/\s+/)
      await $.command.run({ command: command!, args: args.join(' ') })
    } else await $.prompt.submit({ text: value.kind === 'full' ? FULL_PROMPT : QUICK_PROMPT })
  } catch (error) {
    await update($, handoff, () => ({ ...value, stage: 'failed' }))
    await update($, handoffWaiting, () => false)
    await $.ui.toast(t(language, 'toasts.handoffFailed'))
    await report($, 'handoff', error)
  }
}
async function runCompact($: EngineInterface, note = ''): Promise<void> {
  const language = await read($, lang)
  await update($, panel, () => null)
  await update($, advice, () => null)
  await update($, resultCard, () => ({ stage: 'compacting' }))
  try {
    await $.command.run({ command: 'compact', args: note })
    await update($, resultCard, () => ({ stage: 'compacted' }))
  } catch (error) {
    await update($, resultCard, () => ({ stage: 'failed' as const, detail: t(language, 'alerts.compactFailed') }))
    await $.ui.toast(t(language, 'toasts.compactFailed'))
    await report($, 'compact command', error)
  }
}
async function openCompact($: EngineInterface, surface: Frame['surface']): Promise<void> {
  if (surface === 'terminal') { await runCompact($); return }
  await update($, compactNote, () => '')
  await update($, panel, () => 'compact')
}
async function refreshUsage($: EngineInterface): Promise<void> {
  const usage = await $.session.usage()
  const c = usage.context
  const percent = c.percent ?? (c.tokens !== undefined && c.window > 0 ? c.tokens / c.window * 100 : undefined)
  const ctx = c.tokens !== undefined && percent !== undefined ? { tokens: c.tokens, percent, window: c.window } : null
  if (JSON.stringify(ctx) !== JSON.stringify(await read($, context))) await update($, context, () => ctx)
  const h = hottest(usage.rateLimits)
  const previous = await read($, hot)
  if (previous && (!h || previous.kind !== h.kind || previous.resetsAt !== h.resetsAt)) await update($, hotHidden, () => null)
  if (JSON.stringify(h) !== JSON.stringify(previous)) await update($, hot, () => h)
  const top = usage.rateLimits.filter(l => ['five_hour', 'seven_day'].includes(l.kind)).sort((a, b) => b.percentUsed - a.percentUsed)[0]
  const l = top ? { kind: top.kind, percent: top.percentUsed, ...(top.resetsAt ? { resetsAt: top.resetsAt } : {}) } : null
  if (JSON.stringify(l) !== JSON.stringify(await read($, limit))) await update($, limit, () => l)
  const until = await read($, saveUntil)
  if (until !== null && until <= await $.clock.now()) await update($, saveUntil, () => null)
}
async function tick($: EngineInterface): Promise<void> {
  const language = await read($, lang)
  if (ticking) return
  ticking = true
  try {
    await refreshUsage($)
    const now = await $.clock.now()
    const list = await read($, agents)
    if (list.some(a => a.state === 'running' && a.toolSince !== undefined && now - a.toolSince >= 8000)) {
      await update($, agents, value => value.map(a => a.state === 'running' && a.toolSince !== undefined && now - a.toolSince >= 8000 ? { ...a, state: 'waiting' } : a))
    }
    const memo = await read($, cache)
    const left = memo ? memo.expiresAt - now : null
    const boundary = left === null ? 'unknown' : left <= 0 ? 'expired' : left <= 60000 ? 'last-minute' : countdown(left, language)
    // Text/minimal counters need minute changes; SVG countdown animates between them itself.
    if (cacheBoundary !== undefined && boundary !== cacheBoundary) await $.ui.invalidate('ui.render')
    cacheBoundary = boundary
    if (await read($, handoff)) await driveHandoff($)
    const queued = await read($, adviceQueue)
    if (queued && !await read($, busy)) {
      await update($, adviceQueue, () => null)
      const answer = await $.model.complete({ model: HAIKU, system: ADVICE_SYSTEM, prompt: queued, effort: 'low', maxTokens: 60, timeoutMs: 8000 })
      if (answer.isAnswered) await update($, advice, () => parseAdvice(answer.text))
    }
    const s = await currentSettings($)
    const decision = shouldPing({ settings: s, memo: await read($, cache), warm: await read($, warm), now: await $.clock.now(), idle: !await read($, busy) && !await read($, deciding) && !forking,
      contextTokens: (await read($, context))?.tokens ?? 0, lastRealReplyAt: await read($, lastRealReplyAt) })
    if (decision.ping) {
      let answer: ModelForkResult | null = null
      try { answer = await fork($, 'Reply with just: ok') }
      catch (error) { await report($, 'warm fork', error) }
      const before = await read($, warm)
      const after = afterPing(before, answer, await $.clock.now(), language)
      await update($, warm, () => after)
      if (after.stopped && !before.stopped) await $.ui.toast(t(language, 'toasts.warmStopped', { reason: after.stopped }))
    } else if (s.keepWarm && !await read($, busy) && decision.reason === 'keep warm time bound reached' && !(await read($, warm)).stopped) {
      await update($, warm, value => ({ ...value, stopped: t(language, 'toasts.warmBoundReason') }))
      await $.ui.toast(t(language, 'toasts.warmBound'))
    }
  } catch (error) { await report($, 'session tick', error) }
  finally { ticking = false }
}
function startTimers($: EngineInterface): void {
  if (timersStarted) return
  timersStarted = true
  $.clock.after(1, async () => { await refreshRouter($); await tick($) })
  $.clock.every(3000, async () => { await refreshRouter($) })
  $.clock.every(15000, async () => { await tick($) })
}

async function dashboard($: EngineInterface, working: boolean): Promise<DashboardView> {
  const s = await currentSettings($)
  const p = await read($, pick)
  const list = await read($, agents)
  const record = await read($, last)
  const saving = (await read($, saveUntil) ?? 0) > await $.clock.now()
  const l = await read($, limit)
  const w = await read($, warm)
  return {
    effort: { level: p?.effort ?? effortOf(await read($, appEffort)) ?? null,
      mode: await read($, deciding) ? 'deciding' : await read($, paused) ? 'paused' : p?.by === 'manual' ? 'manual' : s.effortAuto ? 'auto' : 'off',
      ...(p?.why ? { why: p.why } : {}), ...(await read($, decidingSince) !== null ? { since: (await read($, decidingSince))! } : {}) },
    model: await read($, modelIs) ? modelName((await read($, modelIs))!) : null,
    context: await read($, context), cache: await read($, cache), warm: { ...w, on: s.keepWarm },
    limit: l ? { ...l, save: saving } : null, route: record ? routeOf(record) : null, notice: await read($, line),
    auto: s.effortAuto, handoff: await read($, advice) ? 'advised' : s.handoffButton === 'always' ? 'always' : 'off',
    agents: { live: list.filter(a => ['running', 'waiting'].includes(a.state)).length, total: list.length },
    logOpen: await read($, logOpen), agentsOpen: await read($, agentsOpen), effortMenu: await read($, effortMenuOpen),
    swampAt: s.swampAt, hide: s.hide, isWorking: working,
  }
}
async function settingsView($: EngineInterface): Promise<SettingsView> {
  const s = await currentSettings($)
  const draft = normalizeSettings(await read($, settingsDraft) ?? s)
  return { tab: await read($, settingsTab), draft, dirty: JSON.stringify(draft) !== JSON.stringify(s), agents: await read($, agentOptions), routerModels: await read($, routerModels), skills: await read($, skills), jev: await read($, jev), workerUi: await read($, workerUi) }
}
async function frameOf($: EngineInterface, e: RenderInput): Promise<Frame> {
  const s = await currentSettings($)
  const columns = 'bodyColumns' in e.props ? e.props.bodyColumns : e.viewport?.columns ?? 100
  const maxRows = 'maxRows' in e.props ? e.props.maxRows : 'scroll' in e.props ? e.props.scroll.bodyRows : 1
  return { surface: e.surface, columns, maxRows, now: await $.clock.now(), appearance: s.appearance, lang: await read($, lang) }
}
async function alertView($: EngineInterface, now: number): Promise<AlertView | null> {
  const language = await read($, lang)
  const s = await currentSettings($)
  const c = await read($, context)
  const m = await read($, cache)
  const h = await read($, hot)
  const writing = await read($, handoff)
  const result = await read($, resultCard)
  const downReason = await read($, judgeDown)
  const d = await read($, demo)
  const which = bandPriority({ panel: await read($, panel), judgeDown: d === 'down' || (!!downReason && downReason !== await read($, judgeDownHidden)),
    hot: d === 'hot' || hotAlert(h, await read($, hotHidden)), result: !!writing || !!result,
    cold: d === 'cold' || coldAlert(m, c?.tokens ?? 0, now, await read($, coldHidden)),
    swamp: d === 'swamp' || (!await read($, busy) && swampAlert(swamped(c, s.swampAt), await read($, swampHidden))) })
  if (which === 'compact') return { kind: 'compactNote', draft: await read($, compactNote) }
  if (which === 'handoff') return { kind: 'handoffChoice', handoffKind: await read($, handoffChoiceKind), after: await read($, handoffChoiceAfter) }
  if (which === 'judgeDown') return { kind: 'judgeDown', judge: s.judge, reason: d === 'down' ? t(language, 'alerts.demoDown') : downReason! }
  if (which === 'hot') return { kind: 'hot', limitKind: h?.kind ?? 'five_hour', percent: d === 'hot' ? 86 : h!.percent, resetsAt: h?.resetsAt, save: (await read($, saveUntil) ?? 0) > now }
  if (which === 'result') return writing ? { kind: 'result', stage: ['writing', 'clearing'].includes(writing.stage) ? 'handingOff' : writing.stage === 'failed' ? 'failed' : 'handoffDone', handoffKind: writing.kind, ...(writing.stage === 'copied' ? { detail: t(language, 'alerts.copied') } : {}) } : { kind: 'result', ...result! }
  if (which === 'cold') return { kind: 'cold', tokens: d === 'cold' ? 180000 : c!.tokens, idleMinutes: m ? Math.round((now - m.lastReplyAt) / 60000) : 61 }
  if (which === 'swamp') return { kind: 'swamp', percent: d === 'swamp' ? 65 : c!.percent, tokens: d === 'swamp' ? 160000 : c!.tokens }
  return null
}
async function dismiss($: EngineInterface, view: AlertView): Promise<void> {
  await update($, demo, () => null)
  if (view.kind === 'hot') await update($, hotHidden, () => view.percent)
  else if (view.kind === 'cold') await update($, coldHidden, () => true)
  else if (view.kind === 'swamp') await update($, swampHidden, () => view.tokens)
  else if (view.kind === 'judgeDown') await update($, judgeDownHidden, () => view.reason)
  else if (view.kind === 'result') { await update($, resultCard, () => null); await update($, handoff, () => null) }
  else await update($, panel, () => null)
}
function bandActions($: EngineInterface, surface: Frame['surface']): BandActions {
  return { toggleAuto: () => toggleAuto($), toggleWarm: () => toggleWarm($), compact: () => openCompact($, surface), handoff: () => openHandoff($), toggleLog: () => toggleLog($), toggleAgents: () => toggleAgents($), openSettings: () => startPanel($, 'settings'),
    toggleEffortMenu: () => update($, effortMenuOpen, value => !value), pickEffort: effort => manualPick($, effort) }
}
function settingsActions($: EngineInterface): SettingsActions {
  return { setTab: tab => update($, settingsTab, () => tab), patch: change => patchDraft($, change),
    setWorkerUi: ui => update($, workerUi, value => ({ ...value, ...ui })),
    setRule: async (domain, rule) => { const s = normalizeSettings(await read($, settingsDraft)); await patchDraft($, { rules: { ...s.rules, [domain]: rule } }) },
    setFallback: target => patchDraft($, { fallback: target }), jevKey: async key => { try { await saveJevKey($, key) } catch (error) { await $.ui.toast(t(await read($, lang), 'toasts.error', { reason: reason(error) })) } }, testJev: () => testJudge($),
    save: () => finishSettings($, false), close: async () => { await update($, panel, () => null); await update($, settingsDraft, () => null) } }
}
function setupActions($: EngineInterface): SetupActions {
  const a = settingsActions($)
  return { patch: a.patch, setRule: a.setRule, setWorkerUi: a.setWorkerUi, jevKey: a.jevKey, testJev: a.testJev,
    back: () => update($, setupStep, step => Math.max(1, step - 1) as 1 | 2 | 3 | 4), next: () => update($, setupStep, step => Math.min(4, step + 1) as 1 | 2 | 3 | 4), finish: () => finishSettings($, true), skip: () => finishSettings($, true, true) }
}
function alertActions($: EngineInterface, view: AlertView): AlertActions {
  return { compact: note => runCompact($, note), handoff: () => openHandoff($), dismiss: () => dismiss($, view), toggleSave: () => toggleSave($), openSettings: () => startPanel($, 'settings'),
    noteInput: text => update($, compactNote, () => text), setHandoffKind: kind => update($, handoffChoiceKind, () => kind), setHandoffAfter: after => update($, handoffChoiceAfter, () => after), go: () => queueHandoff($), copy: () => copyHandoff($) }
}
function toolLine(e: ToolCallInput): string {
  const fields = object(e)
  const detail = fields.command ?? fields.file_path ?? fields.pattern ?? fields.query ?? fields.url ?? fields.description ?? ''
  return `${e.tool} ${String(detail).split('\n')[0]}`.trim().slice(0, 70)
}
async function prepareStep($: EngineInterface, e: TurnStepInput): Promise<TurnStepInput> {
  const language = await read($, lang)
  if (e.agentId) {
    const a = (await read($, agents)).find(a => a.id === e.agentId)
    return a?.pick && a.pick.target.agent === 'general-purpose' ? { ...e, effort: a.pick.effort } : e
  }
  const previousModel = await read($, modelIs)
  const oldEffort = await read($, appEffort)
  const changedModel = previousModel !== e.model
  if (changedModel) {
    await update($, modelIs, () => e.model)
    await update($, appEffort, () => e.effort ?? null)
    if (previousModel !== null) {
      await update($, cache, () => null)
      await update($, lastRealReplyAt, () => null)
    }
  }
  const safe = isCacheSafeModel(e.model)
  if (await read($, paused) !== !safe) await update($, paused, () => !safe)
  let s = await currentSettings($)
  if ((changedModel || oldEffort === null) && carriedPick) {
    carriedPick = false
    const level = effortOf(e.effort)
    const carried = await read($, pick)
    if (!s.effortAuto && carried?.by === 'manual' && level && carried.effort !== level) {
      await installPick($, { effort: level, by: 'manual', why: t(language, 'toasts.appEffort'), at: await $.clock.now() })
    }
  }
  if (!changedModel && oldEffort !== null && e.effort !== undefined && oldEffort !== e.effort) {
    await update($, appEffort, () => e.effort ?? null)
    await saveSettings($, { ...s, effortAuto: false })
    const level = effortOf(e.effort)
    if (level) await installPick($, { effort: level, by: 'manual', why: t(language, 'toasts.appEffortChanged'), at: await $.clock.now() })
    await $.ui.toast(t(language, 'toasts.autoOff'))
    return e
  }
  if (!changedModel && oldEffort === null && e.effort !== undefined) await update($, appEffort, () => e.effort!)
  s = await currentSettings($)
  const p = await read($, pick)
  await update($, busy, () => true)
  if (!safe || !p || (!s.effortAuto && p.by !== 'manual')) return e
  const saving = s.effortAuto && (await read($, saveUntil) ?? 0) > await $.clock.now()
  return { ...e, effort: saving && EFFORTS.indexOf(p.effort) > EFFORTS.indexOf('medium') ? 'medium' : p.effort }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    try {
      await loadSettings($)
      const language = await read($, lang)
      await $.ui.status(undefined)
      await $.command.register({ name: 'ripple', description: t(language, 'commands.description'), argumentHint: t(language, 'commands.argumentHint'), immediate: true })
      await $.command.register({ name: 'ripple-log', description: t(language, 'commands.logDescription'), immediate: true })
      await $.command.register({ name: 'ripple-bar', description: t(language, 'commands.barDescription'), immediate: true })
      startTimers($)
      if (!(await currentSettings($)).setupDone && !await read($, panel)) await startPanel($, 'setup')
    } catch (error) { await report($, 'session.start', error) }
    return result
  })
  on('classic.SessionStart', async ($, e, next) => {
    try {
      if (['clear', 'resume', 'fork'].includes(e.source)) {
        generation++
        judgeSequence++
        await loadSettings($)
        await update($, busy, () => false)
        await update($, appEffort, () => null)
        await update($, heldPick, () => null)
        await update($, deciding, () => false)
        if (e.source === 'clear') {
          await update($, cache, () => null)
          await update($, context, () => null)
          await update($, lastRealReplyAt, () => null)
        }
        if (e.model) await update($, modelIs, () => e.model!)
        await update($, paused, () => e.model ? !isCacheSafeModel(e.model) : false)
      }
      if (['resume', 'fork'].includes(e.source)) {
        const memo = restoreFromResume(e.seconds_since_last_response, e.prompt_cache_likely_expired, (await read($, cache))?.ttlMs ?? 3600000, await $.clock.now())
        await update($, cache, () => memo)
        await update($, lastRealReplyAt, () => memo?.lastReplyAt ?? null)
      }
      startTimers($)
    } catch (error) { await report($, 'classic.SessionStart', error) }
    return next(e)
  })
  on('prompt.submit', async ($, e, next) => {
    const sequence = ++judgeSequence
    try {
      const s = await currentSettings($)
      const model = await $.session.model()
      if (await read($, paused) !== !isCacheSafeModel(model)) await update($, paused, () => !isCacheSafeModel(model))
      const messages = await $.session.messages()
      const current = await read($, pick)
      const assistant = messages.findLast(m => m.role === 'assistant')?.text.slice(-2000) ?? ''
      let hostCommand = false
      if (e.text.trim().startsWith('/')) {
        const name = e.text.trim().split(/\s+/)[0]!.slice(1)
        const command = (await $.command.list()).find(c => c.name === name)
        hostCommand = !command || command.source === 'builtin' || name.startsWith('ripple')
      }
      const human = ['composer', 'bridge', 'sdk'].includes(e.origin.kind)
      if (human && !hostCommand && (e.text.trim() || e.attachments?.length) && (!isShortFollowUp(e.text) || !!e.attachments?.length)) {
        const count = await read($, promptCount) + 1
        await update($, promptCount, () => count)
        const c = await read($, context)
        if (c && adviceDue(count, c.percent)) {
          const warmCache = ((await read($, cache))?.expiresAt ?? 0) > await $.clock.now()
          await update($, adviceQueue, () => adviceInput({ messages, next: e.text, contextPercent: c.percent, warm: warmCache }))
        }
      }
      if (shouldJudge({ text: e.text, origin: e.origin.kind, auto: s.effortAuto, modelId: model, hostCommand, current, attachments: e.attachments, assistantTail: assistant })) {
        const now = await $.clock.now()
        await update($, decidingSince, () => now)
        await update($, deciding, () => true)
        const c = await read($, context)
        const input: JudgeInput = { messages, next: e.text, attachments: e.attachments, current: { model, effort: current?.effort ?? effortOf(await read($, appEffort)) ?? 'medium' }, contextPercent: c?.percent, midTurn: !!e.turnId }
        const judged = await judge($, s, input, false)
        if (sequence === judgeSequence && (await currentSettings($)).effortAuto && judged.verdict) {
          const final = finalEffort(judged.verdict, s, (await read($, saveUntil) ?? 0) > await $.clock.now(), await read($, lang))
          const value: Pick = { ...judged.verdict, ...final, by: judged.by, at: await $.clock.now() }
          if (e.turnId && current && EFFORTS.indexOf(value.effort) < EFFORTS.indexOf(current.effort)) await update($, heldPick, () => value)
          else { await update($, heldPick, () => null); await installPick($, value) }
          await update($, stats, old => addPrompt(old, value.effort))
        }
      } else if (human && !hostCommand && s.effortAuto && current && isCacheSafeModel(model)) {
        await update($, stats, old => addPrompt(old, current.effort))
      }
      if (!hostCommand) await update($, busy, () => true)
    } catch (error) { await report($, 'prompt.submit', error) }
    finally { if (sequence === judgeSequence) await update($, deciding, () => false) }
    return next(e)
  })
  on('turn.step', async function* ($, e, next) {
    const ownFork = forking && !e.agentId
    const epoch = generation
    let request = e
    try {
      if (!ownFork) request = await prepareStep($, e)
      if (!e.agentId && !ownFork) await update($, lastRequest, () => ({ model: request.model, appEffort: e.effort, sentEffort: request.effort }))
    } catch (error) { request = e; await report($, 'turn.step prepare', error) }
    const answer = yield* next(request)
    try {
      if (epoch !== generation) return answer
      if (ownFork) { if (answer.usage) forkUsage = answer.usage; return answer }
      if (e.agentId && answer.usage) {
        await update($, agents, list => list.map(a => a.id === e.agentId ? { ...a, cost: a.cost + weighted(answer.usage!) } : a))
      } else if (!e.agentId && answer.usage) {
        const now = await $.clock.now()
        if (answer.usage.model === await $.session.model()) {
          const memo = nextMemo(await read($, cache), answer.usage, now)
          await update($, cache, () => memo)
          await update($, coldHidden, () => false)
          await update($, lastRealReplyAt, () => now)
          await update($, warm, value => ({ ...value, stopped: undefined }))
        }
        const p = await read($, pick)
        if (p && (await currentSettings($)).effortAuto && isCacheSafeModel(request.model)) await update($, stats, value => addRequest(value, answer.usage!, effortOf(request.effort) ?? p.effort))
      }
    } catch (error) { await report($, 'turn.step record', error) }
    return answer
  })
  on('turn.complete', async ($, e, next) => {
    try {
      const language = await read($, lang)
      if (e.agentId) {
        const now = await $.clock.now()
        await update($, agents, list => list.map(a => a.id === e.agentId ? { ...a, state: e.reason === 'answer' ? 'done' : 'failed', endedAt: now, now: undefined, toolSince: undefined } : a))
      } else if (!forking) {
        await update($, busy, () => false)
        const held = await read($, heldPick)
        if (held && (await currentSettings($)).effortAuto) await installPick($, held)
        await update($, heldPick, () => null)
        const value = await read($, handoff)
        if (value?.stage === 'writing' && await read($, handoffWaiting)) {
          await update($, handoffWaiting, () => false)
          if (e.reason === 'answer' && e.answer.trim()) await update($, handoff, () => ({ ...value, text: e.answer }))
          else {
            await update($, handoff, () => ({ ...value, stage: 'failed' }))
            await $.ui.toast(t(language, 'toasts.handoffEmpty'))
          }
        }
      }
    } catch (error) { await report($, 'turn.complete', error) }
    return next(e)
  })
  on('agent.spawn', async ($, e, next) => {
    let input = e
    let chosen: WorkerPick | undefined
    try {
      const s = await currentSettings($)
      if (!e.workflow && !e.isTeammate && takesOver(e, s)) {
        const routed = await requestPick($, e, s)
        if ('deny' in routed) return routed
        input = routed.input
        chosen = routed.pick
      } else if (!e.fork && !e.workflow) {
        const files = await workerFiles($)
        try { await refreshModels($) } catch (error) { await report($, 'explicit worker catalogue', error) }
        const file = files.get(e.subagentType)
        const provider = file ? agentProvider(file) : e.model && !/^(?:sonnet|opus|haiku|claude-)/.test(e.model) ? (await read($, routerModels)).find(m => m.value === e.model?.replace(/@[^@]*$/, ''))?.provider : 'anthropic'
        if (provider && s.providers[provider] === false) return { deny: t(await read($, lang), 'workers.disabled', { provider }) }
        const marker = readMarker(e.prompt)
        if (marker) {
          const markerFile = files.get(marker.name) ?? [...files.values()].find(f => agentModel(f)?.replace(/@[^@]*$/, '') === marker.name)
          const markerProvider = markerFile ? agentProvider(markerFile) : (await read($, routerModels)).find(m => m.value === marker.name)?.provider
          if (markerProvider && s.providers[markerProvider] === false) return { deny: t(await read($, lang), 'workers.disabled', { provider: markerProvider }) }
        }
        const fix = await workerFix($, e)
        if (fix) {
          if (fix.dropped) await $.ui.toast(t(await read($, lang), 'toasts.ownModel', { name: e.subagentType, model: fix.dropped }))
          input = { ...e, prompt: fix.prompt, model: fix.model }
        }
      }
    } catch (error) { input = e; await report($, 'agent.spawn prepare', error) }
    const result = await next(input)
    try {
      if (result.agentId) {
        const rec: AgentRec = { id: result.agentId, description: input.description, type: input.subagentType, model: result.model, ...(chosen ? { pick: chosen } : {}), state: 'running', startedAt: await $.clock.now(), cost: 0 }
        await update($, agents, list => [...list.filter(a => a.id !== rec.id), rec].slice(-40))
      }
    } catch (error) { await report($, 'agent.spawn record', error) }
    return result
  })
  on('tool.call', async ($, e, next) => {
    let started = 0
    try {
      started = await $.clock.now()
      if (e.agentId) await update($, agents, list => list.map(a => a.id === e.agentId ? { ...a, now: toolLine(e), toolSince: started, state: 'running' } : a))
    } catch (error) { await report($, 'tool.call start', error) }
    try { return await next(e) }
    finally {
      try {
        if (e.agentId) await update($, agents, list => list.map(a => a.id === e.agentId && a.toolSince === started ? { ...a, now: undefined, toolSince: undefined, state: a.state === 'waiting' ? 'running' : a.state } : a))
      } catch (error) { await report($, 'tool.call finish', error) }
    }
  })
  on('session.compact', async ($, e, next) => {
    try {
      const language = await read($, lang)
      if (e.agentId || (await currentSettings($)).compactWith !== 'haiku') return next(e)
      if (e.trigger === 'precompute') return { skip: t(language, 'commands.compactSkip') }
      const transcript = serializeTranscript(e.messages.length ? e.messages : await $.session.messages())
      if (!transcript) throw new Error(t(language, 'toasts.transcriptEmpty'))
      const answer = await $.model.complete({ model: HAIKU, system: COMPACT_SYSTEM, prompt: transcript + (e.instructions ? `\n\nKeep especially:\n${e.instructions}` : ''), maxTokens: 16000, timeoutMs: 240000, effort: 'medium' })
      if (!answer.isAnswered || answer.text.trim().length <= 200) throw new Error(t(language, 'toasts.summaryEmpty'))
      await update($, cache, () => null)
      await update($, context, () => null)
      await update($, resultCard, () => ({ stage: 'compacted' }))
      return compactResult(answer.text)
    } catch (error) {
      await $.ui.toast(t(await read($, lang), 'toasts.compactFallback'))
      await report($, 'session.compact', error)
    }
    return next(e)
  })
  on('command.run', { command: 'ripple' }, async ($, e, next) => {
    try {
      const language = await read($, lang)
      const [sub = 'settings', arg] = e.args.trim().toLowerCase().split(/\s+/)
      if (sub === 'stats') return { text: formatStats(await read($, stats), language) }
      if (sub === 'debug') return { text: debugText(language, { judge: (await currentSettings($)).judge, judgeModel: (await currentSettings($)).judgeModel, pick: await read($, pick), paused: await read($, paused), cache: await read($, cache), warm: await read($, warm), lastSpawn: await read($, lastSpawn), lastRequest: await read($, lastRequest) }) }
      if (sub === 'settings' || sub === 'setup') await startPanel($, sub)
      else if (sub === 'auto') await toggleAuto($)
      else if (sub === 'warm') await toggleWarm($)
      else if (sub === 'save') await toggleSave($)
      else if (sub === 'handoff') await queueHandoff($, arg === 'full' ? 'full' : 'quick')
      else if (sub === 'log') await toggleLog($)
      else if (sub === 'agents') await toggleAgents($)
      else if (sub === 'bar') await toggleBar($)
      else if (['cold', 'swamp', 'hot', 'down'].includes(sub)) { await update($, panel, () => null); await update($, demo, () => sub as 'cold' | 'swamp' | 'hot' | 'down') }
      else return { text: t(language, 'commands.help') }
      return { text: t(language, 'commands.done', { command: sub }) }
    } catch (error) { await report($, 'ripple command', error); return next(e) }
  })
  on('command.run', { command: 'ripple-log' }, async ($, e, next) => {
    try {
      const language = await read($, lang)
      return { text: await toggleLog($) ? t(language, 'commands.logOpened') : t(language, 'commands.logClosed') } }
    catch (error) { await report($, 'ripple-log', error); return next(e) }
  })
  on('command.run', { command: 'ripple-bar' }, async ($, e, next) => {
    try {
      const language = await read($, lang)
      return { text: await toggleBar($) ? t(language, 'commands.barShown') : t(language, 'commands.barHidden') } }
    catch (error) { await report($, 'ripple-bar', error); return next(e) }
  })
  on('ui.close', { id: LOG_PANE }, async ($, e, next) => {
    try { await update($, logOpen, () => false) } catch (error) { await report($, 'log close', error) }
    return next(e)
  })
  on('ui.close', { id: AGENTS_PANE }, async ($, e, next) => {
    try { await update($, agentsOpen, () => false) } catch (error) { await report($, 'agents close', error) }
    return next(e)
  })
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    try {
      const language = await read($, lang)
      startTimers($)
      if (e.props.hasSurvey) return next(e)
      const which = await read($, panel)
      const frame = await frameOf($, e)
      const el = $.ui.resolve(e)
      if (which === 'settings') return renderSettings(el, frame, await settingsView($), settingsActions($)) as RenderElement
      if (which === 'compact' || which === 'handoff') {
        const choice = await alertView($, frame.now)
        if (choice) return renderAlert(el, frame, choice, alertActions($, choice)) as RenderElement
      }
      if (which === 'setup') {
        const view = await settingsView($)
        return renderSetup(el, frame, { ...view, step: await read($, setupStep) }, setupActions($)) as RenderElement
      }
      if (await read($, bandHidden)) return next(e)
      const alert = await alertView($, frame.now)
      if (alert) return renderAlert(el, frame, alert, alertActions($, alert)) as RenderElement
      const s = await currentSettings($)
      if (s.layout === 'minimal') return next(e)
      const { Box, Button, Text } = el
      const actions = bandActions($, e.surface)
      return <Box flexDirection="column"><Box flexDirection="row" justifyContent="space-between"><Text dimColor>{t(language, 'commands.logTitle')}</Text><Box flexDirection="row" columnGap={2}>{e.surface === 'terminal' || e.surface === 'mobile' ? <Button key="effort" plain hotkey="e" label={t(language, 'band.effort')} onPress={actions.toggleEffortMenu} /> : null}<Button key="hide" plain role="dismiss" label="×" onPress={() => toggleBar($)} /></Box></Box>{renderBand(el, frame, await dashboard($, e.props.isWorking), actions)}</Box>
    } catch (error) { await report($, 'AbovePrompt render', error); return next(e) }
  })
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const engine = await next(e)
    try {
      startTimers($)
      if ((await currentSettings($)).layout !== 'minimal' || await read($, bandHidden)) return engine
      return renderFooter($.ui.resolve(e), await frameOf($, e), await dashboard($, await read($, busy)), bandActions($, e.surface), engine) as RenderElement
    } catch (error) { await report($, 'SessionMode render', error); return engine }
  })
  on('ui.render', { component: 'Pane', requestId: LOG_PANE }, async ($, e, next) => {
    try {
      startTimers($)
      return renderLog($.ui.resolve(e), await frameOf($, e), { rows: await read($, requests), mineOnly: await read($, onlySession) }, { toggleScope: async () => { await update($, onlySession, value => !value); await refreshRouter($) } }) as RenderElement
    } catch (error) { await report($, 'log render', error); return next(e) }
  })
  on('ui.render', { component: 'Pane', requestId: AGENTS_PANE }, async ($, e, next) => {
    try {
      startTimers($)
      const frame = await frameOf($, e)
      return renderAgents($.ui.resolve(e), frame, { agents: await read($, agents), now: frame.now, showDone: await read($, agentsShowDone) }, { toggleDone: () => update($, agentsShowDone, value => !value) }) as RenderElement
    } catch (error) { await report($, 'agents render', error); return next(e) }
  })
}
