/**
 * pi-dsh-optimizer (pi-router-mode): task-aware reasoning-mode router for pi.
 *
 * Ported from dsh-router-standard (routing preset of yjh051108/dsh-routing-suite).
 * Mechanism mapping:
 *   - dsh `system-prompt/assemble`  → `before_agent_start` (persona) + `pi.setActiveTools` (first-turn tool surface)
 *   - dsh `session/event` inbox.append → `context` event (near-field guidance after user messages)
 *   - dsh `tools.register` → `pi.registerTool` (router_status / router_mode / router_subagent)
 *   - dsh `session.events` derivation → `ctx.sessionManager` branch scan
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  MODE_WEAK, applyIdentity, bandFor, bandOf, classifyTask, clamp01, coreFor,
  adaptToolNames, extractText, guideFor, isFlashModel, isGuideText, narrowToolSection, parseMode, personaFor, testinessFor,
  type PersonaLang,
} from "./router-core.ts";

// ── persistent config: persona lang + official-identity handling ─────────
// `/pi-dsh-lang` and `/pi-dsh-identity` write ~/.pi/agent/pi-dsh-optimizer.json
// so choices survive restarts. Precedence: config file > env > defaults.
const PERSONA_LANG_ENV = "PI_DSH_LANG";
const LANG_CONFIG_FILE = "pi-dsh-optimizer.json";
const DEFAULT_LANG: PersonaLang = "en";
const DEFAULT_IDENTITY: IdentityMode = "remove";

export type IdentityMode = "keep" | "remove" | "replace";
type PluginConfig = { lang?: string; identity?: string; identityText?: string };

function configPath(): string {
  return join(homedir(), ".pi", "agent", LANG_CONFIG_FILE);
}

function parseLang(v: string | undefined): PersonaLang | undefined {
  const t = (v ?? "").trim().toLowerCase();
  if (t === "zh" || t === "cn" || t === "chinese") return "zh";
  if (t === "en" || t === "english") return "en";
  return undefined;
}

function parseIdentity(v: string | undefined): IdentityMode | undefined {
  const t = (v ?? "").trim().toLowerCase();
  if (t === "keep") return "keep";
  if (t === "remove") return "remove";
  if (t === "replace") return "replace";
  return undefined;
}

let configCache: PluginConfig | undefined; // parsed config file (process-lifetime)
let cachedLang: PersonaLang | undefined;
let cachedIdentity: IdentityMode | undefined;
let cachedIdentityText: string | undefined;

/** Load the persisted config file (once per process). */
function loadConfig(): PluginConfig | undefined {
  if (configCache !== undefined) return configCache;
  try {
    const raw = readFileSync(configPath(), "utf-8");
    configCache = JSON.parse(raw) as PluginConfig;
  } catch {
    configCache = undefined; // missing or corrupt file → fall through to env/default
  }
  return configCache;
}

/** Persist one field to the config file; survives restarts. */
function saveConfigField(field: keyof PluginConfig, value: string | undefined): void {
  try {
    const current = loadConfig() ?? {};
    const next: PluginConfig = { ...current };
    if (value === undefined) delete next[field];
    else next[field] = value;
    mkdirSync(dirname(configPath()), { recursive: true });
    writeFileSync(configPath(), JSON.stringify(next, null, 2) + "\n", "utf-8");
    configCache = next;
    if (field === "lang") { cachedLang = parseLang(value); }
    if (field === "identity") { cachedIdentity = parseIdentity(value); }
    if (field === "identityText") { cachedIdentityText = value; }
  } catch (error) {
    console.error(`[pi-dsh-optimizer] failed to persist config: ${String(error)}`);
  }
}

/** Effective persona language: config file wins, then env, then default. */
function personaLang(): PersonaLang {
  if (cachedLang !== undefined) return cachedLang;
  const fromConfig = parseLang(loadConfig()?.lang);
  if (fromConfig !== undefined) return fromConfig;
  return parseLang(process.env[PERSONA_LANG_ENV]) ?? DEFAULT_LANG;
}

/** Effective identity handling: config file wins, then env, then default. */
function identityMode(): IdentityMode {
  if (cachedIdentity !== undefined) return cachedIdentity;
  const fromConfig = parseIdentity(loadConfig()?.identity);
  if (fromConfig !== undefined) return fromConfig;
  const fromEnv = parseIdentity(process.env.PI_DSH_IDENTITY);
  return fromEnv ?? DEFAULT_IDENTITY;
}

/** Custom identity text for replace mode (from config only). */
function identityText(): string | undefined {
  if (cachedIdentityText !== undefined) return cachedIdentityText;
  const text = loadConfig()?.identityText?.trim();
  cachedIdentityText = text || undefined;
  return cachedIdentityText;
}

