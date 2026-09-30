/**
 * Tool-surface bookkeeping for the bootstrap → released transition.
 *
 * Adapted from pi-dsh-minimal `src/adapter/tool-set.ts`; the status-line and
 * adapter-profile plumbing is dropped.
 */

/** Fallback catalog when the pre-bootstrap snapshot is unavailable. */
export const DEFAULT_TOOL_NAMES = ["read", "bash", "edit", "write"];

export const BASH_TOOL_NAME = "bash";
export const STR_REPLACE_EDITOR_TOOL_NAME = "str_replace_editor";

/** The two official dsh `minimal` tools: the entire first-request tool surface. */
export const BOOTSTRAP_TOOL_NAMES = [BASH_TOOL_NAME, STR_REPLACE_EDITOR_TOOL_NAME];

/** Tools this plugin registers itself; never part of a restored snapshot. */
export const ADAPTER_OWNED_TOOL_NAMES = [STR_REPLACE_EDITOR_TOOL_NAME];

export function mergeToolNames(...toolNameGroups: string[][]): string[] {
	return [...new Set(toolNameGroups.flat())];
}

export function stripOwnedTools(toolNames: string[], ownedTools: string[] = ADAPTER_OWNED_TOOL_NAMES): string[] {
	return toolNames.filter((toolName) => !ownedTools.includes(toolName));
}

/**
 * Do the two surfaces hold the same tools? Order-insensitive: the question is
 * only whether another `setActiveTools` call would change anything.
 */
export function sameToolNames(left: string[], right: string[]): boolean {
	return left.length === right.length && left.every((name) => right.includes(name));
}

/**
 * Tools to expose after leaving bootstrap.
 *
 * - Still on the two-tool set (plus optional newly registered names): restore
 *   the pre-bootstrap snapshot and keep those extras.
 * - Another extension replaced the set (plan mode, preset): keep that set.
 */
export function restoreTools(
	previousTools: string[],
	activeTools: string[],
	ownedTools: string[] = ADAPTER_OWNED_TOOL_NAMES,
): string[] {
	const previous = stripOwnedTools(previousTools, ownedTools);
	const current = stripOwnedTools(activeTools, ownedTools);
	const fallback = previous.length > 0 ? previous : [...DEFAULT_TOOL_NAMES];

	const stillBootstrap = current.length === 0 || current.every((name) => name === BASH_TOOL_NAME);
	if (stillBootstrap) return fallback;

	const extras = current.filter((name) => name !== BASH_TOOL_NAME && !previous.includes(name));
	const hasOriginalNonBash = current.some((name) => name !== BASH_TOOL_NAME && previous.includes(name));
	const bootstrapPlusAdds =
		!hasOriginalNonBash &&
		current.includes(BASH_TOOL_NAME) &&
		extras.length > 0 &&
		current.every((name) => name === BASH_TOOL_NAME || extras.includes(name));
	if (bootstrapPlusAdds) return mergeToolNames(previous.length > 0 ? previous : DEFAULT_TOOL_NAMES, extras);

	return current;
}
