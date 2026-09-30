import type { SessionEntry } from "@earendil-works/pi-coding-agent";

/**
 * Release detection: has the session produced an assistant turn or a tool
 * call inside the current context window?
 *
 * pi-dsh-minimal's `promoteOn` knob (either / tool-call / assistant-message) is
 * dropped: nothing ever configured it, so it was always `either`.
 */
export function scanSessionPhase(entries: readonly SessionEntry[]): boolean {
	let lastCompactionIndex = -1;
	for (let index = 0; index < entries.length; index++) {
		if (entries[index]?.type === "compaction") lastCompactionIndex = index;
	}

	let hasAssistant = false;
	let hasTool = false;
	for (let index = lastCompactionIndex + 1; index < entries.length; index++) {
		const entry = entries[index];
		if (!entry || entry.type !== "message") continue;
		const role = entry.message?.role;
		if (role === "assistant") {
			hasAssistant = true;
			const content = entry.message.content;
			if (Array.isArray(content) && content.some((part) => part && typeof part === "object" && part.type === "toolCall")) {
				hasTool = true;
			}
			continue;
		}
		if (role === "toolResult") hasTool = true;
	}
	return hasAssistant || hasTool;
}