interface SessionState {
  override?: number | 'weak';
  promoted: boolean; // full tool catalog exposed after first durable tool call
  mode?: number | 'weak'; // derived from first user message
}

const states = new Map<string, SessionState>();
const agents = new Map<string, { model: { provider: string; id: string } | undefined }>();

function getState(sessionId: string): SessionState {
  let s = states.get(sessionId);
  if (!s) { s = { promoted: false }; states.set(sessionId, s); }
  return s;
}

/** First user message from branch entries (resume-safe mode derivation). */
function firstUserText(ctx: ExtensionContext): string {
  const entries = ctx.sessionManager.getBranch();
  for (const e of entries) {
    if (e.type === 'message' && e.message.role === 'user') {
      const content = e.message.content;
      if (Array.isArray(content)) {
        return content.map((c) => (typeof c === 'string' ? c : (c as { text?: string }).text ?? '')).join(' ');
      }
      if (typeof content === 'string') return content;
    }
  }
  return '';
}

/** Has the session completed at least one assistant turn (first round done)? */
function hasAssistantReply(ctx: ExtensionContext): boolean {
  return ctx.sessionManager.getBranch().some(
    (e) => e.type === 'message' && e.message.role === 'assistant',
  );
}

/** Current effective mode for a session (override wins). */
function effectiveMode(sessionId: string, ctx: ExtensionContext): number | 'weak' {
  const st = getState(sessionId);
  if (st.override !== undefined) return st.override;
  if (st.mode === undefined) st.mode = classifyTask(firstUserText(ctx));
  return st.mode;
}

