/**
 * Pure-logic tests: no pi runtime is loaded, only the adapter modules.
 * Run with `node --test tests/*.test.ts` (node strips the types).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_IDENTITY_CONFIG, configFilePath, loadIdentityConfig, normalizeIdentityConfig, saveIdentityConfig } from "../src/adapter/config.ts";
import { rewriteProviderRequest } from "../src/adapter/payload-rewrite.ts";
import { scanSessionPhase } from "../src/adapter/promotion.ts";
import {
	IDENTITY_TEXT,
	applyIdentityHandling,
	composeReleasedPrompt,
	minimalPersona,
} from "../src/adapter/prompt.ts";
import { BOOTSTRAP_TOOL_NAMES, DEFAULT_TOOL_NAMES, restoreTools, stripOwnedTools } from "../src/adapter/tool-set.ts";
import {
	DSH_MINIMAL_TOOLS,
	DSH_MINIMAL_TOOL_NAMES,
	DSH_STR_REPLACE_EDITOR_PARAMETERS,
	MINIMAL_BASH_DESCRIPTION,
	MINIMAL_PROMPT,
	STR_REPLACE_EDITOR_DESCRIPTION,
} from "../src/dsh/official.ts";

const PERSONA = MINIMAL_PROMPT;
const REWRITE = { persona: PERSONA, rewriteTools: true };

// ── the official dsh `minimal` surface ─────────────────────────────────────

test("the bootstrap persona is the official dsh minimal one-liner", () => {
	assert.equal(MINIMAL_PROMPT, "You are a helpful software engineer assistant.");
	assert.equal(minimalPersona(), MINIMAL_PROMPT);
});

test("the bash description is the Web app's minimal one, not the SDK snapshot's", () => {
	assert.ok(
		MINIMAL_BASH_DESCRIPTION.includes(
			"* Network access depends on the task environment. Prefer configured mirrors/proxies when they are available.",
		),
	);
	assert.ok(!MINIMAL_BASH_DESCRIPTION.includes("mirror of common linux"));
	assert.ok(!MINIMAL_BASH_DESCRIPTION.includes("don't have access to the internet"));
});

test("the editor declaration keeps dsh's null placeholders", () => {
	const { properties } = DSH_STR_REPLACE_EDITOR_PARAMETERS;
	assert.equal(properties.file_text.oneOf.length, 2);
	assert.equal(properties.insert_line.oneOf.length, 2);
	assert.equal(properties.new_str.oneOf.length, 2);
	assert.equal(properties.old_str.oneOf.length, 2);
	assert.equal(properties.view_range.oneOf.length, 2);
	assert.equal("oneOf" in properties.command, false);
	assert.equal("oneOf" in properties.path, false);
	assert.ok(
		STR_REPLACE_EDITOR_DESCRIPTION.includes(
			"* A null placeholder for a parameter unused by the selected command is treated as omitted.",
		),
	);
});

test("the bootstrap tool catalog is bash + str_replace_editor", () => {
	assert.deepEqual(
		DSH_MINIMAL_TOOLS.map((tool) => tool.name),
		["bash", "str_replace_editor"],
	);
	assert.deepEqual(DSH_MINIMAL_TOOL_NAMES, ["bash", "str_replace_editor"]);
	assert.deepEqual(BOOTSTRAP_TOOL_NAMES, ["bash", "str_replace_editor"]);
});

// ── payload rewrite: what the provider actually receives ───────────────────

test("rewrite swaps the system prompt and the tool catalog, leaving messages alone", () => {
	const messages = [{ role: "user", content: "hi" }];
	const payload = { model: "m", system: "PI HUGE PROMPT", messages, tools: [{ name: "read" }, { name: "write" }] };
	const out = rewriteProviderRequest(payload, REWRITE) as {
		system: string;
		messages: unknown;
		tools: { name?: string; function?: { name?: string } }[];
	};
	assert.equal(out.system, PERSONA);
	assert.deepEqual(out.messages, messages);
	// the payload carries provider-format tools, so read the nested name too
	assert.deepEqual(
		out.tools.map((tool) => tool.function?.name ?? tool.name),
		["bash", "str_replace_editor"],
	);
});

test("a Responses-shaped payload keeps type:\"function\" on every tool", () => {
	// SGLang's /v1/responses rejects a tool entry with no `type` (HTTP 400).
	const tools = [
		{ type: "function", name: "read", description: "Read", parameters: { type: "object" } },
		{ type: "function", name: "write", description: "Write", parameters: { type: "object" } },
	];
	const out = rewriteProviderRequest({ instructions: "PI HUGE PROMPT", tools }, REWRITE) as {
		tools: { type?: string; name?: string; description?: string; parameters?: unknown }[];
	};
	assert.deepEqual(out.tools.map((tool) => tool.type), ["function", "function"]);
	assert.deepEqual(out.tools.map((tool) => tool.name), ["bash", "str_replace_editor"]);
	assert.equal(out.tools[0]?.description, DSH_MINIMAL_TOOLS[0]?.description);
	assert.deepEqual(out.tools[0]?.parameters, DSH_MINIMAL_TOOLS[0]?.parameters);
});

test("a Chat Completions payload keeps its nested envelope and extra fields", () => {
	const tools = [
		{ type: "function", function: { name: "read", description: "Read", parameters: { type: "object" }, strict: true } },
	];
	const out = rewriteProviderRequest({ messages: [], tools }, REWRITE) as {
		tools: { type?: string; function?: { name?: string; strict?: boolean } }[];
	};
	assert.deepEqual(out.tools.map((tool) => tool.type), ["function", "function"]);
	assert.deepEqual(out.tools.map((tool) => tool.function?.name), ["bash", "str_replace_editor"]);
	assert.equal(out.tools[0]?.function?.strict, true);
});

test("an Anthropic payload keeps input_schema and gains no parameters key", () => {
	const tools = [{ name: "read", description: "Read", input_schema: { type: "object" } }];
	const out = rewriteProviderRequest({ messages: [], tools }, REWRITE) as {
		tools: { name?: string; input_schema?: unknown }[];
	};
	assert.deepEqual(out.tools.map((tool) => tool.name), ["bash", "str_replace_editor"]);
	assert.deepEqual(out.tools[0]?.input_schema, DSH_MINIMAL_TOOLS[0]?.parameters);
	assert.equal("parameters" in (out.tools[0] ?? {}), false);
});

test("rewriteTools=false keeps pi's own tool schemas", () => {
	const payload = { system: "PI HUGE PROMPT", tools: [{ name: "read" }] };
	const out = rewriteProviderRequest(payload, { persona: PERSONA, rewriteTools: false }) as {
		system: string;
		tools: { name?: string; function?: { name?: string } }[];
	};
	assert.equal(out.system, PERSONA);
	assert.deepEqual(out.tools.map((tool) => tool.function?.name ?? tool.name), ["read"]);
});

test("rewrite also covers the instructions field and a leading system message", () => {
	const payload = {
		instructions: "PI HUGE PROMPT",
		messages: [{ role: "system", content: "PI HUGE PROMPT" }, { role: "user", content: "hi" }],
	};
	const out = rewriteProviderRequest(payload, REWRITE) as {
		instructions: string;
		messages: { role: string; content: unknown }[];
	};
	assert.equal(out.instructions, PERSONA);
	assert.equal(out.messages[0]?.content, PERSONA);
});


// ── release (promotion) ────────────────────────────────────────────────────

const user = (text: string) => ({ type: "message", message: { role: "user", content: text } });
const assistant = () => ({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "ok" }] } });
const toolResult = () => ({ type: "message", message: { role: "toolResult", content: [] } });
const compaction = () => ({ type: "compaction" });

test("release fires on the first assistant message", () => {
	assert.equal(scanSessionPhase([user("hi")] as never), false);
	assert.equal(scanSessionPhase([user("hi"), assistant()] as never), true);
});

test("release also fires on the first tool call", () => {
	assert.equal(scanSessionPhase([user("hi"), toolResult()] as never), true);
});

test("the scan window restarts at a compaction", () => {
	const entries = [user("hi"), assistant(), compaction(), user("again")];
	assert.equal(scanSessionPhase(entries as never), false);
});

// ── tool surface ───────────────────────────────────────────────────────────

test("restore returns the pre-bootstrap snapshot plus owned-tool bookkeeping", () => {
	assert.deepEqual(restoreTools(["read", "bash", "edit", "write"], ["bash", "str_replace_editor"]), DEFAULT_TOOL_NAMES);
	assert.deepEqual(stripOwnedTools(["read", "str_replace_editor"]), ["read"]);
});

test("restore keeps a set another extension narrowed", () => {
	assert.deepEqual(restoreTools(["read", "bash", "edit", "write"], ["read"]), ["read"]);
});

// ── released prompt: the identity swap ─────────────────────────────────────

const PI_IDENTITY =
	"You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.";

test("the identity block is the we-need-to reasoning style", () => {
	assert.match(IDENTITY_TEXT, /^\*\*First sentence rule/);
	assert.match(IDENTITY_TEXT, /we need to \.\.\./);
	assert.match(IDENTITY_TEXT, /chain of thought/);
	assert.equal(applyIdentityHandling(`${PI_IDENTITY}\n\n`), `${IDENTITY_TEXT.trim()}\n\n`);
});

test("the released prompt swaps pi's identity sentence and keeps every other section", () => {
	const assembled = `${PI_IDENTITY}\n\n<rules>keep me</rules>\n<cwd>/tmp</cwd>`;
	const out = composeReleasedPrompt({
		assembled,
		identity: "replace",
	});
	assert.ok(!out.includes("You are an expert coding assistant"), "pi identity sentence must be gone");
	assert.match(out, /we need to \.\.\./);
	assert.match(out, /<rules>keep me<\/rules>/);
	assert.match(out, /<cwd>\/tmp<\/cwd>/);
	assert.ok(out.startsWith("**First sentence rule"), "the released prompt opens with the identity block");
});

test("the released prompt prepends nothing of its own", () => {
	const plain = "PLAIN PROMPT with no pi identity sentence";
	assert.equal(composeReleasedPrompt({ assembled: plain }), plain);
});

test("identity keep leaves the assembled prompt untouched", () => {
	const assembled = `${PI_IDENTITY}\n\n<rules>keep me</rules>`;
	assert.equal(applyIdentityHandling(assembled, "keep"), assembled);
});

test("identity remove drops the sentence but keeps the sections", () => {
	const out = applyIdentityHandling(`${PI_IDENTITY}\n\n<rules>keep me</rules>`, "remove");
	assert.ok(!out.includes("You are an expert coding assistant"));
	assert.match(out, /<rules>keep me<\/rules>/);
});

// ── user configuration ─────────────────────────────────────────────────────

function tempAgentDir(): string {
	return mkdtempSync(join(tmpdir(), "pi-dsh-optimizer-"));
}

test("the default config is the built-in reasoning block under `replace`", () => {
	assert.equal(DEFAULT_IDENTITY_CONFIG.mode, "replace");
	assert.equal(DEFAULT_IDENTITY_CONFIG.text, IDENTITY_TEXT);
});

test("a missing config file yields the defaults and reports no error", () => {
	const dir = tempAgentDir();
	const loaded = loadIdentityConfig(dir);
	assert.equal(loaded.path, configFilePath(dir));
	assert.equal(loaded.error, undefined);
	assert.deepEqual(loaded.config, DEFAULT_IDENTITY_CONFIG);
});

test("saving round-trips mode, text and the model whitelist and creates a missing agent directory", () => {
	const dir = join(tempAgentDir(), "nested", "agent");
	const custom = { mode: "remove" as const, text: "CUSTOM IDENTITY\nsecond line", models: ["qwen*"] };
	saveIdentityConfig(dir, custom);
	assert.deepEqual(loadIdentityConfig(dir).config, custom);
});

test("a malformed config file falls back to defaults but surfaces the error", () => {
	const dir = tempAgentDir();
	writeFileSync(configFilePath(dir), "{ not json", "utf-8");
	const loaded = loadIdentityConfig(dir);
	assert.deepEqual(loaded.config, DEFAULT_IDENTITY_CONFIG);
	assert.ok(loaded.error, "the parse error must be reported, not swallowed");
});

test("an unknown mode falls back to replace and a bad text falls back to the default", () => {
	const dir = tempAgentDir();
	writeFileSync(configFilePath(dir), JSON.stringify({ mode: "sideways", text: "keep me", extra: 1 }), "utf-8");
	const loaded = loadIdentityConfig(dir);
	assert.equal(loaded.config.mode, "replace");
	assert.equal(loaded.config.text, "keep me");
	assert.equal(loaded.error, undefined);

	assert.deepEqual(normalizeIdentityConfig(null), DEFAULT_IDENTITY_CONFIG);
	assert.equal(normalizeIdentityConfig({ text: 42 }).text, DEFAULT_IDENTITY_CONFIG.text);
});
