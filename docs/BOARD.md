# 协调板 · BOARD

> 进度可视化 + 决策留痕。**状态只在这里更新**，不要留在聊天记录里（换个会话就断了）。
> **本文件由队长维护**，不属于任何 Worker 的 inScope（AGENTS.md §7）。
>
> **⚡ 本文件只放「当前状态」。** 历史证据、决策日志、逐轮记录一律归档：
> `docs/BOARD-archive.md`（归档于第 6 轮，42,891 字节，SHA1 `D33784D0…`）。
> **Worker / Verifier 默认不要读本文件**——你只需要任务卡（见 §6「省 token 的读法」）。

**最近更新**：第 6 轮 · 文档瘦身 + 阻塞 D 关闭
**当前里程碑**：M1 完成（T-001 / T-002 / T-002b）· 分层协作模式可用
**下一步**：在大项目上用真任务做一次 A/B（单体 vs 分层），量「读进上下文的字节」与轮数

## 1. 当前进度

| ID | 任务 | 状态 | 备注（细节见归档） |
|---|---|---|---|
| T-001 | 通过率矩阵脚本 | **完成** | `scripts/verdict-stats.mjs`，F2 契约逐字一致 |
| T-002 | 定档建议（阈值 + 最小样本量） | **完成** | `scripts/tier-advice.mjs`，112 行；一次 reject 后重试通过 |
| T-002b | 帮助串改绝对路径 + `--help` | **完成** | 第 3 轮漏实现 `--help`，第 4 轮补实并加 11 项真断言 |
| T-030 | preset 约束加固 | **完成** | `deny` + `subagent_fork` 显式 `maxDepth: 1`；A 组 3/3 按预期失败 |
| T-040 | 复核层执行通道（阻塞 D） | **完成** | `scripts/verify-runner.mjs` + `scripts/tree-sha1.mjs` |
| T-010 | 编排脚本体 | **完成** | `orchestrate/phase1.mjs`（⚠️ 用的是通用 `agent()`，非分层工具，见 RUNBOOK §0） |
| T-011 | 硬验收优先 | **完成** | Verifier 先跑命令再判定 + 自加反作弊探针 |
| T-020 | reject 后带 findings 升档重试 | **部分** | 真实发生过（T-002），但**未在 `phase1.mjs` 脚本内实测** |
| T-021 | 失败如实上报 | **部分** | 反面案例已确证（Worker 自报 108 行 / 实测 124 行），脚本内未测 |
| T-003 | 缓存命中率统计 | **阻塞 A** | Node v23.2.0 无内置 zstd |

## 2. 阻塞与待办

| # | 事项 | 状态 | 下一步 / 需要什么 |
|---|---|---|---|
| A | T-003 缓存命中率（session 日志 zstd） | **阻塞** | `node:zlib` / `node:v8` 的 zstd 均为 `undefined`；`tar.exe` 报 `Unrecognized archive format`。二选一：升级 Node 到 ≥23.8，或走 DSH 导出先出明文 JSONL |
| B | 分支 / worktree 隔离 | **已关闭** | 本仓库**已是 git 仓库**并有远端，走分支即可（`git switch -c feat/T-xxx`）。`scripts/tree-sha1.mjs` 保留：非 git 场景（如 `state/` 落盘物）仍用它核对范围 |
| C | preset 约束失效 | **已关闭** | 第 2 轮发现，第 3 轮修（`deny` + `maxDepth`） |
| D | `verify_t1` 无 shell，F4 不可满足 | **已关闭** | 第 5 轮修：`verify_t1` 保留 `pwsh`，但一切执行必须走 `verify-runner.mjs`（副本 + SHA1 核对）。**残余风险**：不再是能力面强制，而是「协议 + 核对」 |
| E | 行数验收口径不可复现 | **已关闭** | **唯一口径 = LF(0x0A) 计数**。`Get-Content .Count` 比 LF 少 4、`-split` 多 1，**两者禁用** |
| F | 真机器级红线（hooks 调用级拦截） | **未做** | 需 hooks 插件，**本部署未组装**；且命令桥不透明暴露非 shell 工具参数。不假装已具备 |

## 3. 关键约束（每次开工必读，违反必失败）

| 项 | 事实 | 后果 |
|---|---|---|
| `PATH` 为空 | `$env:PATH` = 空字符串（实测 len=0） | `node` / `git` / `tar` **都不能裸调**，必须绝对路径 |
| Node | `C:\Program Files\nodejs\node.exe`，**v23.2.0** | 无内置 zstd（阻塞 A） |
| PowerShell 7 | **未安装**，只有 5.1 | 只用 `powershell.exe`；5.1 里中文 JSON 显示会乱码（是显示问题，不是文件坏） |
| 本目录是 git 仓库 | 有远端 `origin`（GitHub），SSH 免密 | 工作走分支；`state/` 等落盘物仍用 `scripts/tree-sha1.mjs` 核对 |
| 编码 | 全部 UTF-8 **无 BOM** | `pwsh` 的 `Set-Content -Encoding utf8` 会带 BOM，禁用 |

## 4. 最近一轮（第 6 轮）：文档瘦身

| 项 | 结果 |
|---|---|
| 动机 | 按 AGENTS.md「开工前必读」要读 71,006 字节 ≈ 2.2 万 tokens，而真正要改的代码 ≈ 1,400 tokens —— **开工成本是干活成本的 16 倍** |
| 动作 | `BOARD.md` 42,891 字节 → 本文件；全文逐字归档到 `docs/BOARD-archive.md` |
| 未删任何证据 | 归档 SHA1 `D33784D04AEA472F267E3D578250230AAE013EFE`，与原文件逐字节一致 |
| 配套 | 明确「Worker/Verifier 默认不读 BOARD」，只读任务卡 |

## 5. 累计统计

| 指标 | 数值 |
|---|---|
| 任务总数 | 10（完成 6 / 阻塞 2 / 部分 2） |
| 返工次数 | 2（T-002 行数超限；T-002b 漏实现 `--help`） |
| verdict 落盘 | `state/verdicts.jsonl` 7 行，F1 五字段齐全 |
| 已知漏检 | 1 次（`--help` 缺失，第 3 轮双重复核都没抓到 → 促成分层复核通道修复） |
| 负向测试 | A 组 3 条全部按预期失败（第 3 轮达成） |

## 6. 省 token 的读法（本轮新增，重要）

| 角色 | 该读什么 | 不该读什么 |
|---|---|---|
| Worker（`work_t1`/`work_t2`） | 任务卡 + 卡片 `contextRefs` 点名的文件 + 本文件 §3 | ❌ 完整 BOARD、❌ RUNBOOK、❌ 聊天记录 |
| Verifier（`verify_t1`） | 任务卡 + 验收命令 + 本文件 §3 | ❌ Worker 的推理过程、❌ 完整 BOARD |
| Planner（`plan_t0`） | `TASK_BRIEF` + `PLAN` + 本文件 §3 | ❌ 归档、❌ 逐轮记录 |
| 队长 | 本文件全部 + 归档（按需） | — |

**任务卡里不写「去读 BOARD」**——那是把 13,000 tokens 塞进每个 Worker。
