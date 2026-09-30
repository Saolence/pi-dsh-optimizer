/**
 * Contract tests for the `str_replace_editor` tool — the tool the bootstrap
 * phase actually executes, and the one place this plugin writes to disk.
 *
 * `create` must never overwrite an existing file, every command is
 * absolute-path only, and the edit commands are line-oriented.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeStrReplaceEditor } from "../src/tools/str-replace-editor.ts";

const workspace = (): string => mkdtempSync(join(tmpdir(), "dsh-editor-"));

test("create writes a new file and builds the missing parent directories", async () => {
	const path = join(workspace(), "nested", "deep", "note.txt");
	const result = await executeStrReplaceEditor({ command: "create", path, file_text: "hello\n" });
	assert.equal(result, `New file created successfully at: ${path}`);
	assert.equal(readFileSync(path, "utf8"), "hello\n");
});

test("create refuses to overwrite an existing file", async () => {
	const path = join(workspace(), "keep.txt");
	writeFileSync(path, "original", "utf8");
	await assert.rejects(
		executeStrReplaceEditor({ command: "create", path, file_text: "clobbered" }),
		/Cannot overwrite files using command `create`\./,
	);
	assert.equal(readFileSync(path, "utf8"), "original");
});

test("create surfaces a filesystem error that is not 'already exists'", async () => {
	const blocker = join(workspace(), "blocker");
	writeFileSync(blocker, "not a directory", "utf8");
	await assert.rejects(
		executeStrReplaceEditor({ command: "create", path: join(blocker, "child.txt"), file_text: "x" }),
		/EEXIST|ENOTDIR/,
	);
});

test("a relative path is rejected", async () => {
	await assert.rejects(executeStrReplaceEditor({ command: "view", path: "note.txt" }), /is not an absolute path/);
});

test("str_replace rewrites the single occurrence", async () => {
	const path = join(workspace(), "code.ts");
	writeFileSync(path, "const a = 1;\n", "utf8");
	const result = await executeStrReplaceEditor({ command: "str_replace", path, old_str: "1", new_str: "2" });
	assert.equal(result, `The file ${path} has been edited successfully.`);
	assert.equal(readFileSync(path, "utf8"), "const a = 2;\n");
});

test("str_replace refuses an ambiguous or absent old_str", async () => {
	const path = join(workspace(), "code.ts");
	writeFileSync(path, "x\nx\n", "utf8");
	await assert.rejects(
		executeStrReplaceEditor({ command: "str_replace", path, old_str: "x", new_str: "y" }),
		/Multiple occurrences of old_str `x` in lines \[1, 2\]/,
	);
	await assert.rejects(
		executeStrReplaceEditor({ command: "str_replace", path, old_str: "nope", new_str: "y" }),
		/did not appear verbatim/,
	);
	assert.equal(readFileSync(path, "utf8"), "x\nx\n");
});

test("insert places new_str at the requested line", async () => {
	const path = join(workspace(), "code.ts");
	writeFileSync(path, "one\ntwo\n", "utf8");
	await executeStrReplaceEditor({ command: "insert", path, insert_line: 1, new_str: "middle" });
	assert.equal(readFileSync(path, "utf8"), "one\nmiddle\ntwo\n");
});

test("view numbers only the requested range", async () => {
	const path = join(workspace(), "code.ts");
	writeFileSync(path, "a\nb\nc\n", "utf8");
	const view = await executeStrReplaceEditor({ command: "view", path, view_range: [2, 3] });
	assert.match(view, /view_range=\[2, 3\]/);
	assert.match(view, /^ {5}2 {2}b$/m);
	assert.match(view, /^ {5}3 {2}c$/m);
	assert.equal(view.match(/^\s+\d+ {2}/gm)?.length, 2);
});
