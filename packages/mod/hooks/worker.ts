// How a spawn of one of ClaudeRipple's workers is set right before it starts. Plain functions, no
// engine: the hook in register.tsx feeds them and applies the answer, and the tests import them.
//
// A worker is an agent file the router generated, whose `model:` is a routed id with an optional
// `@effort` (packages/router/src/agents.ts). Two things went wrong at spawn time, both silently:
// - A `model` argument on the Agent call replaced that id with a Claude alias, so the worker ran on
//   Claude and its output was cut to 64 tokens (2026-09).
// - The `[[ripple: name@level]]` marker that sets a worker's effort counts only as the prompt's
//   first line (packages/router/src/routing.ts); anywhere else it is prose and the level is lost.
// Measured on CLI 2.1.286 (2026-10-05): an `agent.spawn` hook that sets `model` to
// `deepseek-v4.1-flash@low` runs the worker on that id, and the router records effort low.
import type { DelegationPin } from '../types/index.d.ts'

/**
 * The router's marker, found anywhere in the prompt rather than only at its top. A tier marker may
 * add a domain word, `[[ripple: standard ui]]`; the router's own pattern stops at the name, so a
 * marker with a domain never reaches it as a model.
 */
export const MARKER = /\[\[\s*(?:ripple|gpt)\s*:\s*([A-Za-z0-9.\-]+)\s*(?:@\s*([A-Za-z]+))?(?:\s+([A-Za-z]+))?\s*\]\]/

// A model the main chat picks by name runs past every ladder, so it must be one the user named. On
// 2026-10-22 a session that had been asked for Gemini twice (Korean proofreading) went on to give it
// an implementation task on its own, by marker; 22 such picks in the two days after the explicit
// marker was described, nearly none before.
/** The words in a model id that name it: `gemini-3.8-flash` → gemini; `gpt-6.1-sol` → gpt, sol. */
const GENERIC = new Set(['flash', 'free', 'pro', 'mini', 'max', 'lite', 'preview', 'latest', 'contributor', 'spark', 'code', 'chat', 'instruct', 'claude', 'turbo', 'high', 'low', 'medium', 'xhigh'])
/** How the user says them in Korean. */
const SPOKEN: Record<string, readonly string[]> = {
  gemini: ['제미나이', '제미니'], deepseek: ['딥시크'], minimax: ['미니맥스'], gpt: ['지피티'], sol: ['솔'], astra: ['아스트라'],
  luna: ['루나'], terra: ['테라'], opus: ['오푸스', '오퍼스'], sonnet: ['소넷'], haiku: ['하이쿠'], fable: ['페이블'], mythos: ['미토스'],
  muse: ['뮤즈'], kimi: ['키미'], qwen: ['큐웬'], mimo: ['미모'], longcat: ['롱캣'], argon: ['아르곤'],
}
const PROVIDER_SPOKEN: Record<string, readonly string[]> = {
  opencode: ['오픈코드'], google: ['구글'], chatgpt: ['챗지피티'], antigravity: ['안티그래비티'], anthropic: ['앤트로픽'],
}
// A Korean name counts when a particle or nothing Korean follows it: "솔한테" names Sol, "솔직히" does not.
const PARTICLE = '(?:이한테|이랑|이가|이는|이를|이도|이로|이나|한테|에게|으로|께|로|이|가|은|는|을|를|도|만|랑|와|과|의|님|에)'
export function modelWords(id: string): string[] {
  return [...new Set(id.toLowerCase().split(/[^a-z]+/).filter(word => word.length >= 3 && !GENERIC.has(word)))]
}
function says(text: string, word: string): boolean {
  if (new RegExp(`(?<![a-z])${word}(?![a-z])`, 'i').test(text)) return true
  return [...(SPOKEN[word] ?? []), ...(PROVIDER_SPOKEN[word] ?? [])].some(name => new RegExp(`${name}(?:쪽)?(?:${PARTICLE}|(?![가-힣]))`).test(text))
}
type Said ={ role: 'user' | 'assistant'; text: string; toolResults?: readonly unknown[] }
/** The person's words alone, shared by one-shot authorization and session pinning. */
export function humanText(m: Said): string | null {
  const text = m.text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim()
  return m.role === 'user' && !m.toolResults?.length && !!text && !/^<[a-z][a-z-]*>/i.test(text) && !text.startsWith('This session is being continued') ? text : null
}

