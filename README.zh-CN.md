# pi-dsh-optimizer

**把 dsh 官方 `minimal` 的首轮请求搬给 pi —— 再顺手掐掉思维链里那句 "Let me…" 的循环。**

> DeepSeek 在 pi 里表现不好，不是 pi 不行，是 pi 喂给它的那段提示词，它压根没被这么训练过。
>
> 这个扩展把它被训练过的那一面还回去：官方 `minimal` 的原样开场，然后再把 pi 的东西全部交还。

`pi` 扩展 · 零配置 · 不挑模型 · 41 个测试

---

## 先说那个 33 分

同一个模型，同一个基准，只因为外壳换了：

| 分数 | 外壳 |
|---|---|
| **87.9** | DeepSeek 官方 Harness |
| **54.68** | Terminus 2（第三方复跑） |

DeepSeek V4 Pro（0813）跑 Terminal-Bench 2.1。33 分的差距，最初闹成"DeepSeek 是不是作弊了"，最后留下一个更有用的结论：**不写清楚外壳的跑分，就是一个没有单位的数字。**

然后是最关键的那一下——同一个 Harness 内部，换预设也有同样的落差：

| 预设 | 分数 |
|---|---|
| **minimal**（只有 2 个工具） | **99 / 96** |
| standard | 91 |
| PTC（Code） | 92 |

如果 V4 Pro 只是"认自家的房子"，这三个数应该差不多。它们不是。变量是**开场提示词和工具表**——当外壳长得像它后训练时那副样子，模型表现最好。

接着是一个让这个扩展几乎成了必然的实验：

> 用 minimal 模式的提示词和那两个工具开一个会话。第一次工具调用之后，把**完整的 25 个工具**全部恢复，后面的运行照常。
> 分数几乎没动：**98 / 99**。
>
> *模型第一轮做了什么，远比后面名义上能用多少工具重要。*

这就是全部的原理。这个扩展，就是把这个实验搬到 pi 上自动执行。

---

## 它做什么

**会话的第一条请求，被改写成 dsh 官方 `minimal` 的样子。**

| | 第一条请求 | 之后的回合 |
|---|---|---|
| 系统提示词 | `You are a helpful software engineer assistant.`——46 个字符，原样 | pi 的完整提示词 |
| 工具 | `bash` + `str_replace_editor` | pi 的整个工具表 |
| pi 的提示词分节 | 一节都没有 | 全部回来 |
| 思维风格 | 模型默认 | 你自己选（默认：`we need to…` 那段） |

**然后它就让开了。** 会话一旦产出过真实的一轮，锚定永久解除：跨压缩、跨 `--continue`、跨 fork 都不会退回。不需要存状态，也就没有状态可以丢。

pi 的其它部分一个都没动。你的会话文件、pi 的工具注册表、界面——原样。被改写的只有那一条真正出网的请求。

---

## 第二个问题："Let me…"的死循环

推理模型会打转。这是有专门论文研究的失败模式："想太多"（overthinking）有自己的一整套文献，"让每一步思考尽量精简"也早就是思考模型的常规建议。

DeepSeek 的思维链有个标志性的版本——**用叙述代替行动**：

> *Let me… Let me check… Let me think about that… Let me…*

同一个计划，反复复述，什么都不推进。

所以解除锚定的那一步，同时把 pi 的官方身份句换成一段严格风格的 **`we need to…`** 规则：每一步都是一个具体动作，第一人称复数，一句话一步，用情态动词（`I'll` · `I can` · `I should` · `I will`）推进到下一步。只写决策，不写评论，不复述。

实际感受：思考更短、重启更少、第一次动手之前的废话更少。

### 换掉它，或者删掉它 —— `/dsh-optimizer`

| 菜单项 | 作用 |
|---|---|
| **text** | 用你自己的一段替换掉身份句 |
| **mode** | `replace`（默认）· `remove`（只删身份句，不加任何东西）· `keep`（完全保留 pi 的原文） |
| **preview** | 提交前先看解除后到底长什么样 |
| **reset** / **path** | 恢复默认 / 打开配置文件 |

---

## 安装

```bash
pi install npm:pi-dsh-optimizer
```

重启 pi，完事。不用声明模型，不用配 provider，不用维护白名单——只要 pi 在驱动一个模型，每个会话的第一条请求就会被锚定。

---

## 功能

- **首轮锚定** —— 官方 `minimal` 那行 persona 和那两个工具，原样出现在真正到达模型的那条请求上。
- **自动解除，且粘性** —— 会话第一轮真实产出后，pi 的完整提示词和工具表全部回来，并且不再退回。
- **思维风格可换** —— 默认 `we need to…`，三种模式，支持预览。
- **自带官方 `str_replace_editor`** —— 和 dsh `minimal` 用的是同一套两工具表面，锚定不是虚的。
- **DSML 桥** —— 模型把工具调用当文本吐出来时，该调用照样执行。零配置。
- **可自查** —— `PI_DSH_OPTIMIZER_DUMP=1` 把真正出网的请求落到磁盘，锚定有没有生效自己验。
- **不破坏** —— 不改写、不回滚、不留痕迹。锚定是"某一条请求的属性"，不是"你这个会话的状态"。
- **不挑模型** —— 任何模型都生效。DeepSeek 收益最大（见上），其他模型只是开场更轻。

