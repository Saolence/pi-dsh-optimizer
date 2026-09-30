import { DSH_MINIMAL_TOOLS } from "../dsh/official.ts";

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactChatCompletionsTools(): Record<string, unknown>[] {
	return DSH_MINIMAL_TOOLS.map((tool) => ({
		type: "function",
		function: {
			name: tool.name,
			description: tool.description,
			parameters: structuredClone(tool.parameters),
		},
	}));
}

type DshTool = (typeof DSH_MINIMAL_TOOLS)[number];

/**
 * Rewrite one tool envelope with dsh tool text. The envelope decides the shape:
 * Chat Completions nests under `function`, Anthropic uses `input_schema`, and
 * the Responses API is flat. Fields the provider set are carried over untouched
 * — dropping them (for example the Responses `type: "function"`) is what makes
 * a strict server answer 400.
 */
function withToolText(template: Record<string, unknown>, tool: DshTool): Record<string, unknown> {
	if (isObject(template.function)) {
		return {
			...template,
			type: typeof template.type === "string" ? template.type : "function",
			function: {
				...template.function,
				name: tool.name,
				description: tool.description,
				parameters: structuredClone(tool.parameters),
			},
		};
	}
	if ("input_schema" in template) {
		return {
			...template,
			name: tool.name,
			description: tool.description,
			input_schema: structuredClone(tool.parameters),
		};
	}
	return {
		...template,
		name: tool.name,
		description: tool.description,
		parameters: structuredClone(tool.parameters),
	};
}

/**
 * Mirror the request's own envelopes position by position, falling back to the
 * first one when the request carried fewer tools than dsh needs. An empty or
 * absent list leaves nothing to mirror, so Chat Completions is the only guess.
 */
function rewriteTools(tools: unknown): unknown {
	const templates = Array.isArray(tools) ? tools.filter(isObject) : [];
	if (templates.length === 0) return exactChatCompletionsTools();
	return DSH_MINIMAL_TOOLS.map((tool, index) => withToolText(templates[index] ?? templates[0], tool));
}

function rewriteInstructionContent(content: unknown, persona: string): unknown {
	if (typeof content === "string") return persona;
	if (!Array.isArray(content)) return persona;
	if (content.length === 1 && isObject(content[0]) && content[0].type === "text") {
		return [{ ...content[0], text: persona }];
	}
	return persona;
}

function rewriteMessages(messages: unknown, persona: string): unknown {
	if (!Array.isArray(messages)) return messages;
	let replaced = false;
	return messages.map((message) => {
		if (replaced || !isObject(message)) return message;
		const role = message.role;
		if (role !== "system" && role !== "developer") return message;
		replaced = true;
		return { ...message, content: rewriteInstructionContent(message.content, persona) };
	});
}

export interface RewriteOptions {
	persona: string;
	rewriteTools: boolean;
}


export function rewriteProviderRequest(payload: unknown, options: RewriteOptions): unknown {
	if (!isObject(payload)) return payload;
	const next: Record<string, unknown> = { ...payload };
	if ("system" in next && (typeof next.system === "string" || Array.isArray(next.system))) {
		next.system = rewriteInstructionContent(next.system, options.persona);
	}
	if ("instructions" in next && typeof next.instructions === "string") {
		next.instructions = options.persona;
	}
	if ("messages" in next) {
		next.messages = rewriteMessages(next.messages, options.persona);
	}
	if (options.rewriteTools) next.tools = rewriteTools(next.tools);
	return next;
}
