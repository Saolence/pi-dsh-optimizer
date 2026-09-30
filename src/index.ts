/**
 * pi-dsh-optimizer: an official dsh `minimal` first request, then pi's own
 * prompt with its identity sentence swapped.
 *
 * Structurally modelled on pi-dsh-minimal:
 *
 *   - dsh `minimal` preset surface → `before_provider_request` while the bootstrap is active
 *   - dsh tool bootstrap/release   → `pi.setActiveTools` (bash + str_replace_editor → full catalog)
 *   - dsh `system-prompt/assemble` → `before_agent_start` (identity swap) once released
 *   - dsh `tools.register`         → `pi.registerTool` (pi_dsh_status / str_replace_editor)
 *   - dsh `session.events` derivation → `ctx.sessionManager` entry scan
 *
 * Layout mirrors pi-dsh-minimal: adapter/ (state, promotion, payload-rewrite,
 * tool-set, activation, prompt, dsml, config), tools/ (registered tools), ui/
 * (the `/dsh-optimizer` settings dialogs), dsh/ (official preset text). This
 * file only wires them together.
 */

import { appendFileSync } from "node:fs";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { refreshPromotion, type Surface } from "./adapter/activation.ts";
import { loadIdentityConfig } from "./adapter/config.ts";
import { convertDsmlAssistantMessage } from "./adapter/dsml.ts";
import { modelMatches } from "./adapter/model.ts";
import { rewriteProviderRequest } from "./adapter/payload-rewrite.ts";
import { composeReleasedPrompt, minimalPersona } from "./adapter/prompt.ts";
import { createAdapterState, sessionState } from "./adapter/state.ts";
import { registerStatusTool } from "./tools/status.ts";
import { registerStrReplaceEditorTool } from "./tools/str-replace-editor.ts";
import { registerIdentityCommand } from "./ui/identity-menu.ts";

/** Optional request dump for verification: PI_DSH_OPTIMIZER_DUMP=/tmp/req.jsonl */
function dumpPath(): string | undefined {
	const value = process.env.PI_DSH_OPTIMIZER_DUMP;
	return value && value.length > 0 ? value : undefined;
}

/** Append one provider request to the dump file, when dumping is enabled. */
function dumpSurface(dump: string, surface: Surface, payload: unknown): void {
	try {
		appendFileSync(dump, `${JSON.stringify({ surface, payload })}\n`, "utf-8");
	} catch (error) {
		console.error(`[pi-dsh-optimizer] failed to dump request surface: ${String(error)}`);
	}
}
/** Re-read the config and decide whether this model is ours to touch. */
function enabledFor(ctx: ExtensionContext): boolean {
	const { config } = loadIdentityConfig(getAgentDir());
	return modelMatches(config.models, ctx.model);
}


export default function (pi: ExtensionAPI) {
	const state = createAdapterState(process.cwd());

	// ── registered surface: status probe, editor tool, settings command ─────
	registerStatusTool(pi, state);
	registerStrReplaceEditorTool(pi);
	registerIdentityCommand(pi);

	// ── session lifecycle: rebuild per-session state ────────────────────────
	pi.on("session_start", async (_event, ctx) => {
		const st = sessionState(state, ctx.sessionManager.getSessionId());
		refreshPromotion(pi, ctx, st, enabledFor(ctx));
	});

	// ── prompt surface: dsh-minimal bootstrap, then full release ────────────
	pi.on("before_agent_start", async (event, ctx) => {
		const st = sessionState(state, ctx.sessionManager.getSessionId());
		const enabled = enabledFor(ctx);
		refreshPromotion(pi, ctx, st, enabled);
		// Not our model: pi's prompt and its tool surface stay untouched, and the
		// call above has already handed the catalog back.
		if (!enabled) return undefined;

		// Bootstrap: the first request must look exactly like the official dsh
		// `minimal` preset. pi's prompt is wiped on the wire in
		// before_provider_request, so deliberately return no systemPrompt here —
		// replacing it now would also discard appends another extension made
		// before the release, which the released prompt needs to keep.
		if (st.promoted === false) return undefined;

		// Released: pi's assembled prompt comes back in full, with its official
		// identity sentence swapped for the configured block. The config is read
		// here on every start, so `/dsh-optimizer` edits land on the next request.
		const { config } = loadIdentityConfig(getAgentDir());
		return {
			systemPrompt: composeReleasedPrompt({
				assembled: event.systemPrompt,
				identity: config.mode,
				identityText: config.text,
			}),
		};
	});

	// ── release: first assistant message or first tool call ─────────────────
	pi.on("message_end", async (event, ctx) => {
		const st = sessionState(state, ctx.sessionManager.getSessionId());
		const enabled = enabledFor(ctx);
		// During the bootstrap the model emits dsh-style DSML tool calls as
		// text; convert them into pi-native calls so the first call runs.
		let replacement: ReturnType<typeof convertDsmlAssistantMessage>;
		if (enabled && st.promoted === false && event.message.role === "assistant") {
			const activeToolNames = new Set(pi.getActiveTools());
			replacement = convertDsmlAssistantMessage(
				event.message,
				pi.getAllTools().filter((tool) => activeToolNames.has(tool.name)),
			);
		}
		refreshPromotion(pi, ctx, st, enabled);
		return replacement ? { message: replacement } : undefined;
	});

	// ── the wire: rewrite the payload while the bootstrap is active ─────────
	pi.on("before_provider_request", async (event, ctx) => {
		const st = sessionState(state, ctx.sessionManager.getSessionId());
		const enabled = enabledFor(ctx);
		refreshPromotion(pi, ctx, st, enabled);
		const dump = dumpPath();
		if (!enabled || st.promoted) {
			// Released: the payload goes out untouched, but the surface is still
			// recorded when the dump is enabled.
			if (dump) dumpSurface(dump, "released", event.payload);
			return undefined;
		}

		// The first request(s) of a session carry the official dsh `minimal`
		// surface only: one persona sentence, two tools, and none of pi's own
		// prompt sections.
		const rewritten = rewriteProviderRequest(event.payload, {
			persona: minimalPersona(),
			rewriteTools: true,
		});
		if (dump) dumpSurface(dump, "bootstrap", rewritten);
		return rewritten;
	});

	// ── safety net: recompute the phase at the end of every run ─────────────
	pi.on("agent_end", async (_event, ctx) => {
		refreshPromotion(pi, ctx, sessionState(state, ctx.sessionManager.getSessionId()), enabledFor(ctx));
	});
}
