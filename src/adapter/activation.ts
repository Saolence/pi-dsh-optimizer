/**
 * Bootstrap / released phase resolution and the tool surface that goes with it.
 *
 * Adapted from pi-dsh-minimal `src/adapter/activation.ts`: the persistent-bash
 * swap is dropped — `bash` keeps pi's own implementation — while the model gate
 * is kept, and defaults to DeepSeek-only (see `models` in the config file). A
 * model outside the whitelist is forced onto the released surface, which also
 * hands back any tool the bootstrap had taken away.
 */

import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { scanSessionPhase } from "./promotion.ts";
import type { SessionState } from "./state.ts";
import { BOOTSTRAP_TOOL_NAMES, restoreTools, sameToolNames, stripOwnedTools } from "./tool-set.ts";

export type Surface = "bootstrap" | "released";

export function desiredSurface(promoted: boolean, enabled = true): Surface {
	return enabled && !promoted ? "bootstrap" : "released";
}

/** Session entries used for promotion scanning (context view when available). */
export function phaseEntries(ctx: ExtensionContext): SessionEntry[] {
	const sm = ctx.sessionManager as unknown as {
		buildContextEntries?: () => SessionEntry[];
		getBranch?: () => SessionEntry[];
		getEntries?: () => SessionEntry[];
	};
	try {
		if (typeof sm.buildContextEntries === "function") return sm.buildContextEntries();
	} catch { /* fall through */ }
	try {
		if (typeof sm.getBranch === "function") return sm.getBranch();
	} catch { /* fall through */ }
	try {
		if (typeof sm.getEntries === "function") return sm.getEntries();
	} catch { /* fall through */ }
	return [];
}

/**
 * Has this session ever produced an assistant turn (full branch, not just the
 * post-compaction window)? Release is sticky: a compaction must not drop a
 * mature session back into the dsh-minimal bootstrap.
 */
export function branchPromoted(ctx: ExtensionContext): boolean {
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type === "message" && entry.message.role === "assistant") return true;
	}
	return false;
}

/** Apply the tool surface that matches `st.promoted`, and report it. */
export function applySurface(pi: ExtensionAPI, st: SessionState, enabled = true): Surface {
	const surface = desiredSurface(st.promoted, enabled);
	const active = pi.getActiveTools();
	if (surface === "bootstrap") {
		if (st.previousTools === undefined) st.previousTools = stripOwnedTools(active);
		const available = pi.getAllTools().map((tool) => tool.name);
		const desired = BOOTSTRAP_TOOL_NAMES.filter((name) => available.includes(name));
		// This runs from every hook, so only issue the switch when it changes
		// anything: `pi.setActiveTools` is not free and the answer rarely moves.
		if (!sameToolNames(active, desired)) pi.setActiveTools(desired);
		return surface;
	}
	const desired = restoreTools(st.previousTools ?? pi.getAllTools().map((tool) => tool.name), active);
	if (!sameToolNames(active, desired)) pi.setActiveTools(desired);
	return surface;
}

/**
 * Recompute the phase and keep the tool surface in sync.
 *
 * Release fires on the first assistant message or the first tool call and stays
 * latched for the rest of the branch.
 */
export function refreshPromotion(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	st: SessionState,
	enabled = true,
): Surface {
	if (enabled && !st.promoted) {
		st.promoted = scanSessionPhase(phaseEntries(ctx)) || branchPromoted(ctx);
	}
	return applySurface(pi, st, enabled);
}
