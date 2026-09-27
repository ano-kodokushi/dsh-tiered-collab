# dsh-tiered-collab

把编码 Agent 的成本压到线性：分层模型路由 + 上下文隔离 + 可执行验收。

四个档位的子代理钉死在工具上（规划 / 单点逻辑 / 机械活 / 独立复核），
配套一套可复用的验收执行器，外加一份真实的失败记录。

>  先说清楚边界：这是为一款具体的 Agent 宿主（DSH）写的配置与脚本体。
> 里面的思路与踩坑对任何支持子代理的 Agent 框架都适用，但配置文件本身不通用。
> 如果你只想要治理文档那套（与产品无关），去看
> [`agent-project-kit`](https://github.com/ano-kodokushi/agent-project-kit)。

---

## 两分钟看懂它值不值

先看一条我们真实踩过的坑，你就知道这个仓库的成色：

```yaml
# 想让规划层「只拆不写」，于是 deny 掉写文件的工具
toolFilter:
  deny: [write, edit]
```

看起来「只拆不写」已经成立了。实测：三个负向测试全部"意外成功"，且全程无报错。

规划层用 shell 的 `Set-Content` 把文件写出来了，复核层把被测代码真的改掉了。

根因：`deny` 只拦工具名，拦不住能力。
只要 shell 可用，就等于有写权限——`node foo.mjs` 既是"执行验收"，
也是"运行一个可能写盘的进程"。「只读 shell」这件事在语义上不成立，任何命令白名单都堵不死。

> 完整 7 条踩坑与修法见 [docs/PITFALLS.md](docs/PITFALLS.md)。
> `docs/BOARD-archive.md` 里是逐轮的原始证据。

### 值不值，取决于你想解决哪个问题

| 你想解决的 | 这套东西能帮上吗 |
|---|---|
| agent 说"已完成"其实没验 | `verify-runner.mjs` 在一次性副本里执行验收，回传真实退出码 + 真工作区 SHA1 核对 |
| 约束靠提示词，模型想绕就绕 | 四个档位的工具面在 preset 里钉死，不是写在提示词里求它遵守 |
| 一次跑偏要重跑整段长上下文 | 子代理独立上下文，Planner 只看目标、Worker 只看一张卡 |
| 就是想让 token 更省 | 先看下面的实测数据——在这个尺度上它没省，详见下节 |
| 项目只有几个文件 | 别用。没多少上下文可隔离，却多了拆卡/派发/复核的开销 |

### 实测数据（不美化）

同一个任务，单体模式 vs 分层模式各跑一遍：

| 指标 | 单体 | 分层 | 差 |
|---|---|---|---|
| 模型消息数 | 9 | 9 | 平 |
| 总用量 | 330,043 | 296,073 | −10.3% |
| 未缓存输入 | 9,063 | 10,896 | +20% |
| 等效全价 | 47,342 | 45,549 | −3.8% |

我的判读：这是平局，不是胜利。3.8% 落在单次运行的噪声里；
主会话消息数一个都没少；未缓存输入反而 +20%（每个子代理开局都要重读约束，
这些前缀互相独立、缓存复用不了）。而且这个数字不是完整账——子代理用量没算进去，
其中规划层走的是更贵的模型。

结论：在这个尺度上，分层买到的是"可能的更少返工"，不是"更省 token"。
它值不值，取决于你的任务会不会第一次就做错。

## 它主张什么

> 90% 的成本优化来自「喂给模型什么」，只有 10% 来自「用哪个模型」。

所以这套东西同时做两件事：

1. 模型分层 —— 贵的 token 只花在真正的决策点上；机械活用便宜的非思考档位
2. 上下文隔离 —— 每个子代理只看它必须看的，不背整段聊天记录

边界条件（很重要）：收益来自"隔离"，所以 项目越小越不划算——
没多少上下文可隔离，却多了拆卡、派发、复核的开销。它面向的是大代码库 / 长任务。

---

## 四个档位

| 档位 | 工具名 | 做什么 | 路由 | 工具面约束 |
|---|---|---|---|---|
| T0 | `plan_t0` | 只拆任务、做架构取舍，不写代码 | 强模型 + 高思考 | `deny: [write, edit, pwsh]` |
| T1 | `work_t1` | 单点逻辑实现、单点 bug 修复 | 中档 + 高思考 | 全量 |
| T2 | `work_t2` | 格式化、重命名、样板代码等机械活 | 中档 + 非思考 | 全量 |
| T1 | `verify_t1` | 只看 diff 与验收标准独立判定，只看不改 | 中档 + 高思考 | `deny: [write, edit]` |

三条铁律

1. Planner 不写代码 —— 一旦它开始写实现，输出 token 爆炸且污染下游
2. Worker 不做规划 —— 它收到的是已定范围的原子任务，禁止"顺便"扩展
3. Verifier 不看推理过程 —— 只看最终 diff 与验收标准。看过程既费 token，又容易被流畅的推理论证说服

为什么 `verify_t1` 与 `plan_t0` 的约束不一样（这是踩坑后改的，见 [docs/PITFALLS.md](docs/PITFALLS.md) 坑 6）：
规划层不需要执行命令，所以连 shell 一起禁掉；复核层的职责就是执行验收，
禁掉 shell 等于取消这个角色。写入风险改由「副本执行协议」兜底。

## 安装

### 1. 装入 preset

把 `preset/` 下的文件放到宿主的 agent-preset 目录（DSH 是 `<DSH_HOME>/.agent-presets/<id>/`）：

```
<DSH_HOME>/.agent-presets/tiered-collab/
├── preset.yml            # 名称与描述
├── agent.cordis.yml      # 组成文件：注册四个分层工具
└── skills/
    └── tiered-collab/
        └── SKILL.md      # 随 preset 走的协议说明
```

### 2. 设为默认（可选）

```yaml
# <DSH_HOME>/settings.yaml
agent-presets:
  default: tiered-collab
  modeSelectionEnabled: true
```

### 3. 校验再启动

```bash
node scripts/validate-preset.mjs "<DSH_HOME>/.agent-presets/tiered-collab/agent.cordis.yml"
# 期望：{"problems": [], "ok": true}
```

别跳过这步：一个组成文件写坏会让每个新会话都挂不起来。
这个校验器会断言四件事：

- 两处 `deny` 的不对称设计（`plan_t0` 含 `pwsh`、`verify_t1` 不含）
- `subagent_fork` 有显式 `maxDepth`
- 缩进/形状在 preset 用到的 YAML 子集内合法
- 没有 TAB（YAML 非法缩进）

---

## 目录结构

```
dsh-tiered-collab/
├── preset/
│   ├── preset.yml
│   ├── agent.cordis.yml              # 组成文件：四个分层工具 + 隔离约束
│   └── skills/tiered-collab/SKILL.md # 协议说明（随 preset 走）
├── preset-local/                     # 五档变体：T2 拆成本地优先 + 云端回落
│   ├── preset.yml
│   ├── agent.cordis.yml              # 多一个 work_t2_local（provider: local-ollama）
│   └── skills/tiered-collab/SKILL.md
├── scripts/
│   ├── verify-runner.mjs             # 隔离验收执行器
│   ├── tree-sha1.mjs                 # 文件树快照
│   └── validate-preset.mjs           # 组成文件结构校验
├── orchestrate/
│   ├── RUNBOOK-tiered.md             # 执行手册：负向测试 + 一轮闭环
│   └── phase1.mjs                    # 编排脚本体（见下方说明）
└── docs/
    ├── TASK_BRIEF.md                 # 任务书
    ├── PLAN.md                       # 计划书
    ├── BOARD.md                      # 协调板（当前状态）
    └── BOARD-archive.md              # 完整逐轮记录与失败证据
```

>  `orchestrate/phase1.mjs` 用的是宿主通用子代理接口，不吃 preset 里钉死的档位与工具面。
> 拿它跑会得到「模型像 T0、但约束全没有」的假分层。保留它是作为反面教材，
> 正确做法见 `RUNBOOK-tiered.md` §0：直调四个分层工具。

## 已知限制（不粉饰）

1. 不是机器级红线。 `verify_t1` 保留 shell 意味着「只看不改」是协议 + 核对保证，
   不是能力面强制。真正的调用级拦截需要宿主提供 hook 机制——本项目的开发环境没装，
   所以没做，也没假装做了。
2. 收益依赖项目规模。 小项目上分层是净亏（见上方实测）。
3. 配置不通用。 组成文件是为 DSH 写的；思路可以搬，文件不能。
4. 升档重试没在脚本内实测过。 真实发生过一次「判失败 → 带结论重试 → 通过」，
   但那是手工走的，不是编排脚本跑出来的。
5. 本地档（`preset-local/`）尚未按"部署的那个模型"实测。
   已有的跑分打的是原版模型，而 preset 里配的是自建 16K 变体——
   被实测的没被部署，被部署的没被实测。而且云端基线自身有 9/10~10/10 的波动，
   所以"本地低 20%"这个说法不成立，只能说"大致打平、待复测"。
6. 本地档的 16K 上下文边界未测。 已知跑分每卡输入仅约 100 token；
   真实机械活输入可能大一到两个数量级。这条边界比跑分更能决定它能不能用。

## 延伸阅读

- [docs/PITFALLS.md](docs/PITFALLS.md) —— 7 条踩坑的完整记录与修法（本仓库最有价值的部分）
- [docs/MEASUREMENTS.md](docs/MEASUREMENTS.md) —— 两组实测数据的完整推导，以及本地档方案
- [docs/TOOLS.md](docs/TOOLS.md) —— 验收执行器与文件树快照的用法、可跑示例、亲手验证步骤
- [orchestrate/RUNBOOK-tiered.md](orchestrate/RUNBOOK-tiered.md) —— 直调四个分层工具的执行手册

## License

MIT
