/**
 * Which models this plugin is allowed to touch.
 *
 * The default is DeepSeek-only, matched case-insensitively as a substring of
 * the model id, its display name or its provider — so `deepseek-v4.1-flash`,
 * `DeepSeek-V4-Pro` and a model served by a provider named `deepseek` all pass,
 * while a Claude or GPT session is left completely untouched: no prompt rewrite,
 * no tool-surface switch, no DSML conversion.
 *
 * Patterns are forgiving on purpose: the glob decoration is stripped before
 * matching, so `*deepseek*` and `deepseek` behave the same. An empty list — or a
 * bare `*` — means every model, which is the way back to 0.3.0 behaviour.
 */

/** The model fields the whitelist is compared against. pi-ai's `Model` satisfies this. */
export interface ModelDescriptor {
	/** The model id, e.g. `deepseek-v4.1-flash`. */
	id?: string;
	/** The human-readable model name, e.g. `DeepSeek V4.1 Flash`. */
	name?: string;
	/** The provider id, e.g. `deepseek` or `opencode-go`. */
	provider?: string;
}

/** Lowercased `id + name + provider`: the string the patterns are searched in. */
export function modelHaystack(model: ModelDescriptor | undefined): string {
	return [model?.id, model?.name, model?.provider]
		.filter((part): part is string => typeof part === "string" && part.length > 0)
		.join(" ")
		.toLowerCase();
}

/** Strip the glob decoration and lowercase, so `*DeepSeek*` and `deepseek` agree. */
export function normalizePattern(pattern: string): string {
	return pattern.replaceAll("*", "").trim().toLowerCase();
}

/**
 * True when the model matches at least one pattern.
 *
 * An empty pattern list or a bare `*` matches everything. A model pi has not
 * resolved yet — no id, no name, no provider — does *not* match: when the plugin
 * cannot tell that the model is DeepSeek, it stays out of the way.
 */
export function modelMatches(patterns: readonly string[], model: ModelDescriptor | undefined): boolean {
	if (patterns.length === 0) return true;
	const haystack = modelHaystack(model);
	for (const pattern of patterns) {
		const needle = normalizePattern(pattern);
		if (needle.length === 0) return true;
		if (haystack.includes(needle)) return true;
	}
	return false;
}
