# AGENTS.md · tiered-collab 仓库治理书

> AI Agent 在本仓库工作的**唯一行为准则**。
> 本仓库**是 git 仓库**，工作走分支：开分支 → 干活 → `push-task.mjs` 收口（见 §3）。
> 冲突时优先级：本文件 > 任务书 > 计划书。

## 0. 项目速览

| 项 | 内容 |
|---|---|
| 项目名 | `dsh-tiered-collab`（GitHub 仓库名；preset 目录名用 `tiered-collab`） |
| 一句话目标 | 用「分层模型路由 + 上下文隔离 + 可执行验收」把编码 Agent 的 token 成本压到线性 |
| 技术栈 | Node + ESM `.mjs`，**零第三方依赖**（只用 `node:` 内置模块） |
| 当前阶段 | A 组负向测试 3/3 按预期失败；已完成一轮单体 vs 分层的 A/B 实测（结论见 `README.md`） |

> **可移植性提醒**：本文件里的绝对路径来自开发机（Windows + `PATH` 为空的沙箱）。
> 换机器时用环境变量 `DSH_GIT` 覆盖 git 路径；`node` 用你自己 PATH 里的即可。
> `scripts/verify-runner.mjs` 会自己探测可用的 shell，不必改代码。

## 1. 开工前必读（按角色裁剪，不要全读）

**全读 = 浪费。** 实测「AGENTS + TASK_BRIEF + PLAN + BOARD + RUNBOOK」合计 71,006 字节
≈ 2.2 万 tokens，而多数任务真正要改的代码只有 ~1,400 tokens —— **开工成本是干活成本的 16 倍**。
故按角色裁剪：

| 角色 | 必读 | 可跳过 |
|---|---|---|
| **Worker**（`work_t1` / `work_t2`） | 本文件 **§2 环境约束 + §6 红线**，加上**任务卡本身** | 本文件其余章节、`TASK_BRIEF`、`PLAN`、`BOARD`、`RUNBOOK` |
| **Verifier**（`verify_t1`） | 本文件 **§2 + §5 + §6**，加任务卡与验收命令 | 本文件其余章节、Worker 的推理过程、`BOARD`、`RUNBOOK` |
| **Planner**（`plan_t0`） | 本文件 **§2 + §3**、`TASK_BRIEF` §3–§4、`PLAN` | `BOARD` 全文、归档、逐轮记录 |
| **队长** | 本节全部 + `BOARD`（当前状态）+ 需要时查 `BOARD-archive.md` | — |

**任务卡里不要写「去读 BOARD」**——那是把 1.3 万 tokens 塞进每一个 Worker。
`BOARD.md` 只保留当前状态；历史一律在 `docs/BOARD-archive.md`，**按需检索，不要整读**。

## 2. 环境硬约束（本机实测，违反必失败）

| 约束 | 事实 | 后果 |
|---|---|---|
| `PATH` 为空 | 沙箱内 `$env:PATH` 是空字符串 | `node` / `git` / `npm` **都不能裸调**，必须写绝对路径 |
| Node | `C:\Program Files\nodejs\node.exe`，v23.2.0 | **无** `zlib.zstdDecompressSync`（zstd 到 v23.8 才有） |
| Git | `C:\Program Files\Git\cmd\git.exe`，2.26.0 | 可用，但同样要绝对路径 |
| **本目录是 git 仓库** | 有远端 `origin`（GitHub），SSH 免密可用 | 工作走分支：`git switch -c feat/T-xxx-描述`；范围证据可用 git，也可用 `scripts/tree-sha1.mjs`（非 git 场景仍需要它） |
| 编码 | 全部文件 UTF-8 无 BOM | 中文注释不得出现乱码 |

验收命令一律写成：
```
& "C:\Program Files\nodejs\node.exe" <脚本相对路径> [参数]
```

## 3. 目录结构

```
docs/        任务书、计划书、协调板
fixtures/    验收用的固定输入样本
scripts/     可执行脚本（产物）
orchestrate/ 编排脚本（workflow 脚本体，canonical 源）
state/       运行期落盘（verdicts.jsonl 等），不进 git
```

- 新文件必须放对应目录，**禁止在仓库根堆脚本**
- 目录名小写、中划线连接；文件名小写、中划线连接

## 4. 代码风格

- ESM `.mjs`；只用 Node 内置模块，**禁止引入第三方依赖**
- 公开函数必须有简短注释说明用途与边界条件
- 禁止无意义注释（`i++ // 自增`）
- 魔法数字提取为具名常量
- 输出格式一旦被验收标准固化，就属于契约，**不得擅自变动**

## 5. 测试与验收

- 改行为必补验收；只改文档、注释可不补
- 每个任务自带验收命令，完成后**逐条跑给出证据**，不要只说「已完成」
- **先硬后软**：验收命令不通过直接判 reject，不做语义评价

## 6. 绝对禁止（红线）

1. 禁止删除、跳过、注释掉验收来让结果变绿
2. 禁止硬编码密钥、Token、密码
3. 禁止在脚本里假设 `node` 在 PATH 上
4. 禁止引入第三方依赖
5. 禁止一次改动超出当前任务 `inScope` 的文件
6. 禁止把未验证的代码描述为「已完成」
7. 禁止为了跑通而放宽输出契约（改验收标准而不是改实现）

## 7. 完成定义（DoD）

- [ ] 任务验收命令逐条通过，附实际输出
- [ ] 改动文件全部落在 `inScope` 内
- [ ] 未引入任务范围外的功能

> **`docs/BOARD.md` 由队长（captain）维护，不属于任何 Worker 的 inScope。**
> Worker / Verifier 只负责如实回报；把「更新 BOARD」写进 Worker 的 DoD 会与任务卡的
> `outOfScope: docs/**` 直接冲突（本仓库第一轮就踩到了，见 BOARD 决策日志）。
> 其他 `docs/**` 同理：文档改动一律走队长的范围，不由执行层顺手改。

## 8. 卡住时怎么办

1. 同一问题重试超过 2 次 → 停止，写进 `BOARD.md` 阻塞区，说明已尝试过什么
2. 发现任务书漏洞 → 不要自行补全，提出具体疑问
3. 发现范围外的既有问题 → 只记录，不修改
4. 缺依赖/环境不支持 → 记录为阻塞，找替代方案，不要硬扛

## 9. 回报格式

```
任务：T-001 通过率矩阵脚本
改动文件：tiered-collab/scripts/verdict-stats.mjs
验收结果：
  [x] 命令 <...> 退出码 0 —— 实际输出：<粘贴>
  [x] L0 T2 pass=3 total=3 rate=100.0%
遗留问题：<无 / 具体描述>
```