/**
 * Explicit standing intent, never inferred from a one-off model choice. Everyday words stay out:
 * "솔이 계속 실패하네" complains about Sol, and "헤더 고정해 줘" pins a header, not a worker.
 */
export const PIN_PHRASES = ['앞으로', '이제부터', '이 세션은', '이번 세션 내내', '위임 고정', '로 고정', 'from now on', 'for this session'] as const
/** Only words about the choice itself: "자동으로 재시작되게 해" says nothing about workers. */
export const UNPIN_PHRASES = ['고정 풀어', '고정을 풀어', '고정 해제', '고정해제', '모델은 알아서', '알아서 골라', '자동으로 골라', 'unpin', 'choose automatically'] as const
const hasPhrase = (text: string, phrases: readonly string[]) => phrases.some(phrase => /[a-z]/i.test(phrase)
  ? new RegExp(`\\b${phrase}\\b`, 'i').test(text) : text.includes(phrase))
/** Cheap intent check before the hook loads the worker catalogue. */
export function pinInstruction(text: string): 'pin' | 'release' | undefined {
  // A standing "don't": "앞으로 솔은 쓰지 마", "솔 말고", "솔로 고정하지 마".
  if (/(?:고정\s*(?:하지|하지는|말|안)|(?:하지|쓰지|시키지|맡기지|보내지)\s*(?:마|말)|말고|빼고|\b(?:do not|don't|never|stop)\b)/i.test(text)) return undefined
  if (hasPhrase(text, UNPIN_PHRASES)) return 'release'
  return hasPhrase(text, PIN_PHRASES) ? 'pin' : undefined
}
const pinId = (model: string) => model.toLowerCase().replace(/@[^@]*$/, '').replace(/\./g, '-').replace(/^claude-/, '').replace(/^(opus|sonnet|haiku|fable|mythos)-.*$/, '$1')

/** undefined means no change; null explicitly releases the pin. Ambiguous models never pin. */
export function delegationPin(message: Said, sources: readonly { model: string; provider: string }[]): DelegationPin | null | undefined {
  const text = humanText(message)
  if (!text) return undefined
  const instruction = pinInstruction(text)
  if (instruction === 'release') return null
  if (instruction !== 'pin') return undefined
  const own: Said[] = [{ role: 'user', text }]
  const matches = sources.filter(source => userNamed(source.model, own, [], { ...source, providers: rivalProviders(source.model, sources) }))
  const score = (model: string) => modelWords(model).filter(word => says(text, word)).length
  const best = Math.max(1, ...matches.map(source => score(source.model)))
  const named = matches.filter(source => score(source.model) === best)
  if (new Set(named.map(source => pinId(source.model))).size !== 1) return undefined
  const first = named[0]!
  const providers = [...new Set(named.map(source => source.provider))]
  return { model: first.model.replace(/@[^@]*$/, ''), ...(providers.length === 1 ? { provider: providers[0]! } : {}) }
}

/** The most characters of the person's sentence the band keeps beside a pin. */
export const PIN_SAID_MAX = 60
/**
 * The sentence that pinned, for the band to show: the first one carrying a standing phrase, its
 * whitespace folded and cut to PIN_SAID_MAX characters. Session state only.
 */
export function pinSaid(text: string): string | undefined {
  const parts = text.split(/(?<=[.!?。])\s+|\n+/).map(part => part.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const part = parts.find(p => pinInstruction(p) === 'pin') ?? parts[0]
  if (!part) return undefined
  const chars = [...part]
  return chars.length > PIN_SAID_MAX ? chars.slice(0, PIN_SAID_MAX - 1).join('') + '…' : part
}

export function pinAllows(pin: DelegationPin | null, model: string, provider?: string): boolean {
  return !!pin && pinId(pin.model) === pinId(model) && (!pin.provider || pin.provider === provider)
}
/**
 * Whether the user named this model (an id, agent name or Claude alias) in what they last wrote:
 * their last two messages, and the answer they replied to when the last one is a short "go".
 * Tool results, notices and compaction summaries are not the user.
 */
export function userNamed(model: string, messages: readonly Said[], prompts: readonly string[] = [], source: { provider?: string; providers?: readonly string[] } = {}): boolean {
  const words = modelWords(model)
  if (!words.length) return false
  // A notice opens on a tag (`<task-notification>`, `<local-command-stdout>`); a reply the app quotes
  // opens on `<!-- reply 1 -->` and is the user's own words.
  const at = messages.flatMap((m, index) => humanText(m) ? [index] : []).slice(-2)
  const last = at.at(-1)
  const heard = at.map(index => humanText(messages[index]!)!)
  if (last !== undefined && messages[last]!.text.trim().length <= 12) {
    const answer = messages.slice(0, last).findLast(m => m.role === 'assistant' && m.text.trim())
    if (answer) heard.push(answer.text.slice(-2000))
  }
  // The prompts as submitted (`heardPrompts`): one typed mid-turn is in no user message above.
  const texts = [...heard, ...prompts]
  // A provider names the source, not just its model: "Argon on OpenCode" must not authorize the
  // Google API worker with the same model. Without a provider, the model name covers either source.
  const providers = [...new Set([...(source.providers ?? []), ...(source.provider ? [source.provider] : [])])]
  // Only the user's own words choose a source: the answer a short "go" replies to mentions
  // providers in passing ("Google API is out of quota"), and that is not a choice.
  const own = [...at.map(index => humanText(messages[index]!)!), ...prompts]
  // "Sol or DeepSeek" names two models, not a requirement to run Sol on the DeepSeek API.
  const named = providers.filter(provider => modelWords(provider).some(word => !Object.hasOwn(SPOKEN, word) && !words.includes(word) && own.some(text => says(text, word))))
  if (named.length) return !!source.provider && named.includes(source.provider)
  return texts.some(text => words.some(word => says(text, word)))
}

/**
 * The providers a named source could tell this model apart from: those serving a model that shares
 * one of its name words. Naming OpenCode then decides between two Argons, and says nothing about Sol.
 */
export function rivalProviders(model: string, sources: readonly { model: string; provider: string }[]): string[] {
  const words = modelWords(model)
  return [...new Set(sources.filter(s => modelWords(s.model).some(word => words.includes(word))).map(s => s.provider))]
}

export type Spawn = { subagentType: string; prompt: string; model?: string }
export type WorkerFix = { prompt: string; model: string; dropped?: string }

/** The `model:` line of an agent file's frontmatter. */
export function agentModel(file: string): string | undefined {
  const head = /^---\n([\s\S]*?)\n---/.exec(file)?.[1]
  return head ? /^model:\s*(\S+)\s*$/m.exec(head)?.[1] : undefined
}

/**
 * What the spawn should run with, or null to leave it alone. `fileModel` is the worker's agent
 * file `model:` (an id, maybe with `@effort`).
 */
export function fixSpawn(spawn: Spawn, fileModel: string): WorkerFix | null {
  const base = fileModel.replace(/@[^@]*$/, '')
  const marker = MARKER.exec(spawn.prompt)
  const dropped = spawn.model !== undefined && spawn.model !== fileModel && spawn.model.replace(/@[^@]*$/, '') !== base ? spawn.model : undefined
  if (marker) {
    const name = marker[1]!.toLowerCase()
    const level = marker[2]?.toLowerCase()
    const rest = (spawn.prompt.slice(0, marker.index) + spawn.prompt.slice(marker.index + marker[0].length)).replace(/^\s*\n/, '')
    // The marker names this worker: its level goes on the model id, where the router reads it as
    // the agent file's own suffix, and the worker no longer reads a routing note.
    if (name === spawn.subagentType.toLowerCase() || name === base.toLowerCase()) {
      return { prompt: rest, model: level ? `${base}@${level}` : fileModel, ...(dropped ? { dropped } : {}) }
    }
    // It names another model or alias, which only the router can resolve: put it where the router
    // looks. Already there, there is nothing to move.
    const atTop = MARKER.exec(spawn.prompt.replace(/^\s+/, ''))?.index === 0
    if (atTop && !dropped) return null
    return { prompt: atTop ? spawn.prompt : `${marker[0]}\n${rest}`, model: fileModel, ...(dropped ? { dropped } : {}) }
  }
  return dropped ? { prompt: spawn.prompt, model: fileModel, dropped } : null
}
