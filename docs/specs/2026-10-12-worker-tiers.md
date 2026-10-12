# Worker tiers — design (2026-10-12)

Status: **design, not built.** Supersedes docs/specs/2026-10-11-worker-ladder.md (presets, field
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

The user only ticks models. The mod fills the four tiers from them by strength (AA index as an
ordering hint, never a gate) and cost class: cheapest capable model on low, strongest on max.
Each tier shows its pick and can be overridden with one select (model · effort). No presets, no
fields, no backups — a missing model falls to the next tier up, then the session model.

## Operating modes

For stretches like "burn the GPT quota before it resets" or "keep Claude for orchestrating only".
**No mode is built in**: the user names and makes their own; the default is none (tiers as set).
A mode is:

- **Name** — anything the user types.
- **Target** — one or more providers or models.
- **Action** — *prefer*: fill every tier the target can serve with it (strongest of the target on
  max, cheapest on low), other models only where it has nothing; *avoid*: drop the target from the
  worker tiers (the main chat still runs on whatever the session uses).
- **Delegation** — normal or eager. Eager adds one hidden note beside the prompt
  (`prompt.submit` `context`, packages/mod/.claude-plugin/types/claude-code/index.d.ts:7752):
  "Delegate everything except judgment and final review to ripple:low/medium/high/max." Sent on
  the first prompt after the mode turns on and after each compaction, not every turn.
- **Until** (optional) — a time, or the target provider's next quota reset where the router knows
  it (ChatGPT windows); then the mode turns itself off and says so.

One mode is active at a time. Unavailable target models fall back as tiers do (up, then session
model). The band shows the active mode's name; every `worker pick:` line carries it.

## Screens

**Dashboard `#mod` → Workers card:**
1. 적용 대상 (off / ripple workers / all subagents) — as now.
2. 쓸 모델: checkboxes, grouped by provider, billing tag beside each.
3. Four rows 로우·미디움·하이·맥스: one-line meaning, the current pick, "바꾸기" select.

4. 모드: the user's modes (add / edit / delete: name, target, action, delegation, until) and which
   one is on.

**In-session quick settings:** the active mode select, and the four rows.

## Migration

- Ladder rungs Light/Standard/Hard/Plan → low/medium/high/max, models and efforts kept.
- Field overrides and "더 세밀하게" rules are dropped; the card shows a one-time line saying so.
- Auto (experimental, AA floors) is removed; `ripple:auto` uses the judge + tiers above.

## Acceptance

Ten-task probe (as 2026-10-11) dispatched by the main chat without hints: each lands on a sensible
tier, every pick logged with tier + model; a forced 402 on the low model steps to the next
available model and shows the reason; a failing low task retries on medium once.
