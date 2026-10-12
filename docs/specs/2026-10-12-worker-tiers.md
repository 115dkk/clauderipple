# Worker tiers — design (2026-10-12)

Status: **built 2026-10-12 (commits d231fde, ba4d1a8, 7160945, 9b3529e).** Supersedes docs/specs/2026-10-11-worker-ladder.md (presets, field
overrides and "더 세밀하게" go away; the four rungs survive under new names).

## Why

The ladder was still too much to set: presets, four rungs × model × effort × backup, two field
overrides, nine hidden fields. Community survey (2026-10-12, eight research workers; second-hand
claims) agreed on three points:

- People fix one model per role and leave it. Praised UIs are one switch (Cline: separate plan/act
  model) or one dial (Amp: mode).
- Auto-routing is disliked when it hides which model worked, or misjudges difficulty from the
  prompt alone.
- Better signals than prompt text: the orchestrator choosing, and stepping up on failure.

The main chat already knows the whole conversation; the judge sees one description. So the
**main chat names the tier**, and the mod keeps deciding **which model** serves it.

## Model

Four workers, named by the effort words AI users already know (Claude Code effort, OpenAI
reasoning effort):

| Worker | Agent name | Use for |
|---|---|---|
| 로우 워커 | `ripple:low` | finding files, single lookups, skimming logs, mechanical edits |
| 미디움 워커 | `ripple:medium` | specified implementation, refactors, summaries, drafts |
| 하이 워커 | `ripple:high` | hard debugging, multi-file changes, independent review and rebuttal |
| 맥스 워커 | `ripple:max` | the best result available: planning, design, architecture, opinions |

`ripple:auto` stays: no tier given → the judge picks one of the four (its light/standard/deep
levels map to low/medium/high; `max` only by explicit choice).

**Who decides what**

- Main chat: how hard the task is — by choosing the agent. Nothing in the user's CLAUDE.md; each
  agent's `description` (shipped in the plugin, always visible in the Agent tool list) says when to
  use it. Distributable as is.
- Mod: which model and effort serve the tier, from the models the user ticked; skips providers
  that are off, out of quota or failing (402/429/5xx) and says so (existing `fallbackReason`);
  respects billing class.
- **Failure steps up once:** a worker that errors or returns no usable result is retried one tier
  up (low → medium → high). `max` does not step; it reports to the main chat.
- Always visible: the task list label shows tier and model ("하이 · Astra·high · …"); every pick
  is logged as now (`worker pick:`).

## Filling the tiers

The shared ticked-model list supplies every worker set. Each rung is an ordered `Step[]`, each
step `{target, effort}`. An empty rung is filled with one model by `fillLadder`'s existing
`claudeGpt` rule. Existing lists, including unticked or unavailable entries, are kept unchanged.
At dispatch, try each entry in order; skip missing, unticked, switched-off, quota-exhausted or
runtime-exhausted providers. Only when the whole list fails, try the list one rung up, then the
session model (never down or two rungs up). The pick log records its 1-based position and every
skipped model/reason; the fallback toast names the skipped model and reason.

## Operating modes

A mode is a saved worker set, not a prefer/avoid policy. **No mode is built in**. The user supplies
its name; `기본` (Base) means the base worker set, not a saved mode.

- **Name** — user-typed, up to 40 characters.
- **Rungs** — its own light/standard/hard/plan ordered lists (로우/미디움/하이/맥스), the same
  `Step[]` shape and ticked-model/effort options as Base. New modes copy Base, without aliasing it.
- **Delegation** — `normal` or `eager` (보통 / 적극 — 메인 대화는 지휘만). The main chat may run on
  any model, so no string names Claude as the one directing. Eager adds the existing
  hidden `prompt.submit` context note: "Delegate everything except judgment and final review to
  ripple:low/medium/high/max." First prompt after activation and after main-chat compaction only.
- **End** — `until: 'none' | number | { reset: '<provider>' }`: until turned off, epoch-ms time,
  or the named provider's first known quota reset **after activation** (끄기 전까지 / 시각 지정 /
  한도 초기화 때). Only that provider's reset counts, whatever the rung lists use.
  `'anthropic'` is Claude: the mod's received `SessionRateLimit.resetsAt`, the five-hour or
  seven-day window with the highest `percentUsed`, exactly as the band chooses its binding limit
  (input order breaks ties); do not extrapolate Claude's lazily started five-hour windows. Any
  other name is a ChatGPT provider: its signed-in, unpaused accounts' primary/secondary windows
  from `/api/chatgpt-accounts?provider=<name>`. Previously observed deadlines are checked before
  replacing a rolled-forward snapshot. Unknown resets never end a mode. Stored `'reset'` (before
  2026-10-12: any used provider's) loads as `{ reset: 'chatgpt' }` when any rung entry is a worker
  rather than Claude's own, else `{ reset: 'anthropic' }` — settings carry no worker provider, and
  ChatGPT is the only worker provider with a known reset.
  The dashboard: choosing 한도 초기화 때 shows a provider menu of only the providers whose future
  reset is known now (ChatGPT ones, then Claude), labelled "ChatGPT 한도 초기화 때" / "Claude 한도
  초기화 때"; the line under 종료 시점 names the chosen provider. It starts on a known provider the
  mode's workers use, else the first known. With none known, the choice remains visible but
  disabled, with the reason directly beside it, not a floating note.

Only one mode is active. Its lists replace Base's for routing; the same ordered fallback applies.
Explicit markers remain explicit. The band and every worker-pick log show the active mode name.
Time/reset expiration clears activation and displays one toast; the saved worker set remains.

## Screens

**Dashboard `#mod` → Workers card:**
1. 적용 대상 (off / ripple workers / all subagents) — as now.
2. Tabs: `[기본] [user mode names…] [+ 새 모드]`. The active set is marked independently of
   the tab being edited. The ticked-model list lives only on Base and is shared by every tab.
3. Every tab has four worker rows, each an ordered list of model·effort selects, ↑/↓ reorder,
   remove (minimum one), and `+ 모델 추가`.
4. A saved-mode tab also has editable name, delegation, end, delete and an explicit
   `이 모드 켜기/끄기` control. Creating a mode asks for a name and copies Base's lists.

**In-session quick settings:** active mode select (Base + saved modes) only for worker settings;
individual workers are edited on the dashboard. Existing effort/judge/cache controls stay.

## Migration

- Ladder rungs Light/Standard/Hard/Plan → low/medium/high/max, models and efforts kept.
- A stored single Step loads as a one-item list, in Base and every mode.
- Old target/action modes copy the current normalized Base ladder on load, dropping target/action;
  name, delegation and end survive. Existing saved lists remain independent of later Base edits.
- Field overrides and "더 세밀하게" rules are dropped; the card shows a one-time line saying so.
- Auto (experimental, AA floors) is removed; `ripple:auto` uses the judge + tiers above.

## Acceptance

Ten-task probe (as 2026-10-11) dispatched by the main chat without hints: each lands on a sensible
tier, every pick logged with tier + model; a forced 402 on the low model steps to the next
available model and shows the reason; a failing low task retries on medium once.
