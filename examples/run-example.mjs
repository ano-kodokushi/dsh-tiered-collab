// run-example.mjs —— 端到端跑通「这个仓库最值钱的两样东西」
//
// 这个仓库跟 agent-project-kit 不同：它的核心价值**需要一遍分层会话**才能完整验证，
// 而别人 clone 下来没有 DSH，跑不了。所以本示例挑出**不需要宿主就能验证**的两件事：
//
//   ① 对照实验：证明 preset 校验器真的能抓「踩坑 1」——deny 拦不住能力、fork 没有 maxDepth
//      （坏例是从真文件**复制再改**生成的，所以永远与真文件同源，不会腐烂）
//   ② 隔离验收执行器：证明 verify-runner 真的在**副本**里执行验收，
//      并且真工作区 SHA1 前后一致（workspaceUnchanged）
//
// 它同时是本仓库的回归测试：改了脚本或 preset 之后跑一遍，就知道有没有弄坏。
//
// 为什么不用 git：示例要能离线、零凭据跑完。真仓库的推送走 push-task.mjs（见 README）。
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const NODE = process.execPath;      // 当前解释器，避免依赖 PATH

// ── 极小的断言框架：失败不中断，最后一起汇总 ────────────────────────────────
const steps = [];
let failed = 0;
function check(label, ok, detail) {
  steps.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `\n        ${detail}`}`);
  if (!ok) failed += 1;
}
function info(msg) { steps.push(`INFO  ${msg}`); }

/** 跑一条命令，返回 { code, out }；不抛异常。 */
function run(args, cwd) {
  const r = spawnSync(NODE, args, { cwd, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

/** 跑校验器并解析 JSON（它末尾总是打印一份 JSON）。 */
function validate(file) {
  const r = run([join(REPO, 'scripts', 'validate-preset.mjs'), file], REPO);
  try {
    return { code: r.code, report: JSON.parse(r.out), raw: r.out };
  } catch {
    return { code: r.code, report: null, raw: r.out };
  }
}

info(`仓库根: ${REPO}`);

// ═══ ① 对照实验：坏例必须被抓住 ═══════════════════════════════════════════
const work = mkdtempSync(join(tmpdir(), 'tiered-example-'));
const real = join(REPO, 'preset', 'agent.cordis.yml');
info(`坏例生成目录: ${work}`);

// 从**真文件**复制再改，只动 deny 的列表内容，其它行一字不改。
// 这样校验器里「按顺序抓前两处 deny」的断言依然命中，报出的就是这两条坏例。
const lines = readFileSync(real, 'utf8').split('\n');
let denyIdx = 0;
const badLines = lines.map((l) => {
  if (!/deny:/.test(l)) return l;
  denyIdx += 1;
  if (denyIdx === 1) return l.replace('[write, edit, pwsh]', '[write, edit]');      // 坑 1：pwsh 可写
  if (denyIdx === 2) return l.replace('[write, edit]', '[write, edit, pwsh]');      // 副作用：复核层没 shell
  return l;
});
check('坏例确实改到了 2 处 deny', denyIdx === 2, `实际改到 ${denyIdx} 处`);

const bad = join(work, 'bad.cordis.yml');
writeFileSync(bad, badLines.join('\n'), 'utf8');

const badResult = validate(bad);
check('坏例被判为不通过（exit 1）', badResult.code === 1, `实际 exit=${badResult.code}`);
check('坏例的 problems 非空', (badResult.report?.problems?.length ?? 0) > 0,
  JSON.stringify(badResult.report?.problems));
check('坏例抓到了「plan_t0 缺 pwsh」这条',
  (badResult.report?.problems ?? []).some((p) => p.includes('plan_t0')),
  (badResult.report?.problems ?? []).join(' / '));
check('坏例抓到了「verify_t1 缺 shell」这条',
  (badResult.report?.problems ?? []).some((p) => p.includes('verify_t1')),
  (badResult.report?.problems ?? []).join(' / '));

// fork 的 maxDepth：再从坏例派生出「只删 maxDepth」的第二份，证明它也被抓
const forkIdx = badLines.findIndex((l) => /toolName: subagent_fork/.test(l));
let noDepth = null;
if (forkIdx === -1) {
  check('能在构成文件里定位 subagent_fork', false, '找不到 toolName: subagent_fork');
} else {
  const end = badLines.findIndex((l, i) => i > forkIdx && /maxDepth:/.test(l));
  const cut = badLines.filter((l, i) => !(i > forkIdx && i <= (end === -1 ? forkIdx + 6 : end) && /maxDepth:/.test(l)));
  noDepth = join(work, 'bad-fork-nodepth.cordis.yml');
  writeFileSync(noDepth, cut.join('\n'), 'utf8');
  const r = validate(noDepth);
  check('坏例 2（fork 无 maxDepth）被判为不通过（exit 1）', r.code === 1, `实际 exit=${r.code}`);
  check('坏例 2 抓到了 maxDepth 这条',
    (r.report?.problems ?? []).some((p) => p.includes('maxDepth')),
    (r.report?.problems ?? []).join(' / '));
}

// 对照：真文件必须通过 —— 否则说明「坏了」的标准没意义
const goodResult = validate(real);
check('真文件被判为通过（exit 0）', goodResult.code === 0, `实际 exit=${goodResult.code}`);
check('真文件 problems 为空', (goodResult.report?.problems?.length ?? 0) === 0,
  JSON.stringify(goodResult.report?.problems));
check('真文件的 denyLines 与设计一致',
  (goodResult.report?.denyLines ?? []).length === 2
    && goodResult.report.denyLines[0].includes('pwsh')
    && !goodResult.report.denyLines[1].includes('pwsh'),
  JSON.stringify(goodResult.report?.denyLines));

// ═══ ② 隔离验收执行器：证明它在副本里跑、真工作区没动 ═════════════════════
const spec = join(REPO, 'examples', 'acceptance-spec.json');
check('规格示例文件存在', existsSync(spec), spec);
if (existsSync(spec)) {
  const r = run([join(REPO, 'scripts', 'verify-runner.mjs'), REPO, '--spec', spec], REPO);
  let report = null;
  // verify-runner 把报告作为整个 stdout 打印
  try { report = JSON.parse(r.out.slice(r.out.indexOf('{'))); } catch { /* 解析失败下面会报 */ }
  check('verify-runner 退出码 0', r.code === 0, `实际 exit=${r.code}`);
  check('命令数 = 2 且全部通过',
    report?.commandCount === 2 && report?.allPassed === true,
    `commandCount=${report?.commandCount} allPassed=${report?.allPassed}`);
  check('真工作区未被改动（workspaceUnchanged）', report?.workspaceUnchanged === true,
    `changedPaths=${JSON.stringify(report?.changedPaths)}`);
  check('确实跑在一次性副本里',
    (report?.results ?? []).every((x) => typeof x.ranInCopy === 'string' && x.ranInCopy.includes('verify-sandbox')),
    (report?.results ?? []).map((x) => x.ranInCopy).join(' / '));
  info(`副本路径: ${report?.copyRoot ?? '(未知)'}`);
}

// ═══ ③ 诚实声明：哪一部分本示例**验证不了** ══════════════════════════════
// 用 list_agents 探测本会话有没有分层工具。在普通会话里它拿不到 plan_t0 等，
// 所以「负向测试」这一步必须在一遍**分层会话**里手工跑 —— 示例不假装能代跑。
const probe = run([join(REPO, 'scripts', 'verify-runner.mjs')], REPO);
check('verify-runner 无参数时拒绝（防假绿）', probe.code !== 0, `实际 exit=${probe.code}`);
info('本示例**不覆盖**：负向测试（plan_t0 是否真的没有 write/edit/pwsh）——');
info('  那需要一遍分层会话。步骤见 orchestrate/RUNBOOK-tiered.md §A。');

// ═══ 清理与汇总 ═══════════════════════════════════════════════════════════
rmSync(work, { recursive: true, force: true });
info('已清理临时坏例目录');

process.stdout.write(`${steps.join('\n')}\n`);
process.stdout.write(`\n${failed === 0 ? '===== 示例闭环全部通过 =====' : `===== ${failed} 步失败 =====`}\n`);
process.exitCode = failed === 0 ? 0 : 1;
