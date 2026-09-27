# TOOLS

> 本文由 `README.md` 拆出，内容与原 README 一致。

## 复用的两个工具

### `scripts/verify-runner.mjs` —— 隔离验收执行器

在一次性副本里执行验收命令，回传结构化报告：

| 字段 | 含义 |
|---|---|
| `results[].exitCode` | 每条命令的真实退出码 |
| `results[].stdout` / `stderr` | 原样回传（超长截断） |
| `results[].ranInCopy` | 证明跑在副本里 |
| `workspaceUnchanged` | 真工作区执行前后 SHA1 全量比对 |
| `changedPaths` | 若真工作区被改，列出具体文件 |

为什么命令走 JSON 文件而不是命令行参数：带空格的绝对路径在 argv 上会被按空白切碎
（实测 `& "C:\Program Files\nodejs\node.exe" ...` 被切成 4 个 token，
命令静默拆坏却依然"跑完"）。JSON 对引号与空格免疫。

参数缺失必须非零退出：第一版在无参数时返回空命令数组，
于是 `allPassed: true`、退出码 0——等于「零条命令全部通过」的假绿。已修。

它会替你把 node 加进子进程 PATH（见坑 7）：所以规格里可以放心写 `node xxx.mjs`，
不必写机器相关的绝对路径。若你的环境里 `node` 本就在 PATH 上，这一步无副作用。

副本包含这些目录：`scripts/ fixtures/ docs/ orchestrate/ preset/ examples/`。
（`preset/` 与 `examples/` 是最初漏掉的——验收里要校验构成文件本身，副本必须先带上它。）

```bash
node scripts/verify-runner.mjs "<工作区绝对路径>" --spec <规格.json>
# 规格.json: {"commands":["<验收命令1>","<验收命令2>"]}
```

### `scripts/tree-sha1.mjs` —— 文件树 SHA1 快照

`snapshotTree` / `diffSnapshots`，覆盖新增 / 改动 / 删除三类。
用途是给任何一棵树做执行前后比对——典型场景是「验收跑完，证明真工作区没被动过」
（`verify-runner.mjs` 就用它）。一处实现、多处复用。

---

### 亲手验证（一分钟，不需要装宿主）

```bash
git clone https://github.com/ano-kodokushi/dsh-tiered-collab
cd dsh-tiered-collab
node scripts/validate-preset.mjs preset/agent.cordis.yml
```

期望输出里含 `"problems": []` 与 `"ok": true`，退出码 0（脚本会打印完整 JSON：

```json
{
  "file": "preset\\agent.cordis.yml",
  "lines": 342,
  "registryRows": 34,
  "denyLines": ["L192: deny: [write, edit, pwsh]", "L257: deny: [write, edit]"],
  "forkHasExplicitMaxDepth": true,
  "problems": [],
  "ok": true
}
```

）。这个校验器会断言：

- 两处 `deny` 的不对称设计（`plan_t0` 含 `pwsh`、`verify_t1` 不含）
- `subagent_fork` 有显式 `maxDepth`
- 组成文件的 YAML 形状合法、没有 TAB

别跳过这步：一个组成文件写坏会让每个新会话都挂不起来——
而它是静默的，你只会看到"新模式用不了"。

---

## 可跑示例：证明「校验器不是摆设」

`examples/` 里有一个能真跑的示例。它挑出不需要宿主就能验证的两件事：

```bash
git clone https://github.com/ano-kodokushi/dsh-tiered-collab
cd dsh-tiered-collab
node examples/run-example.mjs
```

### ① 对照实验：坏例必须被抓住

坏例是从真文件复制再改生成的（只改 `deny` 的内容），所以它永远与真文件同源、不会腐烂。
示例断言三件事：

| 断言 | 证明什么 |
|---|---|
| 坏例（`plan_t0` 缺 `pwsh`、`verify_t1` 多了 `pwsh`）→ exit 1 | 校验器真能抓到坑 1 |
| 坏例 2（`subagent_fork` 删掉 `maxDepth`）→ exit 1 | 校验器真能抓到坑 2 |
| 真文件 → exit 0、`problems: []` | 「坏了」的标准有意义——真文件必须过 |

没有最后一条，前两条毫无价值：一个永远报错的校验器也能"抓到"任何问题。

### ② 隔离验收执行器：证明它在副本里跑

示例用 `examples/acceptance-spec.json` 真跑一次 `verify-runner.mjs`，断言：

- `commandCount=2` 且 `allPassed=true`
- `workspaceUnchanged=true` —— 真工作区 SHA1 前后一致
- 每条结果的 `ranInCopy` 都指向 `verify-sandbox-*` —— 确实跑在副本里

### 它不覆盖什么（诚实声明）

负向测试跑不了 —— 那需要一遍分层会话（`plan_t0` 是否真的没有 `write`/`edit`/`pwsh`）。
别人 clone 下来没有宿主，所以示例不假装能代跑，只打印步骤指引：

```
INFO  本示例**不覆盖**：负向测试（plan_t0 是否真的没有 write/edit/pwsh）——
INFO    那需要一遍分层会话。步骤见 orchestrate/RUNBOOK-tiered.md §A。
```

---