export default function (pi: ExtensionAPI) {
  // ── slash command: /pi-dsh-lang [zh|en] — persistent language switch ─────
  pi.registerCommand("pi-dsh-lang", {
    description: "Switch the injected persona language (zh/en). Persisted — survives restarts. Usage: /pi-dsh-lang zh | /pi-dsh-lang en | /pi-dsh-lang (show current).",
    handler: async (args, ctx) => {
      const arg = String(args ?? "").trim();
      const target = arg ? parseLang(arg) : undefined;
      const current = personaLang();
      if (arg && target === undefined) {
        ctx.ui?.notify?.(`pi-dsh-lang: invalid value "${arg}" — use zh or en (current: ${current})`, "warning");
        return;
      }
      if (arg && target !== undefined) {
        saveConfigField("lang", target);
        ctx.ui?.notify?.(
          `pi-dsh-lang: persona language switched to ${target} (persisted to ${configPath()}); next request applies it.`,
          "info",
        );
        return;
      }
      ctx.ui?.notify?.(
        `pi-dsh-lang: current persona language = ${current} (persisted config: ${loadConfig()?.lang ?? "none"}). Use /pi-dsh-lang zh or /pi-dsh-lang en to switch permanently.`,
        "info",
      );
    },
  });

  // ── slash command: /pi-dsh-identity [keep|remove|set <text>] ─────────────
  pi.registerCommand("pi-dsh-identity", {
    description: "Control the official pi identity sentence (\"You are an expert coding assistant...\"): keep / remove / replace with custom text. Persisted — survives restarts. Usage: /pi-dsh-identity keep | /pi-dsh-identity remove | /pi-dsh-identity set <text> | /pi-dsh-identity (show current).",
    handler: async (args, ctx) => {
      const arg = String(args ?? "").trim();
      const current = identityMode();
      if (!arg) {
        ctx.ui?.notify?.(
          `pi-dsh-identity: current mode = ${current}${identityText() ? ` (custom text: "${identityText()}")` : ""}. Use /pi-dsh-identity keep | remove | set <text> to change permanently.`,
          "info",
        );
        return;
      }
      const [verb, ...rest] = arg.split(/\s+/);
      const restText = rest.join(" ").trim();
      if (verb === "set") {
        if (!restText) {
          ctx.ui?.notify?.("pi-dsh-identity: set requires text, e.g. /pi-dsh-identity set You are my assistant.", "warning");
          return;
        }
        saveConfigField("identity", "replace");
        saveConfigField("identityText", restText);
        ctx.ui?.notify?.(`pi-dsh-identity: official identity replaced with "${restText}" (persisted).`, "info");
        return;
      }
      const parsed = parseIdentity(verb);
      if (parsed === undefined) {
        ctx.ui?.notify?.(`pi-dsh-identity: invalid value "${verb}" — use keep | remove | set <text> (current: ${current})`, "warning");
        return;
      }
      saveConfigField("identity", parsed);
      ctx.ui?.notify?.(
        `pi-dsh-identity: official identity ${parsed === "keep" ? "kept" : parsed === "remove" ? "removed" : "replaced"} (persisted); next request applies it.`,
        "info",
      );
    },
  });

  // ── session lifecycle: rebuild per-session state ─────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    const st = getState(sessionId);
    st.promoted = hasAssistantReply(ctx);
    st.mode = classifyTask(firstUserText(ctx));
  });

  // ── persona + first-turn tool surface ────────────────────────────────────
  pi.on("before_agent_start", async (event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    const st = getState(sessionId);
    const mode = effectiveMode(sessionId, ctx);
    const modelId = event.systemPromptOptions?.selectedTools
      ? undefined
      : ctx.model?.id;
    const persona = personaFor(mode, modelId ?? ctx.model?.id, personaLang());
    // Recover mode + promotion state on a fresh process without session_start
    // firing first (session_start only fires on reload). Without the promoted
    // restore, an already-unlocked session gets re-narrowed after a restart.
    if (st.mode === undefined) st.mode = classifyTask(firstUserText(ctx));
    if (st.promoted === false) st.promoted = hasAssistantReply(ctx);

    // First-turn anchoring: narrow tool surface until the first durable call.
    let keep: string[] | undefined;
    if (!st.promoted) {
      const core = coreFor(mode);
      const shell = 'bash';
      const all = pi.getAllTools().map((t) => t.name);
      // Map legacy names to equivalents in the running pi (edit → replace).
      const adapted = adaptToolNames(core, all);
      const narrowed = [...new Set([...adapted, shell])];
      keep = narrowed.filter((name) => all.includes(name));
      pi.setActiveTools(keep);
    }

    // Persona goes FIRST: leading instructions get the strongest model attention
    // (primacy effect) and form the stable cache prefix across turns.
    // NOTE: event.systemPrompt is a snapshot taken BEFORE setActiveTools rebuilt
    // the base prompt, so on the first turn it still lists the full tool catalog.
    // Rewrite its "Available tools:" section to the narrowed set so the visible
    // system prompt matches the API-level tool restriction.
    let base = keep !== undefined ? narrowToolSection(event.systemPrompt, keep) : event.systemPrompt;
    // Official pi identity handling: keep | remove | replace with custom text.
    // The identity sentence is the fixed opening of pi's default template.
    const idMode = identityMode();
    if (idMode !== "keep") {
      const custom = idMode === "replace" ? identityText() : undefined;
      base = applyIdentity(base, custom);
    }
    const systemPrompt = `${persona}\n\n${base}`;
    return { systemPrompt };
  });

  // ── first round done → promote full catalog ─────────────────────────────
  // Strategy B: unlock after the FIRST assistant turn completes (agent_end),
  // whether or not any tool was called. The first turn still gets the narrow
  // tool surface (path-commitment anchoring); from round two everything is open.
  pi.on("agent_end", async (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    const st = getState(sessionId);
    if (st.promoted) return;
    st.promoted = true;
    const all = pi.getAllTools().map((t) => t.name);
    pi.setActiveTools(all);
  });

  // ── near-field routing guidance for weak mode (P14/P16/P17/P19/P20) ──────
  // Guide text lives in router-core (guideFor), localized by PI_DSH_LANG.
  pi.on("context", (event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    const mode = effectiveMode(sessionId, ctx);
    if (bandOf(mode) !== 'weak') return; // strong modes need no guidance
    const messages = event.messages;
    if (!Array.isArray(messages) || messages.length === 0) return;

    // Find the last REAL user text message (skip any previously injected
    // guides — they are also role:'user' — to stay idempotent across the
    // multiple context events a single turn can fire).
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i] as { role?: string; content?: unknown };
      if (m.role !== 'user') continue;
      const text = extractText(m.content);
      if (!text.trim()) continue;
      if (isGuideText(text)) continue; // previously injected guide
      lastUserIdx = i; break;
    }
    if (lastUserIdx < 0) return;
    // Idempotency: a guide right after the last real user message means this
    // turn already injected — do not stack another one.
    const after = messages[lastUserIdx + 1] as { role?: string; content?: unknown } | undefined;
    if (after && after.role === 'user' && isGuideText(extractText(after.content))) return;
    const guide = guideFor(extractText((messages[lastUserIdx] as { content?: unknown }).content ?? ''), personaLang());

    const next = [...messages];
    next.splice(lastUserIdx + 1, 0, {
      role: 'user',
      content: [{ type: 'text', text: guide.trim() }],
      timestamp: Date.now(),
    });
    return { messages: next as typeof messages };
  });

  // ── router self-optimization tools ───────────────────────────────────────
  function fmtMode(mode: number | 'weak'): string {
    return typeof mode === 'string' ? mode : mode.toFixed(2);
  }

  pi.registerTool({
    name: "pi_dsh_status",
    label: "Router Status",
    description: "Show this session's reasoning-mode routing: mode, band, persona, first-turn core tools, test-suppression, and whether an override is active.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const sessionId = ctx.sessionManager.getSessionId();
      const st = getState(sessionId);
      const mode = effectiveMode(sessionId, ctx);
      const modelId = ctx.model?.id;
      const lang = personaLang();
      const lines = [
        `mode=${fmtMode(mode)} (band=${bandFor(mode)})`,
        `model=${modelId ?? 'unknown'}`,
        `lang=${lang}`,
        `persona=${personaFor(mode, modelId, lang).replace(/\n/g, ' / ')}`,
        `core=[${coreFor(mode).join(', ')}]`,
        `testiness=${testinessFor(mode)}`,
        `promoted=${st.promoted ? 'yes' : 'no'}`,
        `override=${st.override !== undefined ? 'yes' : 'no'}`,
      ];
      return {
        content: [{ type: "text", text: lines.join('\n') }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "pi_dsh_mode",
    label: "Router Mode",
    description: "Set this session's reasoning mode: spec (plan-first) / weak (internal routing, model decides per task) / mixed (transition, trap) / react (doer). Accepts band names, 0-100, or 0.0-1.0; use auto to return to task classification. The next request applies it.",
    parameters: Type.Object({
      mode: Type.String({ description: "band name (spec / weak / mixed / react), a 0-100 number, a 0.0-1.0 number, or auto to clear the override. NOTE: integers are PERCENT (0-100) — pass 100/react/1.0 for the react end; 1 means 1% = 0.01" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const parsed = parseMode(params.mode);
      if (parsed === null) {
        return { content: [{ type: "text", text: `invalid mode "${params.mode}": use spec/weak/mixed/react, 0-100, 0.0-1.0, or auto` }], details: {} };
      }
      const sessionId = ctx.sessionManager.getSessionId();
      const st = getState(sessionId);
      if (parsed === 'auto') delete st.override;
      else st.override = parsed === 'weak' ? 'weak' : clamp01(parsed);
      const current = effectiveMode(sessionId, ctx);
      return {
        content: [{ type: "text", text: `mode=${fmtMode(current)} (band=${bandFor(current)}) — next request applies` }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "pi_dsh_subagent",
    label: "Router Subagent",
    description: "Run one task in a DIFFERENT reasoning mode than this session, in a fresh isolated context (own system prompt). The current session trajectory is untouched. Mode: spec (plan-first) / weak (internal routing) / react (doer) / balanced. Returns the answer text.",
    parameters: Type.Object({
      mode: Type.String({ description: "spec / weak / react / balanced (or 0-100). NOTE: integers are PERCENT — pass 100/react for react end; 1 means 1% = 0.01" }),
      task: Type.String({ description: "the task to hand to the mode-isolated subagent" }),
      maxTokens: Type.Optional(Type.Number({ description: "output cap (default 1024)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const parsed = parseMode(params.mode);
      if (parsed === null || parsed === 'auto') {
        return { content: [{ type: "text", text: `invalid mode "${params.mode}"` }], details: {} };
      }
      const model = ctx.model;
      if (!model) return { content: [{ type: "text", text: "no active model" }], details: {} };

      const persona = personaFor(parsed, model.id, personaLang());
      const maxTokens = Number(params.maxTokens || 1024);
      // Enable reasoning on the subagent call so reasoningChars is real.
      // Reuse the session's thinking level when set and supported; fall back
      // to "high" so the mode-isolated call actually emits thinking blocks.
      const sessionLevel = ctx.thinkingLevel;
      const level = sessionLevel && sessionLevel !== 'off' ? sessionLevel : 'high';
      try {
        const assistant = await ctx.modelRegistry.complete(model, {
          systemPrompt: persona,
          messages: [{ role: 'user', content: [{ type: 'text', text: String(params.task) }], timestamp: Date.now() }],
        }, { maxTokens, reasoningEffort: level });
        const text = assistant.content?.map((c) => (c.type === 'text' ? c.text : '')).join('') ?? '';
        const reasoningChars = (assistant.content ?? [])
          .filter((c) => c.type === 'thinking')
          .map((c) => (c as { thinking?: string }).thinking ?? '')
          .join('').length;
        const head = text.slice(0, 3000);
        return {
          content: [{ type: "text", text: `[mode-subagent ${bandFor(parsed)} | reasoning ${reasoningChars} chars]\n${head}${text.length > 3000 ? '\n…(truncated)' : ''}` }],
          details: { reasoningChars, fullLength: text.length },
        };
      } catch (error) {
        const msg = error && (error as Error).message ? (error as Error).message : String(error);
        return { content: [{ type: "text", text: `subagent error: ${msg}` }], details: {}, isError: true };
      }
    },
  });
}
