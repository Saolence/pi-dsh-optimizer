/**
 * Prompt composition for the two phases.
 *
 * Bootstrap (first request): the official dsh `minimal` persona and nothing
 * else. That prompt never passes through here — it is written straight onto the
 * provider payload by `payload-rewrite.ts`, so pi's assembled sections stay
 * intact for the release.
 *
 * Released (second request onward): pi's own assembled prompt comes back in
 * full, with its official identity sentence swapped for `IDENTITY_TEXT`.
 */

import { MINIMAL_PROMPT } from "../dsh/official.ts";

export type IdentityMode = "keep" | "remove" | "replace";

/**
 * What pi's official identity sentence is swapped for, in every released
 * request. Edit this block to change the reasoning style the model is given.
 */
export const IDENTITY_TEXT = [
	"**First sentence rule (mandatory, highest priority; first rule of this prompt): the first sentence inside chain of thought must open with `we need to ...` / `we need ...`. Following sentences keep `we need to ...` / `we need ...` as the core pattern, one concrete action each, and may interleave I'll (next action) · I can (viable option) · I should (what ought to be done) · I will (committed step).**",
	"",
	"You are a helpful software engineer assistant. We need to follow this style for all internal reasoning (chain-of-thought):",
	"",
	"1. **`we need to ...` / `we need ...` is the core pattern for every following sentence.** Either can open any sentence, not only the first. We need one concrete action per sentence. Interleave modal verbs: I'll (next action) · I can (viable option) · I need (what must be done) · I should (what ought to be done) · I will (committed step) · I'm / I am (what I am about to do).",
	"",
	"2. **We need to prefer `we need to ...` / `we need ...` for opening steps.**",
	"",
	"3. **Short and colloquial.** We need one sentence per step, decision-level summaries only, we / I perspective.",
	"",
	"4. **Classify every task first.** We need to pick a stable end: build (produce, verify, fix) · fix (read, locate, minimal change, verify) · weak (classify first, then build or fix).",
	"",
	"5. **Scope.** We need this to shape reasoning only. Final replies follow the user's language and tone.",
].join("\n");

/**
 * Remove or replace pi's official identity sentence in the base system prompt.
 * Exact match with tolerant fallback: if pi ever rewords the sentence, the
 * regex misses and the prompt is left untouched (no harm).
 */
const OFFICIAL_IDENTITY_RE =
	/You are an expert coding assistant operating inside pi, a coding agent harness\.[\s\S]*?writing new files\.\n+/;

export function applyIdentity(prompt: string, customText?: string): string {
	const replaced = prompt.replace(OFFICIAL_IDENTITY_RE, () => {
		if (customText) return `${customText.trim()}\n\n`;
		return ""; // remove: drop the sentence and its trailing blank lines
	});
	return replaced === prompt ? prompt : replaced;
}

/** The official dsh `minimal` persona: the entire bootstrap system prompt. */
export function minimalPersona(): string {
	return MINIMAL_PROMPT;
}

/**
 * keep → untouched; remove → sentence dropped; replace → sentence swapped for
 * `customText` (the user's configured text, `IDENTITY_TEXT` by default).
 */
export function applyIdentityHandling(
	prompt: string,
	mode: IdentityMode = "replace",
	customText: string = IDENTITY_TEXT,
): string {
	if (mode === "keep") return prompt;
	return applyIdentity(prompt, mode === "replace" ? customText : undefined);
}

/**
 * Released prompt: pi's assembled prompt with its official identity sentence
 * swapped for the configured block. Nothing is prepended.
 */
export function composeReleasedPrompt(options: {
	assembled: string;
	identity?: IdentityMode;
	/** Defaults to `IDENTITY_TEXT`; ignored unless `identity` is "replace". */
	identityText?: string;
}): string {
	return applyIdentityHandling(options.assembled, options.identity, options.identityText ?? IDENTITY_TEXT);
}
