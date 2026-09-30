# pi-dsh-optimizer

**The official dsh `minimal` first request for pi — plus a chain-of-thought style that stops the "let me…" loop.**

> DeepSeek's models don't underperform in pi because pi is weak. They underperform because pi hands them a prompt they were never trained on.
>
> This extension gives the model the opening it *was* trained on — the official `minimal` surface, verbatim — then hands everything back.

`pi` extension · zero config · no model whitelist · 41 tests

---

## The 33-point evidence

Same model. Same benchmark. Different wrapper.

| Score | Harness |
|---|---|
| **87.9** | official DeepSeek Harness |
| **54.68** | Terminus 2 (third-party rerun) |

DeepSeek V4 Pro (0813) on Terminal-Bench 2.1. A 33-point swing that started out as a "did DeepSeek cheat" fight and ended as something far more useful: proof that **an agent score without its harness is a number without units**.

Then the part that kills the easy explanation. The same spread shows up *inside* DeepSeek Harness, across its own presets:

| Preset | Score |
|---|---|
| **minimal** — 2 tools | **99 / 96** |
| standard | 91 |
| PTC (code) | 92 |

If V4 Pro had simply memorised "its own house", those three numbers would agree. They don't. The variable is the **starting prompt and the tool schema** — the model behaves best when the harness looks like the one it was post-trained against.

And the experiment that makes this extension inevitable:

> Start a session with minimal mode's prompt and its two tools. After the very first tool call, restore the **full 25-tool set** and let the run continue normally. The score barely moves: **98 / 99**.
>
> *What the model does in the first turn matters far more than what tools are nominally available for the rest of the session.*

That is the whole idea. This extension is that experiment, applied to pi, automatically.

---

## What it does

**The first request of a session is rewritten into the official dsh `minimal` surface.**

| | First request | From the next turn on |
|---|---|---|
| System prompt | `You are a helpful software engineer assistant.` — 46 chars, verbatim | pi's full prompt |
| Tools | `bash` + `str_replace_editor` | pi's whole catalogue |
| Pi's prompt sections | none of them | all of them |
| Thinking style | model default | your choice (default: the `we need to…` block) |

**Then it gets out of the way.** The moment the session has produced a real turn, the anchor is released — permanently. A released session stays released across compaction, `--continue`, and forks. No state to store, nothing to switch off, nothing to lose.

Nothing else about pi changes. Your session files, pi's tool registry, and the UI are untouched: only the request that leaves pi is rewritten.

---

## The other problem: the "Let me…" loop

Reasoning models loop. It is a well-documented failure mode: overthinking has its own research literature, and "keep thinking steps minimal" is standard advice for thinking models.

DeepSeek's traces have a signature version of it — narration instead of action:

> *Let me… Let me check… Let me think about that… Let me…*

Same plan, restated, again and again, while nothing moves.

