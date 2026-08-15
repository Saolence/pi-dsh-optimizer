/**
 * router-core: reasoning-mode routing logic (ported from dsh-router-standard).
 *
 * BEHAVIORAL REALITY (measured on deepseek-v4): model behavior along the
 * react↔spec axis collapses into THREE stable regions, not a continuum —
 * spec [0, 0.15], a transition band [0.2, 0.45] (unstable mix, avoid), and
 * react [0.5, 1.0]. The numeric interface maps onto three behavior bands.
 *
 * FOURTH MODE — weak (internal routing): P8/P11 show a weak-persona domain
 * where the model routes itself from the task. The optimal weak persona is
 * model-specific (P11, n=3):
 *   - pro:   spec sentence + few-shot routing instruction (w6, +5.00)
 *   - flash: neutral + explicit "classify then act" instruction (w7, +5.67)
 */

export const MODE_SPEC = 0
export const MODE_MIXED = 0.3
export const MODE_REACT = 1
export const MODE_WEAK = 'weak'

export type PersonaLang = 'en' | 'zh';

const SPEC_PERSONA = 'You are a helpful software engineer assistant.'
const SPEC_PERSONA_ZH = '你是一名乐于助人的软件工程师助手。'

const MIXED_PERSONA =
  'You are a helpful software engineer assistant.\n'
  + 'Work directly: prefer writing or editing code over describing plans. '
  + 'Verify your changes by reading and running them.'
const MIXED_PERSONA_ZH =
  '你是一名乐于助人的软件工程师助手。\n'
  + '直接动手：优先编写或修改代码，而不是描述计划。'
  + '通过阅读和运行来验证你的改动。'

const REACT_PERSONA =
  'You are a hands-on software engineer who delivers working output fast.\n'
  + 'Work directly: write or edit code, then verify it by reading and running. '
  + 'Keep the loop tight — produce, verify, fix — and do not build test '
  + 'harnesses, scaffolding, or ceremony the user did not ask for. '
  + 'Finish with a usable deliverable and a short summary.'
const REACT_PERSONA_ZH =
  '你是一名注重实际交付的软件工程师，快速产出可用的成果。\n'
  + '直接动手：编写或修改代码，然后通过阅读和运行来验证。'
  + '保持紧凑的循环——产出、验证、修复——不要构建用户没有要求的'
  + '测试框架（test harnesses）、脚手架（scaffolding）或仪式（ceremony）。'
  + '最后交付可用的成果和简短总结。'

/** Weak (internal-routing) personas — model-specific optimum (P11/P24). */
const WEAK_PRO =
  'You are a helpful software engineer assistant.\n'
  + 'Before acting, decide the task type (build or fix) and adopt the matching '
  + 'style: build → hands-on production; fix → inspect-and-plan.'
const WEAK_PRO_ZH =
  '你是一名乐于助人的软件工程师助手。\n'
  + '行动前先判断任务类型（构建或修复），并采用匹配的风格：'
  + '构建 → 直接动手产出；修复 → 先检查再规划。'

const WEAK_FLASH =
  'You are a helpful assistant.\n'
  + 'Before acting, decide the task type (build or fix) and adopt the matching '
  + 'style: build → hands-on production; fix → inspect-and-plan.\n'
  + 'Before acting, briefly review what you have already done in this session and continue from where you left off; do not repeat completed steps. Do not run environment checks (echo, whoami, uname, node --version, date) or exhaustive grep/find scans.'
const WEAK_FLASH_ZH =
  '你是一名乐于助人的助手。\n'
  + '行动前先判断任务类型（构建或修复），并采用匹配的风格：'
  + '构建 → 直接动手产出；修复 → 先检查再规划。\n'
  + '行动前先简要回顾本会话已完成的工作，并从上次停止的地方继续；'
  + '不要重复已完成步骤。不要运行环境检查（echo、whoami、uname、node --version、date）'
  + '或进行穷举式的 grep/find 扫描。'
/** Complexity heuristic: long or architecturally-worded tasks are COMPLEX. */
const COMPLEX_RE = /(重构|架构|全面|详细|设计|系统|优化|分析|survey|overview|architecture|refactor|comprehensive|detailed|design|system|optimize|analyze)/i
// ── near-field routing guidance (P14/P16/P17/P19/P20) ─────────────────────
// Inserted right after each real user message in weak mode. Simple tasks get
// fast-convergence guidance; complex tasks get deep-exploration guidance.
const GUIDE_WEAK_EN =
  '\nInstruction: classify this task (build or fix) now, then adopt the matching style — build: direct production; fix: inspect-first. Think deeply first, then commit and act.'
