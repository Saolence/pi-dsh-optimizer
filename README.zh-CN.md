# pi-dsh-optimizer

> **给 pi 的"自动换挡器"** —— 它根据你说的话，自动帮 AI 选一种最合适的干活
> 方式（档位），然后自动切换。不需要你手动配置。

[![npm version](https://img.shields.io/npm/v/pi-dsh-optimizer.svg)](https://www.npmjs.com/package/pi-dsh-optimizer)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Pi package](https://img.shields.io/badge/pi-package-blue.svg)](https://pi.dev/packages/pi-dsh-optimizer)

从 [dsh-router-standard](https://github.com/yjh051108/dsh-router-standard)
（[dsh-routing-suite](https://github.com/yjh051108/dsh-routing-suite) 套装中的路由预设）移植。

---

## 目录

- [快速上手](#快速上手)
- [它有什么用（30 秒看懂）](#它有什么用30-秒看懂)
- [四种模式](#四种模式)
- [实测效果](#实测效果同模型不同档)
- [工作原理（深入）](#工作原理深入)
- [配置参考](#配置参考)
- [常见问题 FAQ](#常见问题-faq)
- [更新日志](#更新日志)
- [开发](#开发)
- [文件结构](#文件结构)
- [证据与致谢](#证据与致谢)
- [许可](#许可)

---

## 快速上手

从 GitHub 或 npm 安装：

```bash
# GitHub（推荐，始终最新提交）
pi install git:github.com/Saolence/pi-dsh-optimizer

# 或 npm（已发布版本）
pi install npm:pi-dsh-optimizer
```

装好即可用——插件会注册 3 个工具、注入对应人格、自动给每个会话路由档位。
验证是否生效：

```
pi_dsh_status
```

普通聊天会话应看到类似 `mode=weak (band=weak)` 的输出，以及 `lang=en` 或
`lang=zh`（取决于你的配置）。

---

## 它有什么用（30 秒看懂）

你说话，它判断你要"**干活**"还是"**查问题**"，然后给 AI 换对应的档位：

| 你说的话 | 换的档 | AI 的表现 |
|---|---|---|
| "帮我做个网站 / 写个脚本" | 🚀 react（实干） | 直接写代码、直接跑，少废话 |
| "帮我修个 bug / 排查报错" | 🔍 spec（分析） | 先读代码、想清楚、再动手 |
| 含糊不清 / 随便聊聊 / 其他 | 🤔 weak（自判断） | AI 自己看着办，每轮都判断 |

### 具体干 4 件事

1. **换人格** —— 按档位给 AI 换工作风格，且注入在系统提示词**最开头**
   （首因效应：开头的指令模型注意力最强，还能形成跨轮稳定的缓存前缀）。
2. **先给少工具** —— 第一轮只暴露核心工具（`read`、`write`、`edit` + `bash`），
   免得 AI 被一大堆工具搞乱。
3. **首轮后放开** —— 第一轮对话结束后（无论是否调用过工具），全部工具解锁，之后不再干预。
4. **状态不丢** —— 档位从会话推导，重载、恢复都不丢。手动覆盖按会话保留；
   配置选择持久化到 `~/.pi/agent/pi-dsh-optimizer.json`。

### 两个手动工具

| 工具 | 干嘛的 | 怎么用 |
|---|---|---|
| `pi_dsh_status` | 看当前档位、带宽、人格、语言、覆盖状态 | 直接调用，无参数 |
| `pi_dsh_mode` | 手动换档 | 传 `spec` / `react` / `weak` / `mixed`、数字、或 `auto` 恢复自动 |

> 注意：`pi_dsh_mode` 的数字按**百分比**理解（0-100）。`100` = react 档，
> `1` = 0.01（接近 spec）。想直说就传名字：`spec` / `react` / `weak` /
> `mixed`，最不容易错。

### 两个斜杠命令

| 命令 | 干嘛的 |
|---|---|
| `/pi-dsh-lang` | 查看 / 切换注入人格的语言（`zh` / `en`），持久化 |
| `/pi-dsh-identity` | 查看 / 控制 pi 官方身份句（`keep` / `remove` / `set <文本>`），持久化 |
| `/pi-dsh-guide` | 查看 / 开关 weak 档的近场路由引导（`on` / `off`），持久化 |

---

## 四种模式

像开车的档位：

| 模式 | 别名 | 什么时候用 | 工具集 | 测试策略 |
|---|---|---|---|---|
| `spec` | 分析档 | 修 bug、排查、重构 | 读优先 | 正常 |
| `react` | 实干档 | 从零建站、写脚本 | 写优先 | 抑制 |
| `mixed` | 混合档 | ⚠️ 尽量别用（不稳定过渡带） | 并集 | 轻度 |
| `weak` | 自判断档（默认） | 拿不准的时候 | 写优先 | 轻度 |

**为什么没有"连续调节"？** 实测真实模型发现：行为沿 react↔spec 轴只收敛成
**三个稳定区域**，不是连续旋钮——spec `[0, 0.15]`、过渡带 `[0.2, 0.45]`
（行为混乱，避开）、react `[0.5, 1.0]`。路由器只选稳定档位，刻意避开陷阱区。

**默认是 `weak`** —— 大多数对话都走它，让 AI 自己判断，你几乎感觉不到插件存在。

---

## 实测效果（同模型、不同档）

用同一个模型跑同一个任务，四个档位的结果肉眼可辨：

**简单任务（修个去重 bug）—— 都做对了，但方式不同：**

| 档位 | 怎么开头 | 风格 |
|---|---|---|
| spec | 先分析问题 | 解释最详细 |
| react | 先甩修复代码 | 代码优先，干脆 |
| mixed | 一句话点因 | 介于两者之间 |
| weak | 先给结论 | 讲得最全 |

**复杂任务（审查一套系统的架构）—— 差异更明显：**

| 档位 | 侧重 | 独到发现 |
|---|---|---|
| spec | 最深的技术审查 | 数据软删 + 单号不唯一 → 审计隐患 |
| react | 务实，给优先级 | 状态机驳回边界缺口 |
| mixed | 覆盖面最广 | 单进程可用性 + 字段缺并发保护 |
| weak | 合规顾问视角 | 明文数据、日志无防篡改、缺规则引擎 |

四个档位**不约而同**都找到了相同的三大核心风险（默认密钥 + 全开 CORS、
SQLite 并发、手工迁移）——区别只在**怎么表述、怎么排序**。

---

## 工作原理（深入）

### 1. 任务分类

会话读取你的**第一条用户消息**，按关键词计数分类：

- 实干词多于分析词 → `react`（1）
- 分析词多于实干词 → `spec`（0）
- 差不多或都没有 → `weak`（模型自判断）

实干词（非穷举）：`create`、`build`、`develop`、`generate`、`implement`、
`make a`、`new project`、`写一个`、`创建`、`开发`、`生成`、`构建`、`搭建`、
`实现`、`做一个`、`脚本`、`工具`、`应用`……

分析词：`fix`、`debug`、`refactor`、`maintain`、`repair`、`broken`、
`为什么`、`修复`、`调试`、`重构`、`排查`、`报错`、`崩溃`、`迁移`、`升级`……

含糊或空输入 → `weak`。分类只使用会话**第一条**用户消息，所以重载、恢复
都保持稳定。

### 2. 人格注入（`before_agent_start`）

人格放在**最前面**、pi 自带系统提示词之前，因为：

- 开头的指令模型注意力最强（首因效应）。
- 形成跨轮稳定的提示缓存前缀。

人格按 模式 × 语言 × 模型家族 选择：

| 模式 | Pro | Flash |
|---|---|---|
| spec | "software engineer assistant" | 相同 |
| react | 实干型 | 相同 |
| weak | spec 句 + 少样本路由指令（w6c, +4.67, P24） | 中性 + 分类 + 回顾/反跑题锚（w7, +5.67, P11） |

weak 档刻意**按模型区分**——实测表明 Pro 与 Flash 类模型的最优 weak 人格
不同。你不需要配置任何东西。

### 3. 首轮工具收窄

首次请求时，无论什么档位，可用工具集都收窄为核心工具
（`read`、`write`、`edit`、`bash`）。**第一轮对话结束后**，全部工具解锁，
路由器退场——无论首轮是否调用过工具。这避免在第一轮（印象最深的一轮）用庞大的工具面干扰模型。

### 4. 近场路由引导（`context` 事件，仅 weak 档）

weak 档下，每次 LLM 调用前，扩展会在**你的消息后面**悄悄插入一条简短的
"路由器"引导（近场 = 注意力最强）。有两个版本：

- **简单任务** → 短版引导：
  `路由器：现在判断这个任务是构建还是修复，然后采用匹配的风格……`
- **复杂任务**（长消息或架构类关键词）→ 深度引导：
  `路由器：……深入思考架构、边界情况和集成点。不要把推理浪费在环境或
  工具上。信息完整后再产出。每个推理块以决策或信息需求结尾。`

任务文本超过 120 字符，或命中架构类关键词（`architecture`、`refactor`、
`design`、`system`、`analyze`、`重构`、`架构`、`分析`……）就算"复杂"。

注入是**幂等**的：会跳过已经是引导的消息，也绝不会在同一个用户消息后面
叠加第二条引导——这一点很重要，因为 `context` 事件在一个回合里（含工具
循环）会在每次 LLM 调用前都触发。只有 weak 档有这条引导；强档位
（spec/react）不需要。

### 5. pi 官方身份句处理

pi 默认模板以 "You are an expert coding assistant operating inside pi..."
开头。路由器可以屏蔽、保留或替换它（默认**屏蔽**——你的 persona 已经定义
了"你是谁"）：

```
/pi-dsh-identity              # 查看当前模式
/pi-dsh-identity remove       # 屏蔽官方身份句（默认）
/pi-dsh-identity keep         # 保留官方身份句
/pi-dsh-identity set <文本>    # 替换为你自己的身份句
```

屏蔽是宽容的：精确匹配正则 + 兜底，万一 pi 以后改了措辞，提示词保持原样
（无副作用）。

### 6. 人格语言

默认英文。永久切换（持久化，重启后依然生效）：

```
/pi-dsh-lang        # 查看当前语言
/pi-dsh-lang zh     # 切换为中文人格
/pi-dsh-lang en     # 切回英文人格
```

优先级：**配置文件 > `PI_DSH_LANG` 环境变量 > 默认（en）**。两种语言承载
完全相同的档位语义（build/fix 路由、按模型区分的 weak 人格）。
`pi_dsh_status` 会显示当前语言（`lang=en` / `lang=zh`）。

### 映射自 dsh-router-standard

| dsh 机制 | pi 机制 |
|---|---|
| `system-prompt/assemble`（人格段） | `before_agent_start`（人格）+ `setActiveTools`（首轮工具） |
| `session/event` 近距引导 | `context` 事件（插到最近一条用户消息后） |
| `tools.register`（`dev_router_*`） | `pi.registerTool`（`pi_dsh_*`） |
| `session.events` 推导 | `ctx.sessionManager` 分支扫描 |

---

## 配置参考

| 配置项 | 位置 | 取值 | 默认 |
|---|---|---|---|
| 人格语言 | `/pi-dsh-lang`、配置文件或 `PI_DSH_LANG` | `zh` / `en` | `en` |
| 身份句处理 | `/pi-dsh-identity`、配置文件或 `PI_DSH_IDENTITY` | `keep` / `remove` / `replace` | `remove` |
| 会话模式覆盖 | `pi_dsh_mode`（按会话，不持久化） | `spec` / `react` / `weak` / `mixed`、0-100、`auto` | 自动分类 |
| 近场引导 | `/pi-dsh-guide`、配置文件 | `on` / `off` | `on` |

配置文件位置：`~/.pi/agent/pi-dsh-optimizer.json`：

```json
{
  "lang": "zh",
  "identity": "remove"
}
```

---

## 常见问题 FAQ

**`pi_dsh_status` 显示 `mode=spec`，但我想要 weak。**
档位从你的**第一条用户消息**推导。开个新会话，或用 `pi_dsh_mode weak` 强制
（下一次请求生效）。

**我的聊天记录里看不到"路由器：…"引导消息。**
这是正常的——`context` 事件只把引导注入**当次 LLM 调用的内存消息列表**，
不会持久化到会话日志。它是提词，不是对话记录。

**看到 `lang=en` 但想要中文。**
运行 `/pi-dsh-lang zh`。改动持久化，下一次请求生效。（配置文件优先于
`PI_DSH_LANG` 环境变量。）

**为什么一条短消息也收到了深度引导？**
复杂度启发式也匹配架构类关键词，而这些词可能藏在单词里（例如
`pi-dsh-optimizer` 含有 `optimize`）。无碍——最坏情况就是模型多想深了一点。

**和 `/compact` 或会话恢复兼容吗？**
兼容——模式会从分支的第一条用户消息重新推导，压缩和恢复都保持同一档位。

---

## 更新日志

**0.1.6** — 修复：GUIDE 注入从未真正生效。`extractText` 被以 `m.content`
（数组/字符串）调用，但它期望 `{content}`——永远返回 `""`，导致 weak 档
的近场引导从未插入。现在兼容所有 pi 内容形态，且注入幂等（跳过已注入的
引导；多工具回合不堆叠）。28 个单元测试。

**0.1.5** — 近场 GUIDE 本地化（经 `PI_DSH_LANG` 中英切换）+ 锚定工具名对齐
pi（`find`，非 `glob`）。

**0.1.4** — `/pi-dsh-identity` 命令，屏蔽/替换 pi 官方身份句。

**0.1.3** — `/pi-dsh-lang` 斜杠命令，持久化中英人格切换。

**0.1.2** — 经 `PI_DSH_LANG` 双语人格注入（中/英），人格前置排序。

**0.1.1** — 安装说明改为 GitHub/npm（`pi install`）方式。

---

## 开发

```sh
node --test tests.mjs   # 28 个用例：分类、带宽、人格、parseMode 回归、extractText 形态、引导检测、辅助函数
tsc --noEmit            # 类型检查
```

注意：测试要在源码目录跑——Node 26 拒绝在 `node_modules` 下做类型擦除，
在安装副本里跑会报 `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`。

## 文件结构

```
pi-dsh-optimizer/
├── package.json     pi 清单（npm/gallery 发布用）
├── index.ts         插件入口：生命周期钩子 + 3 个注册工具 + 2 个斜杠命令
├── router-core.ts   纯路由逻辑（零 pi 依赖，可单测）
├── tests.mjs        单元测试（28 个）
├── tsconfig.json    类型检查配置
├── README.md        本文档（英文）
└── README.zh-CN.md  本文档（中文）
```

---

## 证据与致谢

- 上游理论与实验：[dsh-router-standard](https://github.com/yjh051108/dsh-router-standard)
  （`docs/paper.md`、`docs/experiments.md`），基于
  [dsh-routing-suite](https://github.com/yjh051108/dsh-routing-suite) 的测量。
- Project2 评测数据：[xiaobright/modeltest](https://github.com/xiaobright/modeltest)
  （V4.1b，冻结）—— minimal 99/96, standard 91, PTC 92, anchored-standard 98/99。
- 两阶段锚定预设：[xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard)
  （MIT）。首轮锚定是其 `tool-bootstrap` 机制的插件级移植。
- DeepSeek Harness 官方 `minimal` 预设快照
  （`sends the exact RL prompt and schemas` 测试）—— spec 人格与 RL 对齐主张。

---

## 许可

MIT。
