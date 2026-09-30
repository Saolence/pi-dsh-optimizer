/**
 * `/dsh-optimizer` — every option of the injected identity prompt, each one
 * behind its own dialog.
 *
 * The menu skeleton follows `examples/extensions/preset.ts` (a `ctx.ui.custom`
 * panel built from `Container` + `SelectList`, styled through the extension
 * theme). The editing dialogs are pi's own built-ins (`select`, `confirm`,
 * `editor`), so interactive and RPC clients both work; only the read-only
 * preview needs a custom component, and non-TUI modes fall back to a
 * notification there.
 *
 * Nothing is ever edited by hand on a JSON blob held in memory: every action
 * loads the file, and `saveIdentityConfig` is the only writer. The config is
 * re-read on each action, so an edit made in another window is not clobbered.
 */

import {
	DynamicBorder,
	getAgentDir,
	type ExtensionAPI,
	type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { Container, SelectList, Text, matchesKey, type SelectItem } from "@earendil-works/pi-tui";
import {
	DEFAULT_IDENTITY_CONFIG,
	configFilePath,
	loadIdentityConfig,
	saveIdentityConfig,
	type IdentityConfig,
} from "../adapter/config.ts";
import { applyIdentityHandling, type IdentityMode } from "../adapter/prompt.ts";

type MenuValue = "text" | "mode" | "preview" | "reset" | "path";

/** How many prompt lines the preview pages through before it stops. */
const PREVIEW_LINE_CAP = 200;

const MODE_OPTIONS: readonly { mode: IdentityMode; label: string }[] = [
	{ mode: "replace", label: "replace — swap pi's sentence for your text (default)" },
	{ mode: "remove", label: "remove — drop pi's sentence and add nothing" },
	{ mode: "keep", label: "keep — leave pi's sentence untouched" },
];

function modeOption(mode: IdentityMode): { mode: IdentityMode; label: string } {
	return MODE_OPTIONS.find((option) => option.mode === mode) ?? MODE_OPTIONS[0]!;
}

function textSummary(config: IdentityConfig): string {
	if (config.text === DEFAULT_IDENTITY_CONFIG.text) return "built-in reasoning style";
	const firstLine = config.text.trim().split("\n")[0] ?? "";
	const clipped = firstLine.length > 48 ? `${firstLine.slice(0, 45)}...` : firstLine;
	return `${config.text.length} chars · "${clipped || "(empty)"}"`;
}

export function registerIdentityCommand(pi: ExtensionAPI): void {
	pi.registerCommand("dsh-optimizer", {
		description: "Configure the identity prompt this extension injects",
		handler: async (_args, ctx) => {
			await runSettings(ctx);
		},
	});
}

/** Menu loop: pick an option, run its dialog, show the menu again. */
async function runSettings(ctx: ExtensionCommandContext): Promise<void> {
	const agentDir = getAgentDir();
	const path = configFilePath(agentDir);

	const initial = loadIdentityConfig(agentDir);
	if (initial.error) {
		ctx.ui.notify(`Config file unreadable — using defaults. ${initial.error}`, "warning");
	}
	let config = initial.config;

	for (;;) {
		const value = await pickMenu(ctx, config, path);
		if (!value) return;

		if (value === "text") {
			config = (await editText(ctx, agentDir, config)) ?? config;
		} else if (value === "mode") {
			config = (await editMode(ctx, agentDir, config)) ?? config;
		} else if (value === "preview") {
			await showPreview(ctx, config);
		} else if (value === "reset") {
			config = (await reset(ctx, agentDir, config)) ?? config;
		} else {
			ctx.ui.notify(path, "info");
		}
	}
}

function menuItems(config: IdentityConfig, path: string): SelectItem[] {
	return [
		{
			value: "text",
			label: "Custom identity text",
			description: `${textSummary(config)} · opens a multi-line editor`,
		},
		{
			value: "mode",
			label: "Identity sentence handling",
			description: modeOption(config.mode).label,
		},
		{
			value: "preview",
			label: "Preview the released prompt",
			description: "how pi's assembled prompt looks after this config is applied",
		},
		{
			value: "reset",
			label: "Reset to defaults",
			description: "mode replace + the built-in reasoning style",
		},
		{
			value: "path",
			label: "Show the config file path",
			description: path,
		},
	];
}

async function pickMenu(
	ctx: ExtensionCommandContext,
	config: IdentityConfig,
	path: string,
): Promise<MenuValue | undefined> {
	const items = menuItems(config, path);

	// Non-TUI clients (RPC) can forward the plain selector but not a custom
	// component, so hand them the same options as a flat list.
	if (ctx.mode !== "tui") {
		const chosen = await ctx.ui.select("pi-dsh-optimizer — identity prompt", items.map((item) => item.label));
		return chosen ? (items.find((item) => item.label === chosen)?.value as MenuValue | undefined) : undefined;
	}

	return await ctx.ui.custom<MenuValue | undefined>((tui, theme, _kb, done) => {
		const container = new Container();
		container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
		container.addChild(new Text(theme.fg("accent", theme.bold("pi-dsh-optimizer — identity prompt"))));

		const list = new SelectList(items, Math.min(items.length, 10), {
			selectedPrefix: (text) => theme.fg("accent", text),
			selectedText: (text) => theme.fg("accent", text),
			description: (text) => theme.fg("muted", text),
			scrollInfo: (text) => theme.fg("dim", text),
			noMatch: (text) => theme.fg("warning", text),
		});
		list.onSelect = (item) => done(item.value as MenuValue);
		list.onCancel = () => done(undefined);
		container.addChild(list);

		container.addChild(new Text(theme.fg("dim", "↑↓ navigate · enter open · esc close")));
		container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));

		return {
			render(width: number) {
				return container.render(width);
			},
			invalidate() {
				container.invalidate();
			},
			handleInput(data: string) {
				list.handleInput(data);
				tui.requestRender();
			},
		};
	});
}