const GUIDE_DEEP_EN =
  '\nInstruction: classify this task (build or fix) now, then adopt the matching style — build: direct production; fix: inspect-first. Think deeply about the architecture, edge cases, and integration points. Do not spend reasoning on the environment or tooling. Produce when your information is complete. End each reasoning block with a decision or an information need.'
const GUIDE_WEAK_ZH =
  '\n指令：现在判断这个任务是构建还是修复，然后采用匹配的风格——构建：直接产出；修复：先检查。先深入思考，锁定决策后再行动。'
const GUIDE_DEEP_ZH =
  '\n指令：现在判断这个任务是构建还是修复，然后采用匹配的风格——构建：直接产出；修复：先检查。深入思考架构、边界情况和集成点。不要把推理浪费在环境或工具上。信息完整后再产出。每个推理块以决策或信息需求结尾。'

/** Pick the near-field guide for a task text, in the requested language. */
export function guideFor(text: string, lang: PersonaLang = 'en'): string {
  const complex = isComplexTask(text)
  if (lang === 'zh') return complex ? GUIDE_DEEP_ZH : GUIDE_WEAK_ZH
  return complex ? GUIDE_DEEP_EN : GUIDE_WEAK_EN
}

/** Complexity heuristic: long or architecturally-worded tasks are COMPLEX. */
export function isComplexTask(text: string): boolean {
  return typeof text === 'string' && (text.length > 120 || COMPLEX_RE.test(text))
}

/**
 * Rewrite the "Available tools:" section of a pi system prompt to only the
 * given tool names. Tolerant: if the section can't be matched (pi reworded
 * the template), the prompt is returned unchanged — no harm.
 */
const TOOLS_SECTION_RE = /(Available tools:\n)([\s\S]*?)(\n\nIn addition to the tools above)/
export function narrowToolSection(base: string, keep: string[]): string {
  const m = base.match(TOOLS_SECTION_RE)
  if (!m) return base
  const keepSet = new Set(keep)
  const lines = m[2]
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '))
    .filter((l) => {
      const name = l.slice(2).split(':')[0].trim()
      return keepSet.has(name)
    })
  const list = lines.length > 0 ? lines.join('\n') : '(none)'
  return base.replace(TOOLS_SECTION_RE, `$1${list}$3`)
}

/**
 * Map legacy tool names to equivalents present in the running pi:
 * 'edit' → 'replace' (pi 0.84+ renamed the editor tool). Unknown names pass
 * through unchanged and are filtered out later by the caller.
 */
export function adaptToolNames(core: string[], available: string[]): string[] {
  const avail = new Set(available)
  return core.map((n) =>
    n === 'edit' && !avail.has('edit') && avail.has('replace') ? 'replace' : n
  )
}

/** True when the routed model id is a Flash-family model. */
export function isFlashModel(modelId: string | undefined): boolean {
  return typeof modelId === 'string' && /flash/i.test(modelId)
}

/** Quantize a mode to one of the four measured behavior bands. */
export function bandOf(mode: number | string): 'spec' | 'transition' | 'react' | 'weak' {
  if (mode === MODE_WEAK) return 'weak'
  const m = clamp01(mode)
  if (m < 0.2) return 'spec'
  if (m < 0.5) return 'transition'
  return 'react'
}

/** Persona for a mode; weak picks the model-specific internal-routing text. */
export function personaFor(mode: number | string, modelId: string | undefined, lang: PersonaLang = 'en'): string {
  const zh = lang === 'zh';
  switch (bandOf(mode)) {
    case 'spec': return zh ? SPEC_PERSONA_ZH : SPEC_PERSONA
    case 'transition': return zh ? MIXED_PERSONA_ZH : MIXED_PERSONA
    case 'weak': {
      const flash = isFlashModel(modelId);
      return zh
        ? (flash ? WEAK_FLASH_ZH : WEAK_PRO_ZH)
        : (flash ? WEAK_FLASH : WEAK_PRO)
    }
    default: return zh ? REACT_PERSONA_ZH : REACT_PERSONA
  }
}

/** First-turn core tools (pi tool names; bash added by the plugin). */
export function coreFor(mode: number | string): string[] {
  switch (bandOf(mode)) {
    case 'spec': return ['read', 'edit', 'find', 'grep'] // read-first
    case 'transition': return ['read', 'edit', 'write', 'find', 'grep'] // union
    default: return ['read', 'write', 'edit'] // write-first
  }
}

