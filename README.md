# pi-dsh-optimizer

> **The "auto-shifter" for pi** — reads what you say, picks the best way for the
> AI to work (a "gear"), and switches to it automatically. No manual
> configuration needed.

[![npm version](https://img.shields.io/npm/v/pi-dsh-optimizer.svg)](https://www.npmjs.com/package/pi-dsh-optimizer)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Pi package](https://img.shields.io/badge/pi-package-blue.svg)](https://pi.dev/packages/pi-dsh-optimizer)

Ported from [dsh-router-standard](https://github.com/yjh051108/dsh-router-standard)
(routing preset of the [dsh-routing-suite](https://github.com/yjh051108/dsh-routing-suite)).

---

## Table of contents

- [Quick start](#quick-start)
- [What it does (30-second read)](#what-it-does-30-second-read)
- [The four modes](#the-four-modes)
- [Measured results](#measured-results-same-model-different-gears)
- [How it works (deep dive)](#how-it-works-deep-dive)
- [Configuration reference](#configuration-reference)
- [Troubleshooting / FAQ](#troubleshooting--faq)
- [Changelog](#changelog)
- [Development](#development)
- [File structure](#file-structure)
- [Evidence & attribution](#evidence--attribution)
- [License](#license)

---

## Quick start

Install from GitHub or npm:

```bash
# GitHub (recommended — always the latest commit)
pi install git:github.com/Saolence/pi-dsh-optimizer

# or npm (published releases)
pi install npm:pi-dsh-optimizer
```

That's it. The extension registers 3 tools, injects the right persona, and
routes each session automatically. Verify it's live with:

```
pi_dsh_status
```

You should see something like `mode=weak (band=weak)` on a normal chat session,
with `lang=en` or `lang=zh` depending on your configuration.

---

## What it does (30-second read)

You talk; it decides whether you're trying to **build** or **fix**, then shifts
the AI into the matching gear:

| You say | Gear | What the AI does |
|---|---|---|
| "make me a website / write a script" | 🚀 react (doer) | writes code and runs it, minimal talk |
| "fix this bug / debug this error" | 🔍 spec (planner) | reads code first, thinks, then edits |
| vague / chit-chat / anything else | 🤔 weak (self-route) | decides for itself, every message |

### It does 4 things

1. **Swaps persona** — per-gear work style injected at the very front of the
   AI's system prompt (primacy effect: leading instructions get the strongest
   model attention, and they form a stable cache prefix across turns).
2. **Starts narrow** — the first turn exposes only core tools
   (`read`, `write`, `edit` + `bash`), so a huge tool catalog can't distract.
3. **Opens up after round one** — after the first assistant turn completes
   (whether or not a tool was called), the full catalog unlocks and the
   router steps away.
4. **State survives** — the gear is derived from the session, so reload and
   resume keep it. Overrides persist per session; config choices persist to
   `~/.pi/agent/pi-dsh-optimizer.json`.

### The 3 manual tools

| Tool | What it does | How to call |
|---|---|---|
| `pi_dsh_status` | see the current gear, band, persona, language, override state | no arguments |
| `pi_dsh_mode` | shift gears by hand | `spec` / `react` / `weak` / `mixed`, a number, or `auto` to restore |
| `pi_dsh_subagent` | run a small AI in a DIFFERENT gear | mode + task; doesn't touch this session |

> Numbers are PERCENT (0-100): `100` = react, `1` = 0.01 (near spec). Easiest
> to just pass names: `spec` / `react` / `weak` / `mixed`.

### The 2 slash commands

| Command | What it does |
|---|---|
| `/pi-dsh-lang` | show / switch the injected persona language (`zh` / `en`), persisted |
| `/pi-dsh-identity` | show / control the official pi identity sentence (`keep` / `remove` / `set <text>`), persisted |
| `/pi-dsh-guide` | show / switch the weak-mode near-field routing guide (`on` / `off`), persisted |

---

## The four modes

Think of a car's gears:

| Mode | Alias | When | Tools | Tests |
|---|---|---|---|---|
| `spec` | planner | fix bugs, debug, refactor | read-first | normal |
| `react` | doer | build from scratch, scripts | write-first | suppressed |
| `mixed` | mixed | ⚠️ avoid (unstable transition band) | union | light |
| `weak` | self-route (default) | not sure | write-first | light |

**Why no fine-tuning?** Measured on real models: behavior along the react↔spec
axis collapses into THREE stable regions, not a continuum — spec `[0, 0.15]`,
a transition band `[0.2, 0.45]` (erratic, avoid), and react `[0.5, 1.0]`. The
router only ever picks stable gears and deliberately stays out of the trap zone.

**Default is `weak`** — most chats use it; the AI decides for itself, and you
barely notice the plugin exists.

---

## Measured results (same model, different gears)

Running the SAME model on the SAME task, the four gears produce visibly
different behavior:

**Simple task (fix a dedupe bug) — all got it right, differently:**

| Gear | Opening move | Flavor |
|---|---|---|
| spec | analyze first | most thorough explanation |
| react | fix first | code-first, terse |
| mixed | one-line diagnosis | in-between |
| weak | conclusion first | fullest walkthrough |

**Complex task (review a system's architecture) — differences amplified:**

| Gear | Focus | Standout finding |
|---|---|---|
| spec | deepest engineering review | soft-delete + non-unique id → audit hazard |
| react | pragmatic, prioritized | state-machine reject-boundary gap |
| mixed | broadest coverage | single-process availability + no concurrency guard on fields |
| weak | compliance consultant lens | plaintext data, no tamper-proof logs, no rule engine |

All four independently converged on the same top-3 risks (default key + open
CORS, SQLite concurrency, hand-rolled migrations) — the difference is only in
**how they phrase and prioritize**.

---

## How it works (deep dive)

### 1. Task classification

The session reads your **first user message** and classifies it by keyword
counting:

- More doer words than planner words → `react` (1)
- More planner words than doer words → `spec` (0)
- Roughly even, or none → `weak` (model routes itself)

Doer keywords (non-exhaustive): `create`, `build`, `develop`, `generate`,
`implement`, `make a`, `new project`, `写一个`, `创建`, `开发`, `生成`, `构建`,
`搭建`, `实现`, `做一个`, `脚本`, `工具`, `应用`, …

Planner keywords: `fix`, `debug`, `refactor`, `maintain`, `repair`, `broken`,
`为什么`, `修复`, `调试`, `重构`, `排查`, `报错`, `崩溃`, `迁移`, `升级`, …

Ambiguous or empty input → `weak`. The classification only uses the FIRST user
message of the session, so it's stable across reloads and resumes.

### 2. Persona injection (`before_agent_start`)

The persona is placed **first**, before pi's own system prompt, because:

- Leading instructions get the strongest model attention (primacy effect).
- It forms a stable prefix for prompt caching across turns.

Personas are selected by mode × language × model family:

| Mode | Pro | Flash |
|---|---|---|
| spec | "software engineer assistant" | same |
| react | hands-on doer | same |
| weak | spec sentence + few-shot routing instruction (w6c, +4.67, P24) | neutral + classify + recall/anti-runaway anchors (w7, +5.67, P11) |

Weak mode is deliberately **model-specific** — measurements show the optimal
weak persona differs between Pro and Flash class models. Nothing to configure.

### 3. First-turn tool narrowing

On the first request the active tool set is narrowed to core tools
(`read`, `write`, `edit`, `bash`) regardless of mode. After your **first
durable tool call**, the full catalog is unlocked and the router steps away.
This prevents a huge tool surface from distracting the model in the first,
most impressionable turn.

### 4. Near-field routing guidance (`context` event, weak mode only)

In weak mode, before each LLM call the extension quietly inserts a short
"router" guide **right after your last message** (near-field = strongest
attention). Two variants:

- **Simple task** → short guide:
  `Router: classify this task (build or fix) now…`
- **Complex task** (long message or architectural keywords) → deep guide:
  `Router: …Think deeply about the architecture, edge cases, and integration
  points. Don't burn reasoning on the environment. End each reasoning block
  with a decision or an information need.`

A task counts as *complex* when its text exceeds 120 characters or matches
architecture-ish keywords (`architecture`, `refactor`, `design`, `system`,
`analyze`, `重构`, `架构`, `分析`, …).

Injection is **idempotent**: it skips messages that are already guides and
never stacks a second guide behind the same user message — important because
the `context` event fires before every LLM call in a turn (tool loops included).
Only weak mode gets this nudge; strong modes (spec/react) don't need it.

### 5. Official pi identity handling

pi's default template opens with "You are an expert coding assistant operating
inside pi...". The router can remove, keep, or replace it (default: **remove** —
your persona already defines who you are):

```
/pi-dsh-identity              # show current mode
/pi-dsh-identity remove       # strip pi's official identity sentence (default)
/pi-dsh-identity keep         # keep pi's original sentence
/pi-dsh-identity set <text>   # replace it with your own identity sentence
```

Removal is tolerant: exact-match regex with fallback, so if pi ever rewords
the sentence the prompt is left untouched (no harm).

### 6. Persona language

English by default. Switch permanently (persisted, survives restarts):

```
/pi-dsh-lang        # show current language
/pi-dsh-lang zh     # switch to Chinese persona
/pi-dsh-lang en     # switch back to English persona
```

Precedence: **config file > `PI_DSH_LANG` env var > default (en)**. Both
languages carry identical gear semantics (build/fix routing, model-specific
weak personas). `pi_dsh_status` shows the active language (`lang=en` / `lang=zh`).

### Mapping from dsh-router-standard

| dsh mechanism | pi mechanism |
|---|---|
| `system-prompt/assemble` (persona section) | `before_agent_start` (persona) + `setActiveTools` (first-turn tools) |
| `session/event` near-field guidance | `context` event (inserted after the last user message) |
| `tools.register` (`dev_router_*`) | `pi.registerTool` (`pi_dsh_*`) |
| `session.events` derivation | `ctx.sessionManager` branch scan |

---

## Configuration reference

| Setting | Where | Values | Default |
|---|---|---|---|
| Persona language | `/pi-dsh-lang`, config file, or `PI_DSH_LANG` | `zh` / `en` | `en` |
| Identity handling | `/pi-dsh-identity`, config file, or `PI_DSH_IDENTITY` | `keep` / `remove` / `replace` | `remove` |
| Session mode override | `pi_dsh_mode` (per-session, not persisted) | `spec` / `react` / `weak` / `mixed`, 0-100, `auto` | auto-classified |
| Near-field guide | `/pi-dsh-guide`, config file | `on` / `off` | `on` |

Config file location: `~/.pi/agent/pi-dsh-optimizer.json`:

```json
{
  "lang": "zh",
  "identity": "remove"
}
```

---

## Troubleshooting / FAQ

**`pi_dsh_status` says `mode=spec` but I wanted weak.**
The gear is derived from your FIRST user message. Start a new session, or force
it with `pi_dsh_mode weak` (takes effect on the next request).

**The guide message ("Router: …") isn't visible in my chat history.**
That's expected — the `context` event injects into the in-memory message list
for that LLM call only; it is not persisted to the session log. It's a nudge,
not a transcript entry.

**I see `lang=en` but I want Chinese.**
Run `/pi-dsh-lang zh`. The change is persisted and applies from the next
request. (Config file beats the `PI_DSH_LANG` env var.)

**Why did a short message get the DEEP guide?**
The complexity heuristic also matches architectural keywords, and those can
lurk inside words (e.g. `pi-dsh-optimizer` contains `optimize`). Harmless —
worst case the model thinks a bit deeper than needed.

**Does this work with `/compact` or session resume?**
Yes — mode is re-derived from the first user message of the branch, so
compaction and resume keep the same gear.

---

## Changelog

**0.1.6** — fix: GUIDE injection never actually fired. `extractText` was called
with `m.content` (array/string) but expected `{content}` — it always returned
`""`, so the near-field guide was never inserted in weak mode. Now tolerates
every pi content shape, and injection is idempotent (skips already-injected
guides; no stacking across multi-tool turns). 28 unit tests.

**0.1.5** — localize near-field GUIDE (zh/en via `PI_DSH_LANG`) + align anchor
tool name to pi (`find`, not `glob`).

**0.1.4** — `/pi-dsh-identity` command to remove/replace pi's official identity
sentence.

**0.1.3** — `/pi-dsh-lang` slash command for persistent zh/en persona switch.

**0.1.2** — bilingual persona injection via `PI_DSH_LANG` (zh/en), persona-first
ordering.

**0.1.1** — switch install instructions to GitHub/npm (`pi install`) method.

---

## Development

```sh
node --test tests.mjs   # 28 tests: classification, bands, personas, parseMode regressions, extractText shapes, guide detection, helpers
tsc --noEmit            # type check
```

Note: run tests from the source checkout — Node 26 refuses type-stripping
under `node_modules`, so running them from an installed copy fails with
`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`.

## File structure

```
pi-dsh-optimizer/
├── package.json     pi manifest (npm/gallery publishing)
├── index.ts         extension entry: lifecycle hooks + 3 registered tools + 2 slash commands
├── router-core.ts   pure routing logic (zero pi deps, unit-testable)
├── tests.mjs        unit tests (28)
├── tsconfig.json    type-check config
├── README.md        this file (English)
└── README.zh-CN.md  this file (Chinese)
```

---

## Evidence & attribution

- Upstream theory + experiments: [dsh-router-standard](https://github.com/yjh051108/dsh-router-standard)
  (`docs/paper.md`, `docs/experiments.md`), based on
  [dsh-routing-suite](https://github.com/yjh051108/dsh-routing-suite) measurements.
- Project2 evaluation data: [xiaobright/modeltest](https://github.com/xiaobright/modeltest)
  (V4.1b, frozen) — minimal 99/96, standard 91, PTC 92, anchored-standard 98/99.
- Two-phase anchoring preset: [xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard)
  (MIT). The first-turn anchoring is a plugin-level port of its
  `tool-bootstrap` mechanism.
- DeepSeek Harness official `minimal` preset snapshot
  (`sends the exact RL prompt and schemas` test) — the spec persona and the
  RL-alignment claim.

---

## License

MIT.
