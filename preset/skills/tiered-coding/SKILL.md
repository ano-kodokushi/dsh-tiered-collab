---
name: tiered-coding
description: Run coding work in tiered collaboration mode - decompose with plan_t0, execute single-point logic with work_t1, offload mechanical chores to work_t2, and independently review with verify_t1. Use whenever a task should be split into TaskCards with executable acceptance rather than done in one long conversation, or when a rejected result must be retried with its findings.
---

# 分层协作模式

**核心命题**：90% 的成本优化来自"喂给模型什么"，只有 10% 来自"用哪个模型"。
所以本模式同时做两件事——**模型分层**（把贵的 token 花在决策点上）与**上下文隔离**
（每个子代理只看它必须看的）。

## 三档路由（已钉死在工具上，不需要你选模型）

| 工具 | 档位 | 路由 | 用途 |
|---|---|---|---|
| `plan_t0` | T0 | `deepseek-v4-pro` + 思考 | 需求拆解、架构决策、跨模块影响分析、疑难定位。**只拆不写** |
| `work_t1` | T1 | `deepseek-v4-flash` + 思考 | 单点逻辑实现、单点 bug 修复、加分支处理 |
| `work_t2` | T2 | `deepseek-v4-flash` **非思考** | 格式化、重命名、样板代码、补注释、补 import、日志埋点、测试骨架、字段迁移 |
| `verify_t1` | T1 | `deepseek-v4-flash` + 思考 | 只看 diff + 验收标准独立判定。**只看不改** |

四个工具的模型与思考档位都在 preset 里钉死，工具面也做过裁剪：`plan_t0` 与 `verify_t1`
**没有 `write`/`edit`**，四个工具的子代理**都不能再派生子代理**（`maxDepth: 1`）。

## 难度定档（拆卡时顺手打标，零额外调用）

- **L0 机械型** → `work_t2`：模式固定、无需理解业务语义
- **L1 单点逻辑型** → `work_t1`：范围明确（≤3 文件）、有明确对错、需要动脑但不需要全局视野
- **L2 架构 / 跨模块型** → `plan_t0`：需要理解模块间依赖、有多种方案要权衡，或 L1 已失败两次

经验目标：**L0 占 60% 以上**。达不到就说明拆分粒度还不够细——这是最值得投入的调优点。

## 三条铁律

1. **Planner 不写代码**——一旦它开始写实现，输出 token 爆炸且污染下游。它只产结构化任务卡。
2. **Worker 不做规划**——它收到的是已定范围的原子任务，禁止"顺便"扩展。范围膨胀是编码 Agent 最大的隐性成本。
3. **Verifier 不看推理过程**——只看最终 diff 与验收标准。看过程既费 token，又容易被流畅的 CoT 说服。

## 一轮闭环

```
1. 领目标 → 用 plan_t0 拆成 TaskCard（每张卡自带可执行验收）
2. 分派   → 按 difficulty 调 work_t1 / work_t2，一次一个原子卡
3. 硬验收 → 跑任务卡里的验收命令。不通过直接回第 2 步，不做语义评价
4. 软验收 → 硬验收过了才调 verify_t1 判语义质量（命名、可读性、隐性耦合）
5. 收     → 落盘 verdict，更新协调板（BOARD）
```

**先硬后软**：能跑测试 / lint / 构建覆盖的，绝不用模型判。硬验收不通过就 reject，
不浪费 Verifier 的 token。

## TaskCard 必填字段

```
id / title
difficulty:  L0 | L1 | L2            # 决定派给哪个工具
goal:        一句话说清改完是什么样
contextRefs: [{path, lines?}]        # ★ 指针，不是内联内容
constraints: [...]                   # 硬约束，越具体越好
inScope:     [...]                   # 允许改动的文件（工作区相对 POSIX 路径）
outOfScope:  [...]                   # 明确不许动的
acceptance:  { commands: [...], expected: "..." }   # ★ 必须可执行
```

两个省 token 的关键点：
- `contextRefs` **只放指针**（`path` + 可选行号），禁止把文件内容抄进任务卡。
  子代理要用更多内容时，自己用 `read` / `grep` 按需取。
- `acceptance` 必须可执行。写不出验收命令，说明这张卡还没想清楚，回去重拆。

## Verdict 必填字段（verify_t1）

```
verdict:        pass | reject
reason:         一句话结论
commandResults: [{command, status, exitCode, evidence}]   # 真实跑过的
findings:       [{id, severity, problem, requiredFix, file?}]   # reject 时必须非空
```

## 升档与停止

失败时**只升一级**，且**必须携带失败原因**——没有原因的升级等于重新掷骰子，
成功率提升有限但成本翻倍。

```
T2 失败 → 带 findings 重试一次 → T1 → 带 findings 重试一次 → 回退给 plan_t0 重新拆解
```

**重试上限是 2 次**：便宜的重试 × 5 次，可能比一次贵的做对还贵。
到顶仍失败 → 如实上报 `failed` + 保留 findings，**绝不许谎报成功**。
到 T0 还失败，说明**卡拆错了**，回退到 Planner 重新拆解，而不是继续升档。

## 反作弊探针（Verifier 的标准动作）

硬验收通过后，至少做一次探针：**换一份 Worker 没见过的输入**，看输出数字是否随之变化。
如果输出不变、或实现里硬编码了期望结果、或按文件名特判，判 `reject`。

## 环境陷阱（Windows / DSH 本机实测）

- 沙箱内 `PATH` **可能是空字符串**：`node` / `git` / `npm` 都不能裸调，
  验收命令必须写绝对路径（如 `& "C:\Program Files\nodejs\node.exe"`）。
- 把这条写进 `constraints`，否则 Worker 必然失败——它不知道你的环境长什么样。
- 工作区不一定是 git 仓库；没有 git 时，改动范围证据改用 mtime + 哈希核对。

## 红线

1. 禁止删除、跳过、注释掉测试或验收来让结果变绿
2. 禁止把未验证的代码描述为「已完成」
3. 禁止为了让报错消失而放宽类型或校验
4. 禁止一次改动超出任务卡 `inScope` 的范围
5. 禁止把 Planner 的分析过程传给 Worker——只传结论（改哪些文件、改成什么样）
