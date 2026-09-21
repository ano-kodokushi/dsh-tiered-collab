---
name: tiered-coding
description: Run coding work in tiered collaboration mode - decompose with plan_t0, execute single-point logic with work_t1, offload mechanical chores to work_t2, and independently review with verify_t1. Use whenever a task should be split into TaskCards with executable acceptance rather than done in one long conversation, or when a rejected result must be retried with its findings.
---

# 分层协作模式

**核心命题**：90% 的成本优化来自"喂给模型什么"，只有 10% 来自"用哪个模型"。
所以本模式同时做两件事——**模型分层**（把贵的 token 花在决策点上）与**上下文隔离**
（每个子代理只看它必须看的）。

## 四档路由（已钉死在工具上，不需要你选模型）

| 工具 | 档位 | 路由 | 用途 |
|---|---|---|---|
| `plan_t0` | T0 | `deepseek-v4-pro` + 思考 | 需求拆解、架构决策、跨模块影响分析、疑难定位。**只拆不写** |
| `work_t1` | T1 | `deepseek-v4-flash` + 思考 | 单点逻辑实现、单点 bug 修复、加分支处理 |
| `work_t2` | T2 | `deepseek-v4-flash` **非思考** | 格式化、重命名、样板代码、补注释、补 import、日志埋点、测试骨架、字段迁移 |
| `work_t2_local` | T2-L | 本机 Ollama `mellum2-instruct-mxfp4_moe` **非思考** | 与 T2 同职责，但零 token、文件不出机器。**有条件可用** |
| `verify_t1` | T1 | `deepseek-v4-flash` + 思考 | 只看 diff + 验收标准独立判定。**只看不改** |

五个工具的模型与思考档位都在 preset 里钉死，工具面也做过裁剪：`plan_t0` 与 `verify_t1`
**没有 `write`/`edit`**，五个工具的子代理**都不能再派生子代理**（`maxDepth: 1`）。

## 本地档（T2-L）的取舍

**用它的理由不是省钱。** 实测一张 L0 卡走云端只花约 ¥0.0003，本地省下的电费绝对额很小。
真正的理由是另外三条：

- **文件不出机器**——T2 粗活经常要把整个文件喂进上下文，本地跑等于不出网。
- **重试零边际成本**——反作弊探针、多轮复核、换个输入再验一次，全都可以随便加。
- **真·批量活**——几万行分类/抽取这种量级，云端才真的贵，本地边际成本才真正趋近于零。

代价与硬约束：

- **上下文 16384 token**。Ollama 默认在 8GB 卡上只给 4096，但子代理实测提示词约 19000 token
  （system 2867 + 工具定义 14629 + 任务 1478）——**光 58 个工具的定义就 14629 token**。
  因此做了两件事：① 用派生模型 `mellum2-t2-16k` 把 `num_ctx` 提到 16384；
  ② 给本档加 `toolFilter.allow`，只留 read/write/edit/grep/glob/pwsh（工具定义降到约 1500 token）。
  即便如此 `contextRefs` 仍应只放指针——超了会被硬截断。
- **必须配 API key**。pi-ai 要求每条路由都有凭据，省略 `apiKeyEnv` 不等于"免鉴权"，而是
  "交给 pi-ai 自己找"——它对自定义 provider 找不到，直接报 `No API key for provider: local-ollama`。
  故 settings 里写了 `apiKeyEnv: OLLAMA_LOCAL_API_KEY`，并在 `.credentials.yaml` 的 `refs` 下放了占位值
  （Ollama 不校验 Authorization，任意非空字符串即可）。
- **显存与游戏互斥**。权重约 6704 MiB，加 KV cache 约 7004 MiB；游戏会吃掉约 1 GiB，
  边玩边跑会挤到 CPU 卸载，速度塌陷。**玩游戏时不要指望这一档。**
- **能力边界**：12B MoE（2.5B 激活）在模式固定的改写上够用；需要理解业务语义时不可靠。
- **档位声明有坑（实测踩过两次）**：本机 instruct 变体无推理档，`settings.yaml` 里必须写
  `reasoningEfforts: false`，而 `work_t2_local` 的 `agentOptions` **绝不能写 `reasoningEffort`**。
  写了（哪怕写 `off`）会得到：
  `provider "local-ollama" model "..." does not support reasoning effort "off"`。
  原因是 `packages/llm/llm/src/index.ts:885` 规定能力为 `undefined` 时不得指定任何档位；
  而"只声明 off"也不行——`catalog.ts:730` 拒绝没有 `off` 以外档位的声明。
  无推理模型只能是【settings 写 `false` + preset 不写档位】这一种配套。

## 本地档回落规则（必须遵守）

```
work_t2_local 可用？  → 是 → 把 L0 卡派给它
                      → 否 → 直接派 work_t2（云端同职责）
work_t2_local 失败    → 带 findings 原卡重派 work_t2，**不要升 T1**
```

本地失败是**路由问题**（模型太弱 / 上下文被截断 / 显存不足降速），**不是「这张卡太难」的证据**。
把它当 L1 升级，会同时付两份成本还拿不到正确的卡。

## 难度定档（拆卡时顺手打标，零额外调用）

- **L0 机械型** → `work_t2_local`，本机不在线时退 `work_t2`：模式固定、无需理解业务语义
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
2. 分派   → 按 difficulty 调 work_t1 / work_t2_local（不在线则 work_t2），一次一个原子卡
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
