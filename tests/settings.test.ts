/**
 * `/dsh-optimizer` end to end: a fake pi and a fake ctx drive the real command
 * handler, and the assertions are about what lands on disk.
 *
 * `identity-menu.ts` imports pi's runtime (`getAgentDir`, `DynamicBorder`), which
 * only resolves from pi's own module root — so these tests skip unless run from
 * the clean-room copy described in the `verify-pi-extension` skill. The
 * `await import(...)` inside each test is what keeps this file importable from
 * the plain project directory, where `npm test` must stay green.
 *
 * `PI_CODING_AGENT_DIR` is pointed at a temp directory per test, so the real
 * `~/.pi/agent/pi-dsh-optimizer.json` is never read or written.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { CONFIG_FILE_NAME, DEFAULT_IDENTITY_CONFIG } from "../src/adapter/config.ts";

const piRuntimeAvailable = await import("@earendil-works/pi-coding-agent").then(
	() => true,
	() => false,
);

const skip = piRuntimeAvailable
	? false
	: "pi's module root is not resolvable here — needs the clean-room node_modules symlink";

/** Menu labels are matched by prefix, so a reworded description cannot break a test. */
type MenuRule = string | undefined;

function scriptedSelect(rules: MenuRule[]) {
	const queue = [...rules];
	return async (_title: string, options: string[]): Promise<string | undefined> => {
		const rule = queue.shift();
		if (rule === undefined) return undefined;
		const hit = options.find((option) => option.startsWith(rule));
		assert.ok(hit, `no offered option starts with "${rule}"; offered: ${options.join(" | ")}`);
		return hit;
	};
}

function scriptedEditor(replies: (string | undefined)[]) {
	const queue = [...replies];
	return async (): Promise<string | undefined> => queue.shift();
}

function scriptedConfirm(replies: boolean[]) {
	const queue = [...replies];
	return async (): Promise<boolean> => queue.shift() ?? false;
}

interface Harness {
	ctx: ExtensionCommandContext;
	notified: { message: string; level?: string }[];
	agentDir: string;
}

/** A non-TUI ctx, so the flow goes through pi's built-in dialogs and never `custom()`. */
function harness(options: {
	menus?: MenuRule[];
	editors?: (string | undefined)[];
	confirms?: boolean[];
	assembled?: string;
}): Harness {
	const agentDir = mkdtempSync(join(tmpdir(), "pi-dsh-optimizer-agent-"));
	process.env.PI_CODING_AGENT_DIR = agentDir;

	const notified: { message: string; level?: string }[] = [];
	const ctx = {
		mode: "print",
		ui: {
			select: scriptedSelect(options.menus ?? []),
			editor: scriptedEditor(options.editors ?? []),
			confirm: scriptedConfirm(options.confirms ?? []),
			notify: (message: string, level?: string) => {
				notified.push({ message, level });
			},
			custom: async () => {
				throw new Error("custom() is a TUI-only path and must not run in non-TUI mode");
			},
		},
		getSystemPrompt: () => options.assembled ?? "PLAIN PROMPT with no pi identity sentence",
	} as unknown as ExtensionCommandContext;

	return { ctx, notified, agentDir };
}

async function runCommand(ctx: ExtensionCommandContext) {
	const { registerIdentityCommand } = await import("../src/ui/identity-menu.ts");
	const commands = new Map<string, { description: string; handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }>();
	registerIdentityCommand({
		registerCommand: (name: string, options: { description: string; handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }) => {
			commands.set(name, options);
		},
	} as never);

	const command = commands.get("dsh-optimizer");
	assert.ok(command, "the extension must register a `dsh-optimizer` command");
	return await command.handler("", ctx);
}

function readConfig(agentDir: string) {
	return JSON.parse(readFileSync(join(agentDir, CONFIG_FILE_NAME), "utf-8"));
}

function configExists(agentDir: string): boolean {
	try {
		readFileSync(join(agentDir, CONFIG_FILE_NAME), "utf-8");
		return true;
	} catch {
		return false;
	}
}

