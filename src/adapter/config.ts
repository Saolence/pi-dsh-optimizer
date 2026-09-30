/**
 * User configuration for the identity prompt this plugin injects.
 *
 * One file, global, next to pi's own `presets.json` / `settings.json`:
 *
 *     ~/.pi/agent/pi-dsh-optimizer.json
 *
 *     {
 *       "mode": "replace",   // keep | remove | replace
 *       "text": "..."        // what `replace` swaps pi's identity sentence for
 *     }
 *
 * There is deliberately no `enabled` flag: the released prompt is built by the
 * identity handling alone, so "off" and `mode: "keep"` would be the same state
 * under two names.
 *
 * This module is pure on purpose — it takes the agent directory as an argument
 * instead of importing pi's `getAgentDir()`, so the plain `node --test` suite
 * keeps running without the pi runtime. Callers pass `getAgentDir()`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { IDENTITY_TEXT, type IdentityMode } from "./prompt.ts";

/** The file name inside the agent directory. */
export const CONFIG_FILE_NAME = "pi-dsh-optimizer.json";

export interface IdentityConfig {
	/** keep → pi's sentence stays · remove → dropped · replace → swapped for `text`. */
	mode: IdentityMode;
	/** The replacement text. Empty under `replace` behaves as `remove`. */
	text: string;
}

export const DEFAULT_IDENTITY_CONFIG: IdentityConfig = {
	mode: "replace",
	text: IDENTITY_TEXT,
};

export function configFilePath(agentDir: string): string {
	return join(agentDir, CONFIG_FILE_NAME);
}

function isIdentityMode(value: unknown): value is IdentityMode {
	return value === "keep" || value === "remove" || value === "replace";
}

/** Field by field and forgiving: an unknown or malformed field falls back to default. */
export function normalizeIdentityConfig(raw: unknown): IdentityConfig {
	const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
	return {
		mode: isIdentityMode(source.mode) ? source.mode : DEFAULT_IDENTITY_CONFIG.mode,
		text: typeof source.text === "string" ? source.text : DEFAULT_IDENTITY_CONFIG.text,
	};
}

export interface LoadedIdentityConfig {
	config: IdentityConfig;
	path: string;
	/** Set when the file exists but could not be read or parsed — `config` is then the default. */
	error?: string;
}

/**
 * Read the config file. A missing file is normal and returns the defaults with
 * no error; a broken file returns the defaults *and* the parse error, so the UI
 * can say so instead of silently discarding the user's text.
 */
export function loadIdentityConfig(agentDir: string): LoadedIdentityConfig {
	const path = configFilePath(agentDir);
	if (!existsSync(path)) return { config: { ...DEFAULT_IDENTITY_CONFIG }, path };
	try {
		return { config: normalizeIdentityConfig(JSON.parse(readFileSync(path, "utf-8"))), path };
	} catch (error) {
		return { config: { ...DEFAULT_IDENTITY_CONFIG }, path, error: String(error) };
	}
}

/** Write the config file, creating the agent directory when needed. */
export function saveIdentityConfig(agentDir: string, config: IdentityConfig): void {
	const path = configFilePath(agentDir);
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(path, `${JSON.stringify({ mode: config.mode, text: config.text }, null, 2)}\n`, "utf-8");
}
