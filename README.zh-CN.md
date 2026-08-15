# pi-dsh-optimizer

**给 pi 的"自动换挡器"插件。** 它会根据你说的话，自动帮 AI 选一种最合适的
干活方式（档位），不需要你手动配置。

从 [dsh-router-standard](https://github.com/yjh051108/dsh-router-standard)
（[dsh-routing-suite](https://github.com/yjh051108/dsh-routing-suite) 套装中的路由预设）移植。

---

## 快速上手

从 GitHub（或 npm）安装：

```bash
# GitHub（推荐，始终最新）
pi install git:github.com/Saolence/pi-dsh-optimizer

# 或 npm
pi install npm:pi-dsh-optimizer
```

装好后多出 3 个命令，其他什么都不用管，插件自动工作。

---

## 它有什么用（30 秒看懂）

你说话，它判断你要"**干活**"还是"**查问题**"，然后给 AI 换对应的档位：

| 你说的话 | 换的档 | AI 的表现 |
|---|---|---|
| "帮我做个网站 / 写个脚本" | 🚀 react（实干） | 直接写代码、直接跑，少废话 |
| "帮我修个 bug / 排查报错" | 🔍 spec（分析） | 先读代码、想清楚、再动手 |
| 含糊不清 / 随便聊聊 | 🤔 weak（自判断） | AI 自己看着办 |

### 具体干 4 件事

1. **换人格**——按档位给 AI 换工作风格（分析型 / 实干型 / 自判断型）。
2. **先给少工具**——第一轮只给核心工具，免得 AI 被一大堆工具搞乱。
3. **干活后放开**——你真正开始操作后，全部工具解锁，之后不再干预。
4. **状态不丢**——换档信息记在会话里，重载、恢复都不会丢。

### 三个手动工具

| 工具 | 干嘛的 | 怎么用 |
|---|---|---|
| `pi_dsh_status` | 看当前档位 | 直接调用，无参数 |
| `pi_dsh_mode` | 手动换档 | 传 `spec` / `react` / `weak` / `mixed`，或数字、或 `auto` 恢复自动 |
| `pi_dsh_subagent` | 派个小 AI 用别的档干活 | 传模式 + 任务；不影响当前会话 |

> 注意：`pi_dsh_mode` 的数字按**百分比**理解（0-100）。`100` = react 档，
> `1` = 0.01（接近 spec）。想直说就传名字：`spec` / `react` / `weak` /
> `mixed`，最不容易错。

---

## 实测效果（同模型、不同档）

用同一个模型跑同一个任务，四个档位的结果肉眼可辨：

**简单任务（修个去重 bug）——都做对了，但方式不同：**

| 档位 | 怎么开头 | 风格 |
|---|---|---|
| spec | 先分析问题 | 解释最详细 |
| react | 先甩修复代码 | 代码优先，干脆 |
| mixed | 一句话点因 | 介于两者之间 |
| weak | 先给结论 | 讲得最全 |

**复杂任务（审查一套系统的架构）——差异更明显：**

| 档位 | 侧重 | 独到发现 |
|---|---|---|
| spec | 最深的技术审查 | 数据软删 + 单号不唯一 → 审计隐患 |
| react | 务实，给优先级 | 状态机驳回边界缺口 |
| mixed | 覆盖面最广 | 单进程可用性 + 字段缺并发保护 |
| weak | 合规顾问视角 | 明文数据、日志无防篡改、缺规则引擎 |

四个档位**不约而同**都找到了相同的三大核心风险（默认密钥+全开 CORS、
SQLite 并发、手工迁移）——区别只在**怎么表述、怎么排序**。

---

## 四种模式详解（像开车的档位）

| 模式 | 别名 | 什么时候用 | 工具集 | 测试策略 |
|---|---|---|---|---|
| `spec` | 分析档 | 修 bug、排查、重构 | 读优先 | 正常 |
| `react` | 实干档 | 从零建站、写脚本 | 写优先 | 抑制 |
| `mixed` | 混合档 | ⚠️ 尽量别用 | 并集 | 轻度 |
| `weak` | 自判断档（默认） | 拿不准的时候 | 写优先 | 轻度 |

**为什么没有"连续调节"？** 实测发现模型行为不是旋钮——只有几个**稳定档位**，
中间那些"半计划半实干"的配置是**陷阱**（行为混乱、时好时坏）。所以
路由器只选稳定档位，避开陷阱区。

**默认是 `weak`**，大多数对话都走它——让 AI 自己判断，你几乎感觉不到插件存在。

---

## 工作原理（想了解机制再看）

1. **读取第一句话** → 关键词匹配 → 分档：
   - 实干词（创建/搭建/实现/build…）多于分析词 → react
   - 分析词（修复/排查/重构/fix…）多于实干词 → spec
   - 差不多或都没有 → weak
2. **首次请求时**：注入对应人格 + 只暴露核心工具。
3. **首次真实操作后**：全部工具解锁，不再干预。
4. **每轮悄悄引导**（仅 weak 档）：在你说完话后插入一句"先判断 build 还是
   fix 再动手"；任务复杂就换成深度引导（多想架构、别在环境上耗推理）。

**映射自 dsh-router-standard：**

| dsh 机制 | pi 机制 |
|---|---|
| `system-prompt/assemble`（人格段） | `before_agent_start`（人格）+ `setActiveTools`（首轮工具） |
| `session/event` 近距引导 | `context` 事件（插到最近一条用户消息后） |
| `tools.register`（`dev_router_*`） | `pi.registerTool`（`pi_dsh_*`） |
| `session.events` 推导 | `ctx.sessionManager` 分支扫描 |

**人格语言**：默认英文。用斜杠命令永久切换（写入
`~/.pi/agent/pi-dsh-optimizer.json`，重启后依然生效）：

```
/pi-dsh-lang        # 查看当前语言
/pi-dsh-lang zh     # 切换为中文人格
/pi-dsh-lang en     # 切回英文人格
```

（也可以设环境变量 `PI_DSH_LANG=zh`——配置文件优先于环境变量。）
两种语言承载完全相同的档位语义（build/fix 路由、按模型区分的 weak 人格）。
`pi_dsh_status` 会显示当前语言（`lang=en` / `lang=zh`）。

**官方身份句处理**：pi 默认模板以 "You are an expert coding assistant operating
inside pi..." 开头。路由器可以屏蔽或替换它（默认屏蔽——你的 persona 已经
定义了"你是谁"）：

```
/pi-dsh-identity               # 查看当前模式
/pi-dsh-identity remove        # 屏蔽官方身份句（默认）
/pi-dsh-identity keep          # 保留官方身份句
/pi-dsh-identity set <文本>     # 替换为你自己的身份句
```

同样持久化到配置文件（重启后依然生效）。

**按模型自动匹配人格**：Pro 用 spec 句 + 分类指令（w6c, +4.67, P24）；
Flash 用中性 + 分类 + 回顾/反跑题锚（w7, +5.67, P11）。你不需要配置。
---

## 为什么值得用（理论基础，简版）

- **同一个模型**，用对档位在两类任务上都能拿最高分；用错档位直接掉 10 分
  ——纯 prompt 造成的差距（"神/鬼二元性"）。
- 模型**自己不能换档**：行为在第一次请求就锁定，中途改设置几乎无效。
- 所以**换档必须来自外部**——人、分类器、或本插件。它就是你的人工换档自动化。

---

## 开发

```sh
node --test tests.mjs   # 17 个用例：分类、带宽、人格、parseMode 回归、辅助函数
tsc --noEmit            # 类型检查
```

## 文件结构

```
pi-dsh-optimizer/
├── package.json    pi manifest（npm/gallery 发布用）
├── index.ts        插件入口：生命周期钩子 + 3 个注册工具
├── router-core.ts  纯路由逻辑（零 pi 依赖，可单测）
├── tests.mjs       单元测试
├── tsconfig.json   类型检查配置
├── README.md       本文档（英文）
└── README.zh-CN.md 本文档（中文）
```

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

## 许可

MIT。