/** Human-readable band name for a mode value. */
export function bandFor(mode: number | string): string {
  const b = bandOf(mode)
  return b === 'transition' ? 'mixed' : b
}

/** Test-suppression strength for a mode (informational). */
export function testinessFor(mode: number | string): string {
  switch (bandOf(mode)) {
    case 'react': return 'suppressed'
    case 'spec': return 'normal'
    default: return 'light'
  }
}

const REACT_RE = /(开发|创建|写一个|生成|从零|做一个|游戏|网页|网站|构建|新项目|搭建|实现|做出|上线|落地|脚本|工具|应用|build|create|develop|generate|implement|make a|new project)/gi
const SPEC_RE = /(修复|修一下|调试|重构|维护|排查|报错|出错|崩溃|优化|审查|review|fix|debug|refactor|maintain|repair|broken|break|为什么|异常|故障|迁移|升级|兼容)/gi

function countHits(regex: RegExp, text: string): number {
  return [...text.matchAll(regex)].length
}

/**
 * Classify a task text into a mode. Clear keyword evidence picks a stable
 * band (1 react / 0 spec); AMBIGUOUS or unmatched text returns 'weak'.
 */
export function classifyTask(text: string): number | 'weak' {
  if (!text) return 'weak'
  const react = countHits(REACT_RE, text)
  const spec = countHits(SPEC_RE, text)
  if (react > spec) return 1
  if (spec > react) return 0
  return 'weak'
}

function textOfParts(parts: unknown[]): string {
  return parts
    .map((c) => (typeof c === 'string' ? c : ((c as { text?: string })?.text ?? '')))
    .join(' ')
}

/**
 * Extract plain text from a message-content payload, tolerating every shape pi
 * hands to extension events: a bare string, a TextContent[] array, or an object
 * wrapping either (`{ content: ... }`). Returns '' for anything else.
 */
export function extractText(data: unknown): string {
  if (typeof data === 'string') return data
  if (Array.isArray(data)) return textOfParts(data)
  if (!data || typeof data !== 'object') return ''
  const content = (data as { content?: unknown }).content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return textOfParts(content)
  return ''
}

const GUIDE_PREFIXES = ['指令：', 'Instruction:']

/** True when a text is one of the injected routing guides (idempotency guard). */
export function isGuideText(text: string): boolean {
  const t = (text ?? '').trim()
  return GUIDE_PREFIXES.some((p) => t.startsWith(p))
}

/**
 * Remove or replace pi's official identity sentence in the base system prompt.
 * Exact match with tolerant fallback: if pi ever rewords the sentence, the
 * regex misses and the prompt is left untouched (no harm).
 */
const OFFICIAL_IDENTITY_RE =
  /You are an expert coding assistant operating inside pi, a coding agent harness\.[\s\S]*?writing new files\.\n+/;

export function applyIdentity(prompt: string, customText?: string): string {
  const replaced = prompt.replace(OFFICIAL_IDENTITY_RE, (match) => {
    if (customText) return `${customText.trim()}\n\n`;
    return ""; // remove: drop the sentence and its trailing blank lines
  });
  return replaced === prompt ? prompt : replaced;
}


export function clamp01(v: unknown): number {
  return Math.min(1, Math.max(0, Number(v) || 0))
}

/**
 * Parse a user/agent-supplied mode token: number 0-100, 0.0-1.0, or a band name.
 *
 * Integer tokens are interpreted as PERCENT (0-100) — `parseMode("100")` = 1,
 * `parseMode("1")` = 0.01. To request the react end directly, pass `"react"`,
 * `"1.0"`, or `"100"`. Empty/whitespace tokens and non-numeric garbage return
 * null (never silently fall back to spec).
 */
export function parseMode(token: unknown): number | 'weak' | 'auto' | null {
  if (token === undefined || token === null) return null
  const t = String(token).trim().toLowerCase()
  if (!t) return null // 空串/纯空白 → invalid, not spec
  if (t === 'auto') return 'auto'
  if (t === 'weak' || t === 'router') return 'weak'
  if (t === 'spec' || t === 'spec-lean') return 0
  if (t === 'balanced' || t === 'mixed') return 0.3
  if (t === 'react' || t === 'react-lean') return 1
  const n = Number(t)
  if (!Number.isFinite(n)) return null
  if (t.includes('.')) return clamp01(n)
  return clamp01(n / 100)
}
