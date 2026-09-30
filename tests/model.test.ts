/**
 * The model activation gate: pure logic, no pi runtime is loaded.
 * Run with `node --test tests/*.test.ts` (node strips the types).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_IDENTITY_CONFIG, normalizeIdentityConfig } from "../src/adapter/config.ts";
import { modelHaystack, modelMatches, normalizePattern } from "../src/adapter/model.ts";

const DEFAULT_PATTERNS = DEFAULT_IDENTITY_CONFIG.models;

test("the default whitelist is DeepSeek-only", () => {
	assert.deepEqual(DEFAULT_PATTERNS, ["*deepseek*"]);
});

test("DeepSeek matches whatever the casing and flavour", () => {
	for (const id of ["deepseek-v4.1-flash", "DeepSeek-V4-Pro", "DEEPSEEK-V4-FLASH", "deepseek-v4-pro-0813"]) {
		assert.equal(modelMatches(DEFAULT_PATTERNS, { id }), true, id);
	}
});

test("a provider named deepseek is enough on its own", () => {
	assert.equal(modelMatches(DEFAULT_PATTERNS, { id: "v4.1-flash", provider: "deepseek" }), true);
	assert.equal(modelMatches(DEFAULT_PATTERNS, { id: "v4.1-flash", provider: "DEEPSEEK" }), true);
});

test("the display name counts as well", () => {
	assert.equal(modelMatches(DEFAULT_PATTERNS, { id: "custom-1", name: "DeepSeek V4.1 via proxy" }), true);
});

test("every other model is left completely alone", () => {
	for (const model of [
		{ id: "claude-opus-4.7", provider: "anthropic" },
		{ id: "gpt-5.6", provider: "openai" },
		{ id: "qwen3-max", provider: "qwen-token-plan" },
		{ id: "kimi-k2", name: "Kimi K2", provider: "kimi-coding" },
	]) {
		assert.equal(modelMatches(DEFAULT_PATTERNS, model), false, model.id);
	}
});

test("an unresolved model does not match — the plugin stays out of the way", () => {
	assert.equal(modelMatches(DEFAULT_PATTERNS, undefined), false);
	assert.equal(modelMatches(DEFAULT_PATTERNS, {}), false);
	assert.equal(modelHaystack(undefined), "");
	assert.equal(modelHaystack({ id: "", provider: "" }), "");
});

test("an empty list or a bare star hands the plugin back to every model", () => {
	assert.equal(modelMatches([], { id: "claude-opus-4.7" }), true);
	assert.equal(modelMatches(["*"], { id: "claude-opus-4.7" }), true);
	assert.equal(modelMatches(["**"], { id: "claude-opus-4.7" }), true);
});

test("patterns are case-insensitive and ignore the glob decoration", () => {
	assert.equal(normalizePattern("*DeepSeek*"), "deepseek");
	assert.equal(normalizePattern("  deepseek  "), "deepseek");
	assert.equal(modelMatches(["DEEPSEEK"], { id: "deepseek-v4-pro" }), true);
	assert.equal(modelMatches(["deepseek-v4-pro"], { id: "deepseek-v4-flash" }), false);
});

test("the whitelist survives a config round trip and falls back to the default", () => {
	assert.deepEqual(normalizeIdentityConfig({ models: ["qwen*"] }).models, ["qwen*"]);
	assert.deepEqual(normalizeIdentityConfig({}).models, DEFAULT_PATTERNS);
	assert.deepEqual(normalizeIdentityConfig({ models: "deepseek" }).models, DEFAULT_PATTERNS);
	assert.deepEqual(normalizeIdentityConfig({ models: ["a", 3, null, ""] }).models, ["a", ""]);
	assert.deepEqual(normalizeIdentityConfig({ models: [] }).models, []);
});