So the release step also swaps pi's official identity sentence for a short, strict **`we need to…`** block: every step is a concrete action, first-person plural, one step per sentence, with modals (`I'll` · `I can` · `I should` · `I will`) carrying the next move. Decisions only — no commentary, no restating.

In practice: shorter thinking, fewer restarts, less filler before the first tool call.

### Tune it or delete it — `/dsh-optimizer`

| Menu item | What it does |
|---|---|
| **text** | replace the identity with your own block |
| **mode** | `replace` (default) · `remove` (drop the identity sentence, add nothing) · `keep` (leave pi's wording alone) |
| **preview** | read the exact released prompt before you commit |
| **reset** / **path** | back to defaults / open the config file |

---

## Install

```bash
pi install npm:pi-dsh-optimizer
```

Restart pi. Done. No model to declare, no provider to configure, no whitelist to maintain — if pi is driving a model, the first request of each session is anchored.

---

## Features

- **Anchored opening** — the dsh `minimal` persona and its two official tools, verbatim, on the request that actually reaches the model.
- **Automatic, sticky release** — pi's full prompt and tool catalogue return after the session's first real turn, and stay returned.
- **Swappable thinking style** — `we need to…` by default, three modes, live preview.
- **Ships the official `str_replace_editor`** — the same two-tool surface dsh `minimal` uses, so the anchor isn't a bluff.
- **DSML bridge** — when the model leaks a tool call as text instead of calling it, the call still runs. Zero config.
- **Auditable** — `PI_DSH_OPTIMIZER_DUMP=1` writes the real outgoing request to disk, so you can verify the anchor yourself.
- **Non-destructive** — nothing is patched, patched back, or left in a modified state. The anchor is a property of one request, not of your session.
- **No model gate** — every model works. DeepSeek gains the most (see above); others simply get a leaner first turn.

---

## Commands & config

| Thing | What it does |
|---|---|
| `/dsh-optimizer` | menu: thinking style, mode, preview, reset, path |
| `pi_dsh_status` | tool — prints `phase=`, `model=`, `surface=`, `tools=` |
| `PI_DSH_OPTIMIZER_DUMP=1` | dump outgoing requests for verification |
| `~/.pi/agent/pi-dsh-optimizer.json` | `{ "mode": "replace", "text": "…" }` |

There is deliberately **no `enabled` flag**: uninstall the package to turn it off. A settings switch is one more thing to get out of sync with reality.

---

## FAQ

**Does this only work with DeepSeek?**
No. The preset it ports is what DeepSeek's agent training distribution looks like, so DeepSeek gains the most. Every other model just gets a leaner first request.

**Do I lose pi's rules, skills, and project context?**
For the first request only — that is the point. They return from the next turn on.

**Is it slow?**
It does less work than pi's normal path: 46 characters of prompt and two tool schemas instead of tens of kilobytes of prompt and dozens of schemas.

**Is the anchored request really the official one?**
Yes — the persona string and both tool schemas are copied from the official `minimal` preset. Turn on the dump and diff it.

**I use standard / PTC mode in DSH. What then?**
This extension ports the `minimal` opening specifically. That is the one the numbers favour.

**Does it help prompt caching?**
It gives DeepSeek's prefix cache the shape it likes: a tiny, stable opening and a stable released prefix. It is not a caching feature.

**Will it fight my other extensions?**
It does not patch pi's prompt, so it does not. One caveat: it registers a tool named `str_replace_editor`, which is the official name — if another extension registers the same name, pi keeps one and silently drops the other.

---

## Compatibility

| | |
|---|---|
| pi | `@earendil-works/pi-coding-agent` |
| Models | any — DeepSeek V4 Pro / V4 Flash / V4.1 gain the most |
| Related setups | DeepSeek Harness (DSH), the DSH `minimal` preset, pi + DeepSeek |

---

## Honest caveats

- The 33-point gap and the 99 / 91 / 92 preset spread are **community reports**, not an official DeepSeek statement. Sources below — read them rather than trusting this README.
- The first-turn anchoring experiment was run *inside* DSH. This extension ports it to pi, so your numbers will differ.
- The `we need to…` block is a prompt-style intervention. It changes how reasoning reads and tends to shorten it; it is not a switch that guarantees a shorter trace.
- The DSML bridge is small and has no dedicated test coverage. If it meets a leaked call it cannot parse, it leaves your stream untouched.

---

## Sources & credits

- DeepSeek Harness developer preview — the official preset list (Standard / PTC / Minimal / Creator): <https://deepseek.com/harness/en/>
- **Why DeepSeek Harness Benchmark Scores Differ So Wildly** — the 87.9 vs 54.68 gap, the 99 / 91 / 92 preset spread, and the first-turn anchoring experiment: <https://findharness.com/blog/why-deepseek-harness-benchmark-scores-differ>
- **DeepSeek Pro Looks Brilliant in Minimal Mode. That Is Also the Problem** — the counter-argument, worth reading: <https://www.remio.ai/post/deepseek-pro-looks-brilliant-in-minimal-mode-that-is-also-the-problem>
- **Pi Agent + DeepSeek: Why the Harness Can Matter More Than the Model** — the "harness multiplier", and why minimal prompts suit models that were never trained on a large proprietary harness: <https://docs.bswen.com/blog/2026-09-01-pi-agent-deepseek-harness-multiplier/>
- **Wait, Wait, Wait… Why Do Reasoning Models Loop?** <https://arxiv.org/html/2512.12895v1>
- **Stop Spinning Wheels: Mitigating LLM Overthinking via Mining Patterns for Early Reasoning Exit** <https://arxiv.org/html/2508.17627v1>
- Community analyses behind the numbers: `@shmidtqq` (amplified by `@ST4RHaze`) and the translated Chinese write-up by `@ZhihuFrontier`, *"Did DeepSeek V4 Pro overfit to its own harness? The real issue might be interface sensitivity."*
- The `minimal` preset itself: `apps/cli/config/agent-presets/minimal/agent.cordis.yml` in the DSH repository.

---

## Changelog

| Version | What changed |
|---|---|
| 0.3.0 | First-request anchoring with automatic sticky release, thinking-style modes + preview, DSML bridge, the official `str_replace_editor`, request dump |
| 0.2.x | First public releases: minimal persona and the two-tool surface |

---

## License

MIT.
