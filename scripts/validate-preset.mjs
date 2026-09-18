// validate-preset.mjs —— 零依赖的结构校验：确认 preset 的 YAML 形状仍然合法
// 边界：本脚本不实现完整 YAML 解析器，只校验「本 preset 用到的子集」——
//       block sequence(- id:) / block mapping / 行内 [a, b] 列表 / !!js 标签 /
//       cordis:group 嵌套缩进。任何一行既不属于已知形状、缩进又不连续，即报错。
import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) { process.stderr.write('用法: validate-preset.mjs <path>\n'); process.exit(2); }
const text = readFileSync(path, 'utf8');

const problems = [];
const lines = text.split(/\r?\n/);
let prevIndent = 0;
let inBlockScalar = false;
let blockScalarIndent = 0;
const seen = { deny: 0, maxDepth: 0, id: 0 };

for (let i = 0; i < lines.length; i += 1) {
  const raw = lines[i];
  const lineNo = i + 1;
  if (raw.includes('\t')) problems.push(`L${lineNo}: 含 TAB（YAML 非法缩进）`);
  if (raw.trim() === '') continue;
  if (raw.trimStart().startsWith('#')) continue;

  const indent = raw.length - raw.trimStart().length;

  // 块标量（>- / |）内部允许任意缩进，直到遇到更浅的缩进
  if (inBlockScalar) {
    if (indent > blockScalarIndent) continue;
    inBlockScalar = false;
  }

  const t = raw.trim();
  const m = /^(deny|maxDepth|id|name|config|group|isolate|persona|provider|toolName|backgroundMode|agentOptions|toolFilter|model|reasoningEffort|maxTokens|disabled|suffix|prefix|maxBytes|customSkillDirs|section|thresholdChars|headChars|tailChars|subagentProvider|maxRounds|fetch|searchTimeoutMs|allowParallelInProgress|roots|path|trust|sampleOverCapGlobResults|workflowEngine|planMode|compaction|toolResultPruner|tokenMeter|enableRunInBackground|modelSelectionSettings|backgroundMode):/.exec(t);
  const isSeqItem = t.startsWith('- ');

  if (!m && !isSeqItem) {
    problems.push(`L${lineNo}: 无法识别的行形状 -> ${t.slice(0, 60)}`);
  }
  if (indent % 2 !== 0) problems.push(`L${lineNo}: 缩进 ${indent} 不是 2 的倍数`);

  if (m) {
    const key = m[1];
    if (key in seen) seen[key] += 1;
    if (key === 'persona' || key === 'section' || key === 'prefix' || key === 'suffix') {
      if (/[>|][-+]?\s*$/.test(t)) { inBlockScalar = true; blockScalarIndent = indent; }
    }
  }
  if (t.startsWith('- id:')) seen.id += 1;
  prevIndent = indent;
}

// 断言：分层约束必须与「能力面」设计一致（第四轮修订）
//   plan_t0   = deny [write, edit, pwsh] —— 只拆不写，且不需要 shell（read/grep/glob 足够）
//   verify_t1 = deny [write, edit]       —— **保留 pwsh**，否则 F4「自己跑验收命令」不可满足；
//                                          写入风险改由「副本执行协议」+ SHA1 前后核对拦截
const denyLines = lines.map((l, i) => ({ l, i: i + 1 })).filter((x) => /deny:/.test(x.l));
const denyOf = (n) => (denyLines[n - 1]?.l ?? '').trim();
const planDenyOk = denyLines.length === 2 && /pwsh/.test(denyOf(1));
const verifyDenyOk = denyLines.length === 2
  && !/pwsh/.test(denyOf(2)) && /write/.test(denyOf(2)) && /edit/.test(denyOf(2));
if (!planDenyOk) problems.push(`第 1 处 deny（plan_t0）必须含 pwsh，实际: ${denyOf(1)}`);
if (!verifyDenyOk) problems.push(`第 2 处 deny（verify_t1）必须含 write+edit 且不含 pwsh，实际: ${denyOf(2)}`);

const forkIdx = lines.findIndex((l) => /toolName: subagent_fork/.test(l));
const forkHasMaxDepth = forkIdx >= 0 && lines.slice(forkIdx, forkIdx + 6).some((l) => /maxDepth:/.test(l));
if (!forkHasMaxDepth) problems.push('subagent_fork 后 6 行内没有显式 maxDepth');

const out = {
  file: path,
  lines: lines.length,
  registryRows: seen.id,
  denyLines: denyLines.map((x) => `L${x.i}: ${x.l.trim()}`),
  forkHasExplicitMaxDepth: forkHasMaxDepth,
  problems,
  ok: problems.length === 0,
};
process.stdout.write(JSON.stringify(out, null, 2) + '\n');
process.exit(problems.length === 0 ? 0 : 1);