---

## 命令与配置

| 东西 | 作用 |
|---|---|
| `/dsh-optimizer` | 菜单：思维风格、模式、预览、重置、路径 |
| `pi_dsh_status` | 工具——打印 `phase=` · `model=` · `surface=` · `tools=` |
| `PI_DSH_OPTIMIZER_DUMP=1` | 导出出网请求用于自查 |
| `~/.pi/agent/pi-dsh-optimizer.json` | `{ "mode": "replace", "text": "…" }` |

配置里**故意没有 `enabled` 开关**：要停就卸载包。多一个开关，就多一个和事实不同步的地方。

---

## 常见问题

**只对 DeepSeek 有用吗？**
不是。它搬过来的那个预设，就是 DeepSeek 后训练时的分布，所以 DeepSeek 收益最大。其他模型只是开场那一条请求更轻。

**pi 的 rules、skills、项目上下文会丢吗？**
只丢第一条请求——这正是重点。从第二个回合开始全部回来。

**会变慢吗？**
它做的工作比 pi 的常规路径更少：46 个字符的提示词 + 两个工具声明，而不是几十 KB 提示词 + 几十个声明。

**那条被锚定的请求，真的是官方的吗？**
是。persona 字符串和两个工具声明都抄自官方 `minimal` 预设。打开 dump，自己 diff。

**我用的是 standard / PTC 预设呢？**
这个扩展只搬 `minimal` 的开场。有数据支持的就是这一个。

**对提示词缓存有帮助吗？**
它给了 DeepSeek 前缀缓存喜欢的形状：开场极小、解除后的前缀稳定。但它本身不是一个缓存功能。

**会不会和别的扩展打架？**
它不 patch pi 的提示词，所以不会。但有一个坑：它注册的工具名是官方的 `str_replace_editor`——如果另一个扩展注册同一个名字，pi 只留一个，另一个会被静默丢掉。

---

## 兼容性

| | |
|---|---|
| pi | `@earendil-works/pi-coding-agent` |
| 模型 | 任意——DeepSeek V4 Pro / V4 Flash / V4.1 收益最大 |
| 相关场景 | DeepSeek Harness（DSH）、DSH `minimal` 预设、pi + DeepSeek |

---

## 老实说几句

- 那个 33 分和 99 / 91 / 92 都是**社区报告**，不是 DeepSeek 官方声明。来源在下面，建议自己去读，别只信这份 README。
- 首轮锚定实验是在 DSH **内部**做的。这个扩展把它搬到 pi，你的数字会不一样。
- `we need to…` 是提示词风格干预：它改变推理读起来的样子、通常会变短，但不保证一定更短。
- DSML 桥代码不大，而且没有专门的测试覆盖。遇到它解析不了的泄漏调用，它会原样放过、不碰你的流。

---

## 来源与致谢

- DeepSeek Harness 开发者预览——官方预设清单（Standard / PTC / Minimal / Creator）：<https://deepseek.com/harness/en/>
- **Why DeepSeek Harness Benchmark Scores Differ So Wildly** —— 87.9 vs 54.68、99 / 91 / 92 的预设落差、以及首轮锚定实验：<https://findharness.com/blog/why-deepseek-harness-benchmark-scores-differ>
- **DeepSeek Pro Looks Brilliant in Minimal Mode. That Is Also the Problem** —— 反方观点，值得一读：<https://www.remio.ai/post/deepseek-pro-looks-brilliant-in-minimal-mode-that-is-also-the-problem>
- **Pi Agent + DeepSeek: Why the Harness Can Matter More Than the Model** —— "外壳乘数"，以及为什么 minimal 提示词适合那些没被大厂外壳训过的模型：<https://docs.bswen.com/blog/2026-09-01-pi-agent-deepseek-harness-multiplier/>
- **Wait, Wait, Wait… Why Do Reasoning Models Loop?** <https://arxiv.org/html/2512.12895v1>
- **Stop Spinning Wheels: Mitigating LLM Overthinking via Mining Patterns for Early Reasoning Exit** <https://arxiv.org/html/2508.17627v1>
- 数字背后的社区分析：`@shmidtqq`（由 `@ST4RHaze` 转发）以及 `@ZhihuFrontier` 翻译分享的中文长文，标题译作《DeepSeek V4 Pro 是否过拟合了自己的 harness？真正的问题可能是接口敏感性》。
- `minimal` 预设本体：DSH 仓库里的 `apps/cli/config/agent-presets/minimal/agent.cordis.yml`。

---

## 更新日志

| 版本 | 变化 |
|---|---|
| 0.3.0 | 首轮锚定 + 自动粘性解除、思维风格三种模式与预览、DSML 桥、官方 `str_replace_editor`、出网请求 dump |
| 0.2.x | 最早的公开版本：minimal persona 与两工具表面 |

---

## 许可协议

MIT。
