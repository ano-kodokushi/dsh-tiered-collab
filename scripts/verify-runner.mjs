// verify-runner.mjs —— 隔离验收执行器
//
// 在**一次性副本**里执行任务卡的验收命令，回传结构化报告，真工作区只读不写。
// 为什么这样设计：复核层若按能力面砍掉 shell 就无法自己跑验收命令（TASK_BRIEF F4
// 结构性不可满足）；但把 shell 还给它并不安全 —— 任何「跑命令」的能力都能写文件
// （被测脚本自己就会写），「只读 shell」在语义上不成立。故让执行发生在副本里。
//
// 边界条件：
//   - 只读真工作区：只读文件内容做前后 SHA1 核对，绝不写它
//   - 副本落在系统临时目录，跑完不自动清理（留证）
//   - 命令**只能**经 JSON 规格文件（`--spec`）传入。不走 argv：带空格的绝对路径会被
//     按空白切碎（实测 `& "C:\Program Files\nodejs\node.exe" ...` 切成 4 个 token，
//     命令静默拆坏却依然「跑完」）；规格文件对引号与 UTF-8 BOM 均免疫
//   - 参数缺失时**必须非零退出**：静默返回「零条命令全部通过」是假绿
//   - 本脚本不解释命令语义，只如实回传 exitCode / stdout / stderr
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { snapshotTree, diffSnapshots } from './tree-sha1.mjs';

const COPY_DIRS = ['scripts', 'fixtures', 'docs', 'orchestrate'];
const MAX_OUTPUT_CHARS = 4000;
// shell 与复制工具必须写绝对路径：本机 PATH 为空（AGENTS.md §2 实测）。
// 实测本机只有 Windows PowerShell 5.1；装了 pwsh 7 时把它挪到最前即可。
const SHELL_CANDIDATES = [
  'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
  'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
];
const COPY_TOOL = 'C:\\Windows\\System32\\robocopy.exe';
const USAGE = '用法: node verify-runner.mjs <工作区绝对路径> --spec <规格.json>；规格形如 {"commands":["<验收命令>"]}';

/** 解析 CLI：只接受 `--spec <规格文件>`；缺失或空命令一律抛错（不得静默通过）。 */
function parseCli(argv) {
  const at = argv.indexOf('--spec');
  const specPath = at === -1 ? undefined : argv[at + 1];
  if (specPath === undefined) throw new Error(USAGE.trim());
  const raw = readFileSync(specPath, 'utf8').replace(/^\uFEFF/, '');
  const parsed = JSON.parse(raw);
  const commands = (Array.isArray(parsed) ? parsed : parsed.commands)
    .filter((c) => typeof c === 'string' && c.trim().length > 0);
  if (commands.length === 0) throw new Error(USAGE.trim());
  return { workspace: argv[0] ?? '.', commands };
}

/** 截断过长输出，保留首尾以便人工核对。 */
function clamp(text) {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  const kept = MAX_OUTPUT_CHARS - 800;
  return `${text.slice(0, kept)}\n…[截断 ${text.length - MAX_OUTPUT_CHARS} 字符]…\n${text.slice(-800)}`;
}

function main(argv) {
  let cli;
  try {
    cli = parseCli(argv);
    if (!existsSync(resolve(cli.workspace))) throw new Error(`工作区不存在 ${cli.workspace}`);
  } catch (error) {
    process.stderr.write(`错误: ${error.message}\n`);
    return 1;
  }
  const workspace = resolve(cli.workspace);
  const shell = SHELL_CANDIDATES.find((p) => existsSync(p));
  if (shell === undefined) {
    process.stderr.write(`错误: 找不到可用 shell: ${SHELL_CANDIDATES.join(' | ')}\n`);
    return 1;
  }

  const copyRoot = join(tmpdir(), `verify-sandbox-${Date.now()}-${process.hrtime.bigint() % 100000n}`);
  mkdirSync(copyRoot, { recursive: true });
  for (const d of COPY_DIRS) {
    if (existsSync(join(workspace, d))) {
      spawnSync(COPY_TOOL, [join(workspace, d), join(copyRoot, d), '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'], { stdio: 'ignore' });
    }
  }

  const before = snapshotTree(workspace, COPY_DIRS);
  const results = [];
  for (const command of cli.commands) {
    const r = spawnSync(shell, ['-NoProfile', '-Command', command], {
      cwd: copyRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    });
    results.push({
      command, exitCode: r.status, ranInCopy: copyRoot,
      stdout: clamp(r.stdout ?? ''), stderr: clamp(r.stderr ?? ''),
      error: r.error ? String(r.error.code ?? r.error.message) : null,
    });
  }
  const after = snapshotTree(workspace, COPY_DIRS);
  const changedPaths = diffSnapshots(before, after);
  process.stdout.write(`${JSON.stringify({
    workspace,
    copyRoot,
    commandCount: results.length,
    allPassed: results.every((r) => r.exitCode === 0),
    results,
    workspaceUnchanged: changedPaths.length === 0,
    changedPaths,
    trackedFileCount: Object.keys(after).length,
  }, null, 2)}\n`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
