# 项目任务书 · TASK_BRIEF

> 唯一真相源。Agent 每次开工前必读。
> 写法铁律：**每条都要能被验证**。写不出验证方式的，就是没想清楚。

## 1. 背景与目标

**要解决什么问题**：单体 Agent 长对话的上下文随轮次二次增长，一次跑偏要重跑整条 100K 上下文；
且默认全用最强模型，90% 的 token 花在了不需要智力的机械活上。

**为什么现在做**：DSH 已原生具备三档路由（`deepseek-v4-pro` / `v4-flash` 思考 / `v4-flash` 非思考）、
独立上下文的子代理、以及强制 schema 的结构化输出。缺的只是把它们编排成闭环、并留下可统计的证据。

**目标用户**：在本机 DSH 里用自然语言驱动多 Agent 干编码活的自己。

**成功的样子**：
1. 一次真实任务能全程走完 Planner(T0) → Worker(T1/T2) → Verifier(T1) 并留下结构化 verdict；
2. 每次运行的 verdict 落盘成可统计的 JSONL；
3. 能算出「难度 × 档位」的通过率矩阵，据此判断某个档位是否该升降档；
4. 全程零第三方依赖、零容器，只用本机 Node + DSH 原生工具。

## 2. 范围

### 2.1 范围内（做什么）

- 建立 `docs/` 三件套（任务书 / 计划书 / 协调板）
- 定义 verdict 记录格式并落盘
- 实现通过率矩阵脚本（difficulty × tier）
- 实现编排脚本（workflow 脚本体），跑通 Planner → Worker → Verifier 闭环
- 失败时带 rejection reason 升档重试一次，仍失败则回退重拆

### 2.2 范围外（不做什么）

- 不引入任何第三方 npm 依赖
- 不做容器 / 进程级隔离（本机没有）
- 不做成本计价器（DSH 无计价接口）
- 不做闲时调度（DSH 无调度接口）
- 不修改 DSH 本体或任何插件
- 不碰 zstd 会话日志解析（见 PLAN 的 T-003 与 BOARD 阻塞区）

### 2.3 后续再说（明确推迟）

- 缓存命中率统计（需要 zstd 解压，Node 23.2 无内置支持）
- AST / 符号级上下文切片（需挂载 LSP）
- 用 hooks 把红线做成调用拦截

## 3. 功能清单与验收标准

| # | 功能 | 验收标准（可验证） | 优先级 |
|---|---|---|---|
| F1 | verdict 落盘格式 | `state/verdicts.jsonl` 每行一个 JSON，含 `task_id/kind/difficulty/tier/verdict` 五个字段，`verdict ∈ {pass,reject}` | P0 |
| F2 | 通过率矩阵脚本 | `node scripts/verdict-stats.mjs --input fixtures/verdicts.sample.jsonl` 退出码 0，stdout 恰好 5 行：4 行分组 + 1 行 OVERALL，格式与数值见下 | P0 |
| F3 | 编排闭环 | `orchestrate/phase1.mjs` 能产出 TaskCard(schema) → 派 Worker 落盘实现 → 派 Verifier 出结构化 verdict | P0 |
| F4 | 硬验收优先 | Verifier 必须先跑验收命令；命令失败时 verdict 必须为 reject 且 findings 非空 | P0 |
| F5 | 升档重试 | verdict=reject 时带 findings 重试一次；第二次仍 reject 则该卡标记失败并如实上报 | P1 |

### F2 的输出契约（固定，不得改动）

输入 `fixtures/verdicts.sample.jsonl` 有 10 条记录，按 `difficulty`（字典序）再按 `tier`（字典序）分组，
每组一行，格式 `"{difficulty} {tier} pass={n} total={m} rate={x.x}%"`，`rate` 保留一位小数；
最后一行 `"OVERALL pass={n} total={m} rate={x.x}%"`。

用样本数据期望的**精确输出**：

```
L0 T2 pass=3 total=3 rate=100.0%
L1 T1 pass=2 total=3 rate=66.7%
L1 T2 pass=2 total=2 rate=100.0%
L2 T0 pass=1 total=2 rate=50.0%
OVERALL pass=8 total=10 rate=80.0%
```

## 4. 技术约束

| 项 | 约束 |
|---|---|
| 语言与版本 | Node 23 ESM（`.mjs`），`C:\Program Files\nodejs\node.exe` |
| 依赖 | 仅 Node 内置模块，禁止第三方依赖 |
| 入参 | 必须支持 `--input <path>`，缺省不得崩溃到非 0 退出码以外的行为 |
| 输出 | 只写 stdout；错误写 stderr；成功退出码 0 |
| 必须复用 | 无 |
| 禁止使用 | 任何 npm 包；任何假设 `PATH` 有 `node` 的写法 |

## 5. 非功能要求

- **性能**：10 条记录的样本必须在 2 秒内跑完
- **安全**：只读输入文件，不写任何文件
- **兼容**：Windows PowerShell 下直接可执行
- **可维护性**：单文件 ≤ 120 行

## 6. 里程碑

| 里程碑 | 交付内容 | 验收方式 |
|---|---|---|
| M1 | 通过率矩阵脚本 + verdict 格式 | F2 的精确输出逐行比对 |
| M2 | 编排闭环跑通一次真实任务 | Verifier 返回结构化 verdict，队长独立复跑验收命令通过 |
| M3 | 升档重试 + 失败如实上报 | 人为构造一次 reject，观察是否带 findings 重试一次并如实收尾 |

## 7. 假设与风险

| 假设 / 风险 | 若不成立的影响 | 应对 |
|---|---|---|
| Node 23.2 无内置 zstd | 缓存命中率统计做不了 | 推迟为 T-003，记入阻塞区 |
| 沙箱内 `PATH` 为空 | 裸调 `node` 全部失败 | 所有验收命令写绝对路径 |
| 子代理与队长共享 workspace | 并行 Worker 改同文件会冲突 | 本轮并行度固定为 1；后续用 workspace 内 git worktree |

## 8. 待确认问题

- [ ] 升档重试的"上档"具体指什么？（模型换更强的？还是把任务拆更细？）本计划先按「模型升一档」实现
- [ ] verdict 记录是否需要记录 token 用量？（DSH 的 workflow 返回值不带用量，需另找途径）
