# PITFALLS

> 本文由 `README.md` 拆出，内容与原 README 一致。

## 我们真实踩过的坑（本仓库最有价值的部分）

下面每一条都是实测出来的，不是推演。每条都记录了现象、根因、修法。

### 坑 1 · `deny` 只拦工具名，拦不住能力 

写了 `toolFilter: deny: [write, edit]`，以为「只拆不写」已经成立。
实测：三个负向测试全部"意外成功" —— `plan_t0` / `verify_t1` 都用 `pwsh` 的
`Set-Content` 把文件写出来了，且全程无报错。

根因：shell 是合法工具。只要它可用，就等于有写权限。
「只读 shell」这件事在语义上不成立——`node foo.mjs` 既是"执行验收"也是"运行一个可能写盘的进程"，
任何命令白名单都堵不死。

修法：分角色处理。规划层连 `pwsh` 一起 `deny`（它确实不需要 shell）；
复核层保留 shell，但一切执行必须走隔离执行器（见坑 6 与 `scripts/verify-runner.mjs`）。

### 坑 2 · `maxDepth` 不写 ≠ 无限，默认是 3

`subagent_fork` 那一行没写 `maxDepth`，preset 注释里却声称"该子代理不能再派生"。
实测：fork 链能递归到深度 3。

根因：工具 schema 里 `maxDepth` 的默认值是 3，不是"无限"。
不写就是放任它递归三层，与四个分层工具显式写的 `maxDepth: 1` 不一致。

修法：`subagent_fork` 补上显式 `maxDepth: 1`。
（顺带确认了 fork provider 声明 `depthLimit: true`，所以数值 `maxDepth` 能被真正执行，
不会在挂载时失败。）

### 坑 3 · 验收命令"只打印不 assert" → 缺陷全绿通过 

一张卡的验收命令长这样：

```powershell
node script.mjs --help; Write-Host "exit=$LASTEXITCODE"
```

它只打印退出码，不做判定。于是 `--help` 根本没实现（退出码 2、stdout 零输出），
却记录为通过。

同时另一条命令用 `|` 把输出接成字符串再匹配——而帮助文本写在 stderr，`|` 只接 stdout，
所以那个变量恒为空串，"不含裸 node"恒真。

教训：没有断言的验收命令，等于没验收。
每一条验收都必须有可判定的通过标准（退出码 / 行数 / 精确字符串），不能只打印。

### 坑 4 · 度量口径不定义 → 三个数字都对

任务卡验收标准写「`LINES=111`」，没给度量命令。结果同一个文件：

| 口径 | 结果 |
|---|---|
| 某 CLI 工具按 CRLF 计行 | 119 |
| `LF` 计数 | 124 |
| `split(/\r?\n/)`（含末尾空段） | 125 |

三个都说得通，验收无法判定。

教训：数字型验收标准必须自带度量命令。本项目后来定为唯一口径 = LF 计数，
并实测确认 `Get-Content .Count` 比 LF 计数少 4，属不可靠口径，禁用。

### 坑 5 · 子代理自报不可采信

Worker 自报改动后文件 108 行；队长与复核层双口径实测 124 行。
正是这一条导致判 `reject`。（重试时该 Worker 主动认账并给出改动前后双口径证据。）

教训：自报数字一律独立复测。 这不是不信任模型，是流程必须这样设计。

### 坑 6 · 复核层没 shell → 角色取消

为了堵坑 1，把 `verify_t1` 的 `pwsh` 一起 `deny` 了。
副作用：复核层再也无法执行验收命令，而它的职责定义就是执行验收。

结果两张卡的复核都只能给出"拿不到 exitCode"的程序性 reject——
不是产物缺陷，而是环境让这个角色无法履职。

修法：见 `scripts/verify-runner.mjs`（下节）。

### 坑 7 · 验收命令因环境失败，而不是因产物失败

写 `examples/acceptance-spec.json` 时用了 `node scripts/xxx.mjs` —— 看着最自然不过。
实测：全部命令 `CommandNotFoundException`。

根因：执行器的子进程继承了宿主环境，而宿主 `PATH` 是空字符串（AGENTS.md §2 的那条约束）。
于是 `node` 不可用——验收因为环境而失败，这是最没价值的失败。

修法：执行器把自己所在的 node 目录注入子进程 `PATH`。
执行器本来就是用那个 node 跑起来的，把它加到 PATH 安全、无副作用：

```js
const childPath = [dirname(process.execPath), process.env.PATH ?? ''].join(';');
spawnSync(shell, [...], { env: { ...process.env, PATH: childPath } });
```

> 这条坑的教训比修法更重要：注入 PATH 之后错误"变了" ——
> 从"找不到 node"变成"副本里没有 `preset/agent.cordis.yml`"。
> 这才暴露出第二个问题：执行器复制副本时漏了 `preset/` 目录。
> 如果当时草率地把断言改成"允许失败"，就永远看不到真问题。

---
