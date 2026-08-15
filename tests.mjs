/**
 * Unit tests for pi-router-mode core logic (ported from dsh-router-standard's
 * router.test.mjs). Run with: node --test tests.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyTask, bandOf, bandFor, personaFor, coreFor, parseMode, applyIdentity, guideFor,
  isComplexTask, isFlashModel, extractText, clamp01,
  MODE_SPEC, MODE_REACT, MODE_WEAK,
} from './router-core.ts';

// ── classification ──
test('classifyTask: react keywords win', () => {
  assert.equal(classifyTask('创建一个新游戏'), 1);
  assert.equal(classifyTask('build a website from scratch'), 1);
  assert.equal(classifyTask('implement a new feature'), 1);
});
test('classifyTask: spec keywords win', () => {
  assert.equal(classifyTask('帮我修复这个 bug'), 0);
  assert.equal(classifyTask('fix the broken test'), 0);
  assert.equal(classifyTask('排查一下这个报错'), 0);
});
test('classifyTask: ambiguous → weak', () => {
  assert.equal(classifyTask('随便聊聊'), 'weak');
  assert.equal(classifyTask(''), 'weak');
  assert.equal(classifyTask('你好'), 'weak');
});
test('classifyTask: mixed counts compare counts', () => {
  // 2 react hits vs 1 spec hit → react
  assert.equal(classifyTask('创建一个新网站 build it，然后优化一下'), 1);
});

// ── bands ──
test('bandOf: quantizes to stable regions', () => {
  assert.equal(bandOf(0), 'spec');
  assert.equal(bandOf(0.1), 'spec');
  assert.equal(bandOf(0.2), 'transition');
  assert.equal(bandOf(0.4), 'transition');
  assert.equal(bandOf(0.5), 'react');
  assert.equal(bandOf(1), 'react');
  assert.equal(bandOf(MODE_WEAK), 'weak');
});
test('bandFor: transition renders as mixed', () => {
  assert.equal(bandFor(0.3), 'mixed');
  assert.equal(bandFor(0), 'spec');
  assert.equal(bandFor(1), 'react');
});

// ── personas ──
test('personaFor: mode → persona', () => {
  assert.match(personaFor(MODE_SPEC, 'deepseek-v4-flash-0731'), /software engineer/);
  assert.match(personaFor(MODE_REACT, 'deepseek-v4-flash-0731'), /hands-on/);
  assert.match(personaFor(MODE_WEAK, 'deepseek-v4-flash-0731'), /build or fix/);
  assert.match(personaFor(MODE_WEAK, 'deepseek-v4-pro'), /build or fix/);
});
test('personaFor: zh lang returns Chinese persona', () => {
  assert.match(personaFor(MODE_SPEC, 'deepseek-v4-flash-0731', 'zh'), /软件工程师/);
  assert.match(personaFor(MODE_REACT, 'deepseek-v4-flash-0731', 'zh'), /实际交付/);
  assert.match(personaFor(MODE_WEAK, 'deepseek-v4-flash-0731', 'zh'), /构建或修复/);
  assert.match(personaFor(MODE_WEAK, 'deepseek-v4-pro', 'zh'), /构建或修复/);
});
test('personaFor: en default unchanged, zh flash/pro differ', () => {
  // default lang stays English (backward compatible)
  assert.match(personaFor(MODE_WEAK, 'deepseek-v4-flash-0731'), /build or fix/);
  assert.match(personaFor(MODE_WEAK, 'deepseek-v4-flash-0731', 'en'), /build or fix/);
  // zh flash and pro still differ (model-specific weak personas)
  assert.notEqual(personaFor(MODE_WEAK, 'deepseek-v4-flash', 'zh'), personaFor(MODE_WEAK, 'deepseek-v4-pro', 'zh'));
});
test('personaFor weak: flash vs pro differ', () => {
  assert.notEqual(personaFor(MODE_WEAK, 'deepseek-v4-flash'), personaFor(MODE_WEAK, 'deepseek-v4-pro'));
});
// ── core tools ──
test('coreFor: spec read-first, react write-first', () => {
  assert.deepEqual(coreFor(MODE_SPEC).slice(0, 2), ['read', 'edit']);
  assert.deepEqual(coreFor(MODE_REACT).slice(0, 3), ['read', 'write', 'edit']);
});

// ── parseMode ──
test('parseMode: band names', () => {
  assert.equal(parseMode('spec'), 0);
  assert.equal(parseMode('react'), 1);
  assert.equal(parseMode('weak'), 'weak');
  assert.equal(parseMode('mixed'), 0.3);
  assert.equal(parseMode('auto'), 'auto');
});
test('parseMode: numbers', () => {
  assert.equal(parseMode('100'), 1);
  assert.equal(parseMode('0'), 0);
  assert.equal(parseMode('0.5'), 0.5);
  assert.equal(parseMode('50'), 0.5);
  assert.equal(parseMode('garbage'), null);
});
test('parseMode: empty/whitespace → null (regression)', () => {
  assert.equal(parseMode(''), null);
  assert.equal(parseMode('   '), null);
  assert.equal(parseMode(' \t\n '), null);
});
test('parseMode: integer 1 is percent (0.01), react needs 100/1.0/react (regression)', () => {
  assert.equal(parseMode('1'), 0.01);
  assert.equal(parseMode('1.0'), 1);
  assert.equal(parseMode('100'), 1);
  assert.equal(parseMode('react'), 1);
});

// ── complex ──
test('isComplexTask: length or architecture keywords', () => {
  assert.ok(isComplexTask('x'.repeat(121)));
  assert.ok(isComplexTask('设计一个系统的架构'));
  assert.ok(!isComplexTask('修一下这个'));
});
test('guideFor: simple → weak guide, complex → deep guide (en)', () => {
  assert.match(guideFor('修一下这个', 'en'), /classify this task/);
  assert.match(guideFor('设计一个系统的架构', 'en'), /Think deeply about the architecture/);
  assert.match(guideFor('x'.repeat(121), 'en'), /Think deeply about the architecture/);
});
test('guideFor: zh localized', () => {
  assert.match(guideFor('修一下这个', 'zh'), /判断这个任务是构建还是修复/);
  assert.match(guideFor('设计一个系统的架构', 'zh'), /深入思考架构/);
  assert.ok(!guideFor('修一下这个', 'zh').includes('Router:'));
});
test('guideFor: default lang is en', () => {
  assert.match(guideFor('修一下这个'), /classify this task/);
});
test('WEAK_FLASH anchor uses find (pi tool), not glob (dsh tool)', () => {
  const flash = personaFor(MODE_WEAK, 'deepseek-v4-flash-0731');
  const flashZh = personaFor(MODE_WEAK, 'deepseek-v4-flash-0731', 'zh');
  assert.ok(!flash.includes('grep/glob scans'), 'en anchor should not say glob');
  assert.ok(flash.includes('grep/find scans'), 'en anchor should say find');
  assert.ok(!flashZh.includes('grep/glob'), 'zh anchor should not say glob');
  assert.ok(flashZh.includes('grep/find'), 'zh anchor should say find');
});

// ── helpers ──
test('isFlashModel', () => {
  assert.ok(isFlashModel('deepseek-v4-flash-0731'));
  assert.ok(!isFlashModel('deepseek-v4-pro'));
});
test('applyIdentity: remove official pi identity sentence', () => {
  const prompt = 'You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.\n\n\n\nAvailable tools:\n- read: ...';
  const out = applyIdentity(prompt);
  assert.ok(!out.includes('You are an expert coding assistant'));
  assert.ok(out.includes('Available tools:'));
  assert.ok(out.trim().startsWith('Available tools:'));
});
test('applyIdentity: replace with custom text', () => {
  const prompt = 'You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.\n\n\n\nAvailable tools:\n- read: ...';
  const out = applyIdentity(prompt, 'You are my coding agent.');
  assert.ok(out.includes('You are my coding agent.'));
  assert.ok(!out.includes('expert coding assistant'));
  assert.ok(out.trim().startsWith('You are my coding agent.'));
});
test('applyIdentity: non-matching prompt left untouched (tolerant)', () => {
  const prompt = 'Something entirely different.\n\nAvailable tools:';
  assert.equal(applyIdentity(prompt), prompt);
});
test('clamp01', () => {
  assert.equal(clamp01(2), 1);
  assert.equal(clamp01(-1), 0);
  assert.equal(clamp01('0.5'), 0.5);
  assert.equal(clamp01('x'), 0);
});
test('extractText', () => {
  assert.equal(extractText({ content: ['a', { text: 'b' }] }), 'a b');
  assert.equal(extractText({ content: [] }), '');
  assert.equal(extractText(null), '');
});