/** Multi-line editor dialog. Returns the new config, or undefined when unchanged. */
async function editText(
	ctx: ExtensionCommandContext,
	agentDir: string,
	config: IdentityConfig,
): Promise<IdentityConfig | undefined> {
	const next = await ctx.ui.editor("Identity text — replaces pi's official identity sentence", config.text);
	if (next === undefined) return undefined; // esc: leave the file alone
	if (next === config.text) {
		ctx.ui.notify("Identity text unchanged", "info");
		return undefined;
	}

	const saved: IdentityConfig = { ...config, text: next };
	saveIdentityConfig(agentDir, saved);
	if (saved.mode === "replace" && !saved.text.trim()) {
		ctx.ui.notify("Saved, but the text is empty — `replace` now behaves like `remove`.", "warning");
	} else {
		ctx.ui.notify(`Identity text saved (${next.length} chars)`, "info");
	}
	return saved;
}

async function editMode(
	ctx: ExtensionCommandContext,
	agentDir: string,
	config: IdentityConfig,
): Promise<IdentityConfig | undefined> {
	const chosen = await ctx.ui.select(
		"Identity sentence handling",
		MODE_OPTIONS.map((option) => option.label),
	);
	if (!chosen) return undefined;

	const option = MODE_OPTIONS.find((entry) => entry.label === chosen);
	if (!option || option.mode === config.mode) return undefined;

	const saved: IdentityConfig = { ...config, mode: option.mode };
	saveIdentityConfig(agentDir, saved);
	ctx.ui.notify(`Identity handling saved: ${option.mode}`, "info");
	return saved;
}

async function reset(
	ctx: ExtensionCommandContext,
	agentDir: string,
	config: IdentityConfig,
): Promise<IdentityConfig | undefined> {
	const confirmed = await ctx.ui.confirm(
		"Reset to defaults",
		"Restore mode `replace` with the built-in identity text? Your current text is discarded.",
	);
	if (!confirmed) return undefined;

	saveIdentityConfig(agentDir, DEFAULT_IDENTITY_CONFIG);
	ctx.ui.notify("pi-dsh-optimizer reset to defaults", "info");
	return { ...config, ...DEFAULT_IDENTITY_CONFIG };
}

interface Preview {
	header: string;
	lines: string[];
}

/**
 * Apply the config to the prompt pi has actually assembled for this session, so
 * the preview shows the real thing rather than a copy of the config.
 */
function buildPreview(assembled: string, config: IdentityConfig): Preview {
	const handled = applyIdentityHandling(assembled, config.mode, config.text);
	const matched = handled !== assembled;
	const state =
		config.mode === "keep"
			? "pi's sentence kept as-is"
			: matched
				? "pi's sentence matched"
				: "pi's sentence NOT matched — prompt left untouched (pi may have reworded it)";
	return {
		header: `mode=${config.mode} · text=${config.text.trim().length} chars · ${state}`,
		lines: handled.split("\n"),
	};
}

async function showPreview(ctx: ExtensionCommandContext, config: IdentityConfig): Promise<void> {
	const preview = buildPreview(ctx.getSystemPrompt(), config);

	if (ctx.mode !== "tui") {
		ctx.ui.notify(preview.header, "info");
		return;
	}

	const shown = preview.lines.slice(0, PREVIEW_LINE_CAP);
	await ctx.ui.custom<void>((tui, theme, _kb, done) => {
		const container = new Container();
		let top = 0;

		const pageSize = () => Math.max(4, tui.terminal.rows - 9);
		const maxTop = () => Math.max(0, shown.length - pageSize());
		const render = () => {
			const size = pageSize();
			const end = Math.min(top + size, shown.length);
			container.clear();
			container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
			container.addChild(new Text(theme.fg("accent", theme.bold("Released prompt preview"))));
			container.addChild(new Text(theme.fg("muted", preview.header)));
			for (let index = top; index < end; index++) {
				container.addChild(new Text(shown[index] ?? ""));
			}
			const capNote =
				preview.lines.length > PREVIEW_LINE_CAP
					? ` · first ${PREVIEW_LINE_CAP} of ${preview.lines.length} lines`
					: "";
			container.addChild(
				new Text(theme.fg("dim", `lines ${top + 1}-${end}/${shown.length}${capNote} · ↑↓/space scroll · esc close`)),
			);
			container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
		};
		render();

		return {
			render(width: number) {
				return container.render(width);
			},
			invalidate() {
				container.invalidate();
			},
			handleInput(data: string) {
				const size = pageSize();
				if (matchesKey(data, "escape") || matchesKey(data, "return")) {
					done();
					return;
				}
				if (matchesKey(data, "up") || data === "k") top = Math.max(0, top - 1);
				else if (matchesKey(data, "down") || data === "j") top = Math.min(maxTop(), top + 1);
				else if (matchesKey(data, "pageUp")) top = Math.max(0, top - size);
				else if (matchesKey(data, "pageDown") || data === " ") top = Math.min(maxTop(), top + size);
				else return;
				render();
				tui.requestRender();
			},
		};
	});
}
