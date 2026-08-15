# pi-dsh-optimizer

任务感知思维模式路由插件（pi-router-mode），从 [dsh-router-standard](https://github.com/yjh051108/dsh-routing-suite/tree/main/preset) 移植到 pi。

## 它能做什么

在 react ↔ spec 轴上，模型行为实测坍缩为三个稳定带宽（spec [0, 0.15] / transition [0.2, 0.45] 陷阱区 / react [0.5, 1.0]），外加一个 weak（内部路由）模式。插件根据任务自动选模式、注入对应人格、裁剪首轮工具，并提供三个自优化工具。

| 模式 | 人格 | 首轮核心工具 | 测试抑制 |
|---|---|---|---|
| spec | software engineer（计划型） | read/edit/find/grep | normal |
| mixed | 混合（陷阱区，避免） | 并集 | light |
| react | hands-on（实干型） | read/write/edit | suppressed |
| weak | 模型按任务自分类（flash/pro 措辞不同） | read/write/edit | light |

## 安装

```bash
mkdir -p ~/.pi/agent/extensions
cp -r pi-dsh-optimizer ~/.pi/agent/extensions/pi-dsh-optimizer
# 重启 pi 后生效
```

依赖：`@earendil-works/pi-coding-agent`、`typebox`（本项目 tsconfig 指向本机路径，直接以 .ts 源码加载）。

## 三个工具

- `router_status` — 查看当前路由状态（模式、带宽、人格、核心工具、是否已升级、是否有覆盖）
- `router_mode` — 手动换挡：`spec` / `weak` / `mixed` / `react`，或 0-100 数字、0.0-1.0 小数；`auto` 恢复自动分类。注意：整数按百分比（0-100），`1` = 0.01，要 react 端请传 `100` / `react` / `1.0`
- `router_subagent` — 在**全新隔离上下文**里用**不同模式**跑一个任务（自带独立 system prompt，不继承当前会话人格），返回答案文本 + reasoning 字符统计

## 开发

```bash
node --test tests.mjs   # 单元测试
tsc --noEmit            # 类型检查
```

## 许可

MIT