test("the command is registered with a description", { skip }, async () => {
	const { registerIdentityCommand } = await import("../src/ui/identity-menu.ts");
	const seen: { name?: string; description?: string } = {};
	registerIdentityCommand({
		registerCommand: (name: string, options: { description: string }) => {
			seen.name = name;
			seen.description = options.description;
		},
	} as never);
	assert.equal(seen.name, "dsh-optimizer");
	assert.ok(seen.description && seen.description.length > 0, "the command needs a description");
});

test("editing the text saves it and keeps the mode", { skip }, async () => {
	const { ctx, agentDir, notified } = harness({
		menus: ["Custom identity text"],
		editors: ["MY OWN IDENTITY\nsecond line"],
	});
	await runCommand(ctx);

	assert.deepEqual(readConfig(agentDir), { mode: "replace", text: "MY OWN IDENTITY\nsecond line" });
	assert.ok(notified.some((entry) => entry.message.includes("Identity text saved")));
});

test("a text edit and a mode change both persist, in that order", { skip }, async () => {
	const { ctx, agentDir } = harness({
		// The menu and the mode dialog share one `select`, so the mode label follows
		// the two menu picks in the order the real handler reaches them.
		menus: ["Custom identity text", "Identity sentence handling", "remove"],
		editors: ["KEEP THIS TEXT"],
	});
	await runCommand(ctx);

	assert.deepEqual(readConfig(agentDir), { mode: "remove", text: "KEEP THIS TEXT" });
});

test("the mode dialog writes the chosen mode and leaves the text alone", { skip }, async () => {
	const { ctx, agentDir, notified } = harness({ menus: ["Identity sentence handling", "keep"] });
	await runCommand(ctx);

	assert.deepEqual(readConfig(agentDir), { ...DEFAULT_IDENTITY_CONFIG, mode: "keep" });
	assert.ok(notified.some((entry) => entry.message.includes("Identity handling saved: keep")));
});

test("escaping the editor writes nothing at all", { skip }, async () => {
	const { ctx, agentDir } = harness({ menus: ["Custom identity text"], editors: [undefined] });
	await runCommand(ctx);

	assert.equal(configExists(agentDir), false, "esc must not create a config file");
});

test("escaping the menu ends the command without writing", { skip }, async () => {
	const { ctx, agentDir } = harness({ menus: [undefined] });
	await runCommand(ctx);

	assert.equal(configExists(agentDir), false);
});

test("an unchanged text is not written", { skip }, async () => {
	const { ctx, agentDir, notified } = harness({
		menus: ["Custom identity text"],
		editors: [DEFAULT_IDENTITY_CONFIG.text],
	});
	await runCommand(ctx);

	assert.equal(configExists(agentDir), false, "identical text should be a no-op");
	assert.ok(notified.some((entry) => entry.message.includes("unchanged")));
});

test("reset restores the defaults once confirmed, and does nothing when declined", { skip }, async () => {
	const declined = harness({ menus: ["Custom identity text", "Reset to defaults"], editors: ["SOMETHING ELSE"], confirms: [false] });
	await runCommand(declined.ctx);
	assert.equal(readConfig(declined.agentDir).text, "SOMETHING ELSE", "a declined reset must not touch the file");

	const accepted = harness({ menus: ["Reset to defaults"], confirms: [true] });
	await runCommand(accepted.ctx);
	assert.deepEqual(readConfig(accepted.agentDir), DEFAULT_IDENTITY_CONFIG);
});

test("the path entry reports the config file location", { skip }, async () => {
	const { ctx, agentDir, notified } = harness({ menus: ["Show the config file path"] });
	await runCommand(ctx);

	assert.ok(notified.some((entry) => entry.message === join(agentDir, CONFIG_FILE_NAME)));
});

test("preview applies the current config to the live assembled prompt", { skip }, async () => {
	const { ctx, notified } = harness({
		menus: ["Preview the released prompt"],
		assembled: "PLAIN PROMPT with no pi identity sentence",
	});
	await runCommand(ctx);

	const header = notified.find((entry) => entry.message.startsWith("mode="));
	assert.ok(header, "the preview must report the effective mode");
	assert.match(header.message, /mode=replace/);
	assert.match(header.message, /NOT matched/, "an unmatched prompt must be reported, not hidden");
});
