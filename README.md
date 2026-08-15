# pi-dsh-optimizer

**Task-aware reasoning-mode router for pi.** A pi extension that classifies
each task and routes the session to the right reasoning mode before the first
model request. Ported from
[dsh-router-standard](https://github.com/yjh051108/dsh-router-standard)
(routing preset of the
[dsh-routing-suite](https://github.com/yjh051108/dsh-routing-suite)).

> This is a research artifact. It encodes a measured property of DeepSeek V4
> Pro / V4 Flash: model behavior along the persona axis is **not a continuum**
> — it collapses into a few stable regions separated by phase transitions.
> The router therefore quantizes to the stable regions instead of pretending
> the axis is continuously tunable.

**中文版**: [README.zh-CN.md](README.zh-CN.md)

## What it does

Reads the session's first user message, classifies the task, and on the first
model request injects:

1. a **persona** matching the reasoning mode (spec plan-first / react doer /
   weak internal-routing), and
2. a **first-turn core tool set** (read-first for spec, write-first for react).

After the first durable tool call the full tool catalog is exposed and the
router stops touching anything. The mode is derived from durable session
events, so resume/reload keeps it.

## The measured behavior bands

Fine-grained probing (21 mode points × n=2, official API, reasoning_effort=max)
on V4 Pro shows behavior along the persona axis collapses into **three bands**
plus a fourth mode for internal routing:

| band | mode | measured behavior |
|---|---|---|
| `spec` | 0 – 0.19 | stable plan-collective (`We` trajectories, let-me ≈ 0) |
| `mixed` | 0.2 – 0.49 | **transition trap**: unstable mixing of `We`/`The`/`Let` |
| `react` | 0.5 – 1.0 | stable doer (`The`/`Let` first-person, we ≈ 0) — 11 mode values behave alike |
| `weak` | internal | model routes itself per task (weak persona, P8/P11) |

V4 Flash is threshold-like (0–0.5 all spec side, jumps at 0.75+). The numeric
`pi_dsh_mode` interface is kept, but it quantizes to the three bands — the
transition band is never selected automatically.

## Why: dual-attractor RL policy

Evidence across projects (see the upstream `docs/paper.md` and
`docs/experiments.md`):

- The **same model** reaches top-band scores under spec conditions on a
  maintenance benchmark (Project2: minimal 99/96, anchored 98/99) and under
  react/code conditions on a greenfield build task (Mario: 10/10), while the
  wrong mode scores 91 / 6 respectively — a ~10-point swing from prompt
  conditioning alone ("god/ghost duality").
- Persona is the dominant trigger (one-sentence swap flips the trajectory);
  tool-schema surface is a secondary condition.
- Behavior is path-committed: once anchored, expanding the tool catalog
  perturbs at most one reasoning block and never flips the mode.
- The model cannot self-route: the only internal-routing window is a **weak
  persona** + few-shot routing instruction (lean, not flip; discrimination
  +2.3..+3.3). **Mode selection must come from outside.** This extension is
  the automated version of that external routing.

## How it maps to pi

| dsh-router-standard | pi-dsh-optimizer |
|---|---|
| `system-prompt/assemble` (persona section) | `before_agent_start` (persona) + `pi.setActiveTools` (first-turn tool surface) |
| `session/event` inbox.append (near-field guidance) | `context` event (guidance injected right after the last user message) |
| `tools.register` (`dev_router_*`) | `pi.registerTool` (`pi_dsh_status` / `pi_dsh_mode` / `pi_dsh_subagent`) |
| `session.events` derivation | `ctx.sessionManager` branch scan |

## Usage

Install as a pi extension:

```bash
mkdir -p ~/.pi/agent/extensions
cp -r pi-dsh-optimizer ~/.pi/agent/extensions/pi-dsh-optimizer
# restart pi, or use the extension reload command
```

Dependencies: `@earendil-works/pi-coding-agent`, `typebox` (tsconfig paths
point at local installs; loaded directly from `.ts` source).

### The three tools

- **`pi_dsh_status`** — current mode, band, persona, first-turn core tools,
  test-suppression, whether the catalog has been promoted, and whether an
  override is active.
- **`pi_dsh_mode <spec|weak|mixed|react|0-100|0.0-1.0|auto>`** — explicit
  mode. Numeric inputs quantize to the three bands. NOTE: integers are
  PERCENT (0-100): `1` = 0.01, pass `100`/`react`/`1.0` for the react end.
  `auto` clears the override and returns to task classification. The next
  request applies it.
- **`pi_dsh_subagent <mode> <task>`** — run one task in a DIFFERENT reasoning
  mode inside a fresh isolated context (its own system prompt), leaving the
  current trajectory untouched. Returns the answer text plus a reasoning
  character count. Mode isolation is the only reliable way to change modes
  mid-session: the native subagent inherits this session's persona, so a
  plain subagent cannot run a different mode.

## One preset, auto-matched per model

There is no Pro/Flash split to configure: `personaFor(mode, modelId)` reads
the session's model route and selects the measured optimum automatically —
Pro → spec sentence + classify instruction (w6c, +4.67, P24), Flash → neutral
+ classify + recall/anti-runaway anchors (w7, +5.67, P11). The model is fixed
at the first request (path commitment), so the persona is locked for the
session.

## Depth-adaptive guidance (thinking efficiency)

Per-message guidance is dispatched by task complexity
(`isComplexTask`: length or architecture keywords), weak mode only:

- **simple tasks** → fast-convergence guide (one step, zero waste);
- **complex tasks** → decision-closure deep guide: "Think deeply about the
  architecture, edge cases, and integration points. Do not spend reasoning on
  the environment or tooling. Produce when your information is complete. End
  each reasoning block with a decision or an information need."

## Tests

```sh
node --test tests.mjs   # 17 tests: classification, bands, personas, parseMode regressions, helpers
tsc --noEmit            # type check
```

## Files

- `index.ts` — extension entry: lifecycle hooks (`session_start`,
  `before_agent_start`, `tool_call`, `context`) + the three registered tools
- `router-core.ts` — pure routing logic (zero pi deps, unit-testable)
- `tests.mjs` — unit tests
- `tsconfig.json` — type-check config (paths to local pi install)

## Evidence & attribution

- Upstream theory + experiments: [dsh-router-standard](https://github.com/yjh051108/dsh-router-standard)
  (`docs/paper.md`, `docs/experiments.md`), based on
  [dsh-probe](https://github.com/yjh051108/dsh-routing-suite) measurements.
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
