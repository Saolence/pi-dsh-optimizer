# pi-dsh-optimizer

**The "auto-shifter" extension for pi.** It reads what you say, picks the most
fitting way for the AI to work (a "gear"), and switches to it automatically.
No manual configuration needed.

Ported from [dsh-router-standard](https://github.com/yjh051108/dsh-router-standard)
(routing preset of the [dsh-routing-suite](https://github.com/yjh051108/dsh-routing-suite)).

---

## Quick start

Install from GitHub (or npm):

```bash
# GitHub (recommended, always latest)
pi install git:github.com/Saolence/pi-dsh-optimizer

# or npm
pi install npm:pi-dsh-optimizer
```

That's it — you get 3 extra commands and the extension works on its own.

---

## What it does (30-second read)

You talk; it decides whether you're trying to **build** or **fix**, then
shifts the AI into the matching gear:

| You say | Gear | What the AI does |
|---|---|---|
| "make me a website / write a script" | 🚀 react (doer) | writes code and runs it, minimal talk |
| "fix this bug / debug this error" | 🔍 spec (planner) | reads code first, thinks, then edits |
| vague / chit-chat | 🤔 weak (self-route) | decides for itself |

### It does 4 things

1. **Swaps persona** — per-gear work style injected into the AI's setup
   (planner / doer / self-route).
2. **Starts narrow** — first turn exposes only core tools so a huge catalog
   can't distract.
3. **Opens up after you work** — after your first real tool call, the full
   catalog unlocks and the router steps away.
4. **State survives** — the gear is derived from the session, so reload and
   resume keep it.

### The 3 manual tools

| Tool | What it does | How to call |
|---|---|---|
| `pi_dsh_status` | see the current gear | no arguments |
| `pi_dsh_mode` | shift gears by hand | `spec` / `react` / `weak` / `mixed`, a number, or `auto` to restore |
| `pi_dsh_subagent` | run a small AI in a DIFFERENT gear | mode + task; doesn't touch this session |

> Numbers are PERCENT (0-100): `100` = react, `1` = 0.01 (near spec). Easiest
> to just pass names: `spec` / `react` / `weak` / `mixed`.

---

## Measured results (same model, different gears)

Running the SAME model on the SAME task, the four gears produce visibly
different behavior:

**Simple task (fix a dedupe bug) — all got it right, differently:**

| gear | opening move | flavor |
|---|---|---|
| spec | analyze first | most thorough explanation |
| react | fix first | code-first, terse |
| mixed | one-line diagnosis | in-between |
| weak | conclusion first | fullest walkthrough |

**Complex task (review a system's architecture) — differences amplified:**

| gear | focus | standout finding |
|---|---|---|
| spec | deepest engineering review | soft-delete + non-unique id → audit hazard |
| react | pragmatic, prioritized | state-machine reject-boundary gap |
| mixed | broadest coverage | single-process availability + no concurrency guard on fields |
| weak | compliance consultant lens | plaintext data, no tamper-proof logs, no rule engine |

All four independently converged on the same top-3 risks (default key + open
CORS, SQLite concurrency, hand-rolled migrations) — the difference is only in
**how they phrase and prioritize**.

---

## The four modes (think of a car's gears)

| mode | alias | when | tools | tests |
|---|---|---|---|---|
| `spec` | planner | fix bugs, debug, refactor | read-first | normal |
| `react` | doer | build from scratch, scripts | write-first | suppressed |
| `mixed` | mixed | ⚠️ avoid | union | light |
| `weak` | self-route (default) | not sure | write-first | light |

**Why no fine-tuning?** Measured: model behavior is NOT a knob — it has a few
**stable gears**, and the in-between "half-plan, half-doer" settings are a
**trap** (erratic). So the router only ever picks stable gears.

**Default is `weak`** — most chats use it; the AI decides for itself, and you
barely notice the plugin exists.

---

## How it works (only if you care)

1. **Reads your first message** → keyword match → gear:
   - more doer words (create/build/implement…) than planner words → react
   - more planner words (fix/debug/refactor…) than doer words → spec
   - roughly even or none → weak
2. **First request**: injects persona + exposes only core tools.
3. **After your first real tool call**: full catalog unlocks, no more
   intervention.
4. **Per-message nudge** (weak only): after each message, quietly inserts
   "classify build-or-fix first"; complex tasks get the deep guide (think hard
   about architecture, don't burn reasoning on the environment).

**Mapping from dsh-router-standard:**

| dsh mechanism | pi mechanism |
|---|---|
| `system-prompt/assemble` (persona section) | `before_agent_start` (persona) + `setActiveTools` (first-turn tools) |
| `session/event` near-field guidance | `context` event (inserted after the last user message) |
| `tools.register` (`dev_router_*`) | `pi.registerTool` (`pi_dsh_*`) |
| `session.events` derivation | `ctx.sessionManager` branch scan |

**Persona auto-matched per model**: Pro → spec sentence + classify instruction
(w6c, +4.67, P24); Flash → neutral + classify + recall/anti-runaway anchors
(w7, +5.67, P11). Nothing to configure.

---

## Why it's worth it (theory, short version)

- The **same model** scores top-band on both task families when the gear
  matches; the wrong gear drops ~10 points — a pure prompt-conditioning swing
  ("god/ghost duality").
- The model **cannot shift gears itself**: behavior locks at the first request;
  mid-session changes barely work.
- So **gear selection must come from outside** — a human, a classifier, or
  this extension. It's your manual gear-shifting automated.

---

## Development

```sh
node --test tests.mjs   # 17 tests: classification, bands, personas, parseMode regressions, helpers
tsc --noEmit            # type check
```

## File structure

```
pi-dsh-optimizer/
├── package.json    pi manifest (npm/gallery publishing)
├── index.ts        extension entry: lifecycle hooks + 3 registered tools
├── router-core.ts  pure routing logic (zero pi deps, unit-testable)
├── tests.mjs       unit tests
├── tsconfig.json   type-check config
├── README.md       this file (English)
└── README.zh-CN.md this file (Chinese)
```

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

## License

MIT.
