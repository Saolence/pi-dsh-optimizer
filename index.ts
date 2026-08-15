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
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  MODE_WEAK, bandFor, bandOf, classifyTask, clamp01, coreFor,
  extractText, isComplexTask, isFlashModel, parseMode, personaFor, testinessFor,
} from "./router-core.ts";

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

/** Has any durable tool call happened in this session? */
function hasToolCall(ctx: ExtensionContext): boolean {
  return ctx.sessionManager.getBranch().some(
    (e) => e.type === 'message' && e.message.role === 'toolResult',
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
  // ── session lifecycle: rebuild per-session state ─────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    const st = getState(sessionId);
    st.promoted = hasToolCall(ctx);
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
    const persona = personaFor(mode, modelId ?? ctx.model?.id);

    // Recover mode state on a fresh process without session_start firing first.
    if (st.mode === undefined) st.mode = classifyTask(firstUserText(ctx));

    // First-turn anchoring: narrow tool surface until the first durable call.
    if (!st.promoted) {
      const core = coreFor(mode);
      const shell = 'bash';
      const narrowed = [...new Set([...core, shell])];
      const all = pi.getAllTools().map((t) => t.name);
      const keep = narrowed.filter((name) => all.includes(name));
      pi.setActiveTools(keep);
    }

    const systemPrompt = event.systemPrompt
      + `\n\n${persona}`;
    return { systemPrompt };
  });

  // ── first durable tool call → promote full catalog ───────────────────────
  pi.on("tool_call", async (event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    const st = getState(sessionId);
    if (st.promoted) return;
    st.promoted = true;
    const all = pi.getAllTools().map((t) => t.name);
    pi.setActiveTools(all);
  });

  // ── near-field routing guidance for weak mode (P14/P16/P17/P19/P20) ──────
  const GUIDE_WEAK =
    '\nRouter: classify this task (build or fix) now, then adopt the matching style — build: direct production; fix: inspect-first. Think deeply first, then commit and act.'
  const GUIDE_DEEP =
    '\nRouter: classify this task (build or fix) now, then adopt the matching style — build: direct production; fix: inspect-first. Think deeply about the architecture, edge cases, and integration points. Do not spend reasoning on the environment or tooling. Produce when your information is complete. End each reasoning block with a decision or an information need.'

  pi.on("context", (event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    const mode = effectiveMode(sessionId, ctx);
    if (bandOf(mode) !== 'weak') return; // strong modes need no guidance
    const messages = event.messages;
    if (!Array.isArray(messages) || messages.length === 0) return;

    // Find the last real user text message; insert guidance right after it.
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i] as { role?: string; content?: unknown };
      if (m.role !== 'user') continue;
      const text = extractText(m.content);
      if (text.trim()) { lastUserIdx = i; break; }
    }
    if (lastUserIdx < 0) return;
    const guide = isComplexTask(extractText((messages[lastUserIdx] as { content?: unknown }).content ?? ''))
      ? GUIDE_DEEP
      : GUIDE_WEAK;

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
    name: "router_status",
    label: "Router Status",
    description: "Show this session's reasoning-mode routing: mode, band, persona, first-turn core tools, test-suppression, and whether an override is active.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const sessionId = ctx.sessionManager.getSessionId();
      const st = getState(sessionId);
      const mode = effectiveMode(sessionId, ctx);
      const modelId = ctx.model?.id;
      const lines = [
        `mode=${fmtMode(mode)} (band=${bandFor(mode)})`,
        `model=${modelId ?? 'unknown'}`,
        `persona=${personaFor(mode, modelId).replace(/\n/g, ' / ')}`,
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
    name: "router_mode",
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
    name: "router_subagent",
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

      const persona = personaFor(parsed, model.id);
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
