# pi-dsh-optimizer

**针对 pi 的任务感知思维模式路由插件。** 在每个任务发起前，根据任务内容把
会话路由到正确的思维模式。从
[dsh-router-standard](https://github.com/yjh051108/dsh-router-standard)
（[dsh-routing-suite](https://github.com/yjh051108/dsh-routing-suite) 套装中的路由预设）移植。

> 这是一个研究产物。它编码了 DeepSeek V4 Pro / V4 Flash 的一个实测性质：
> 模型在 persona 轴上的行为**并非连续谱**——它坍缩成几个由相变分隔的稳定区域。
> 因此本路由器将模式量化到稳定区域，而不是假装这根轴可以连续调节。

**English**: [README.md](README.md)

## 它做什么

读取会话的第一条用户消息 → 分类任务 → 在首次模型请求时注入：

1. **匹配的人格**（spec 先计划 / react 实干 / weak 内部路由），
2. **首轮核心工具集**（spec 读优先、react 写优先）。

首次持久工具调用后放开全部工具目录，路由器不再干预。模式从持久会话事件
推导，resume/reload 不丢状态。

## 实测的行为带宽

对 V4 Pro 做细粒度探测（21 个模式点 × n=2，官方 API，reasoning_effort=max），
行为沿 persona 轴坍缩为**三个带宽**，外加一个内部路由的第四模式：

| 带宽 | 模式值 | 实测行为 |
|---|---|---|
| `spec` | 0 – 0.19 | 稳定的计划-集体型（`We` 轨迹，let-me ≈ 0） |
| `mixed` | 0.2 – 0.49 | **转换陷阱**：`We`/`The`/`Let` 不稳定混合 |
| `react` | 0.5 – 1.0 | 稳定的实干型（`The`/`Let` 第一人称，we ≈ 0）—— 11 个模式值行为相同 |
| `weak` | 内部 | 模型按任务自行路由（弱人格，P8/P11） |

V4 Flash 是阈值式的（0–0.5 全在 spec 侧，0.75+ 跳变）。数值接口
`pi_dsh_mode` 保留，但会量化到三个带宽——转换带永远不会被自动选中。

## 为什么：双吸引子 RL 策略

跨项目证据（见上游 `docs/paper.md` 和 `docs/experiments.md`）：

- **同一个模型**在 spec 条件下的维护基准（Project2: minimal 99/96,
  anchored 98/99）和在 react/code 条件下的绿地构建任务（Mario: 10/10）都
  拿到最高分，而用错模式只拿 91 / 6——单纯改 prompt 条件就能造成约 10 分
  的摇摆（"神/鬼二元性"）。
- persona 是主导触发器（一句话互换即翻转轨迹）；工具 schema 面是次级条件。
- 行为路径锁定：一旦锚定，扩大工具目录最多扰动一个推理块，不会翻转模式。
- 模型无法自路由：唯一的内部路由窗口是**弱人格** + few-shot 路由指令
  （只是倾斜、不是翻转；区分度 +2.3..+3.3）。**模式选择必须来自外部。**
  本插件就是这套外部路由的自动化实现。

## 映射到 pi

| dsh-router-standard | pi-dsh-optimizer |
|---|---|
| `system-prompt/assemble`（persona 段） | `before_agent_start`（人格）+ `pi.setActiveTools`（首轮工具面） |
| `session/event` inbox.append（近距引导） | `context` 事件（引导注入到最近一条用户消息之后） |
| `tools.register`（`dev_router_*`） | `pi.registerTool`（`pi_dsh_status` / `pi_dsh_mode` / `pi_dsh_subagent`） |
| `session.events` 推导 | `ctx.sessionManager` 分支扫描 |

## 安装

```bash
mkdir -p ~/.pi/agent/extensions
cp -r pi-dsh-optimizer ~/.pi/agent/extensions/pi-dsh-optimizer
# 重启 pi，或使用扩展重载命令
```

依赖：`@earendil-works/pi-coding-agent`、`typebox`（tsconfig 路径指向本机
安装，直接从 `.ts` 源码加载）。

### 三个工具

- **`pi_dsh_status`** — 当前模式、带宽、人格、首轮核心工具、测试抑制、
  目录是否已升级、是否有覆盖。
- **`pi_dsh_mode <spec|weak|mixed|react|0-100|0.0-1.0|auto>`** — 显式换挡。
  数值输入会量化到三个带宽。注意：**整数按百分比（0-100）**——`1` = 0.01，
  要到 react 端请传 `100` / `react` / `1.0`。`auto` 清除覆盖、回到任务分类。
  下一请求生效。
- **`pi_dsh_subagent <mode> <task>`** — 在**全新隔离上下文**（自己的 system
  prompt）里用**不同模式**跑一个任务，不动当前会话轨迹，返回答案文本 +
  推理字符数。模式隔离是会话中途换模式的唯一可靠方式：原生子代理会继承
  当前会话人格，普通子代理无法跑不同模式。

## 一个预设，按模型自动匹配

无需配置 Pro/Flash 拆分：`personaFor(mode, modelId)` 读取会话的模型路由，
自动选择实测最优——Pro → spec 句 + 分类指令（w6c, +4.67, P24），Flash →
中性 + 分类 + 回顾/反跑题锚（w7, +5.67, P11）。模型在首次请求时固定
（路径锁定），人格随整个会话锁定。

## 深度自适应引导（思考效率）

按任务复杂度分发每轮引导（`isComplexTask`：长度或架构关键词），仅 weak 模式：

- **简单任务** → 快速收敛引导（一步到位，零浪费）；
- **复杂任务** → 决策闭合深度引导："深入思考架构、边界情况和集成点。不要
  在环境或工具上耗费推理。信息完整即产出。每个推理块以决策或信息需求收尾。"

## 测试

```sh
node --test tests.mjs   # 17 个用例：分类、带宽、人格、parseMode 回归、辅助函数
tsc --noEmit            # 类型检查
```

## 文件

- `index.ts` — 插件入口：生命周期钩子（`session_start`、`before_agent_start`、
  `tool_call`、`context`）+ 三个注册工具
- `router-core.ts` — 纯路由逻辑（零 pi 依赖，可单测）
- `tests.mjs` — 单元测试
- `tsconfig.json` — 类型检查配置（路径指向本机 pi 安装）

## 证据与致谢

- 上游理论与实验：[dsh-router-standard](https://github.com/yjh051108/dsh-router-standard)
  （`docs/paper.md`、`docs/experiments.md`），基于
  [dsh-probe](https://github.com/yjh051108/dsh-routing-suite) 的测量。
- Project2 评测数据：[xiaobright/modeltest](https://github.com/xiaobright/modeltest)
  （V4.1b，冻结）—— minimal 99/96, standard 91, PTC 92, anchored-standard 98/99。
- 两阶段锚定预设：[xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard)
  （MIT）。首轮锚定是其 `tool-bootstrap` 机制的插件级移植。
- DeepSeek Harness 官方 `minimal` 预设快照
  （`sends the exact RL prompt and schemas` 测试）—— spec 人格与 RL 对齐主张。

## 许可

MIT。
