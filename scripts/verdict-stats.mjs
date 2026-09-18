// verdict-stats.mjs —— F2 通过率矩阵脚本
// 用法: "C:\\Program Files\\nodejs\\node.exe" scripts\verdict-stats.mjs --input <path>
// 读取 JSONL 判决记录（每行含 difficulty/tier/verdict），按 difficulty 再按 tier
// 分组，输出每组一行 + 一行 OVERALL。只读输入，不写任何文件。
// 注意：本文件不得含 shebang / 派生进程，避免假设 node 在 PATH 上。
import { readFileSync } from 'node:fs';
const PASS = 'pass';
const RATE_DIGITS = 1;
const EXIT_RUNTIME = 1;
const EXIT_USAGE = 2;
/** 帮助文本契约（冻结两行，不得变动）。第 1 行用 node 绝对路径：沙箱内 PATH 为空，裸调 node 必失败。 */
const USAGE_LINE = '用法: "C:\\Program Files\\nodejs\\node.exe" scripts\\verdict-stats.mjs --input <path>';
const USAGE_DESC = '读取 verdict JSONL（每行含 difficulty/tier/verdict），输出通过率矩阵。';
/** 解析 --input <path>，缺失或未带值时返回 null。 */
function parseArgs(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input') {
      const value = argv[i + 1];
      return typeof value === 'string' && value.length > 0 && !value.startsWith('--') ? value : null;
    }
    if (arg.startsWith('--input=')) {
      const value = arg.slice('--input='.length);
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

/** 读取并解析 JSONL；空行忽略，字段缺失按空字符串处理。 */
function readRecords(filePath) {
  const text = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const records = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line === '') continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      throw new Error(`第 ${i + 1} 行不是合法 JSON`);
    }
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error(`第 ${i + 1} 行不是 JSON 对象`);
    }
    records.push({
      difficulty: String(row.difficulty ?? ''),
      tier: String(row.tier ?? ''),
      verdict: String(row.verdict ?? ''),
    });
  }
  return records;
}

/** 通过率保留一位小数，如 66.67 -> "66.7"；无样本时记 0.0。 */
function formatRate(passCount, total) {
  return total === 0 ? (0).toFixed(RATE_DIGITS) : ((passCount / total) * 100).toFixed(RATE_DIGITS);
}

/** 按 difficulty 字典序、再按 tier 字典序聚合。 */
function groupRecords(records) {
  const groups = new Map();
  for (const record of records) {
    const key = `${record.difficulty}\u0000${record.tier}`;
    let bucket = groups.get(key);
    if (bucket === undefined) {
      bucket = { difficulty: record.difficulty, tier: record.tier, pass: 0, total: 0 };
      groups.set(key, bucket);
    }
    bucket.total += 1;
    if (record.verdict === PASS) bucket.pass += 1;
  }
  const ordered = [...groups.values()];
  ordered.sort((a, b) => {
    if (a.difficulty !== b.difficulty) return a.difficulty < b.difficulty ? -1 : 1;
    if (a.tier !== b.tier) return a.tier < b.tier ? -1 : 1;
    return 0;
  });
  return ordered;
}

/** 是否请求帮助（--help 或 -h）。 */
function hasHelpFlag(argv) { return argv.includes('--help') || argv.includes('-h'); }

function main(argv) {
  if (hasHelpFlag(argv)) {
    process.stdout.write(`${USAGE_LINE}\n${USAGE_DESC}\n`);
    return 0;
  }

  const inputPath = parseArgs(argv);
  if (inputPath === null) {
    process.stderr.write(`${USAGE_LINE}\n`);
    return EXIT_USAGE;
  }

  let records;
  try {
    records = readRecords(inputPath);
  } catch (error) {
    process.stderr.write(`错误: 无法读取或解析输入 ${inputPath}: ${error.message}\n`);
    return EXIT_RUNTIME;
  }

  const groups = groupRecords(records);
  const lines = groups.map(
    (group) =>
      `${group.difficulty} ${group.tier} pass=${group.pass} total=${group.total} rate=${formatRate(group.pass, group.total)}%`,
  );

  const total = records.length;
  const totalPass = records.filter((record) => record.verdict === PASS).length;
  lines.push(`OVERALL pass=${totalPass} total=${total} rate=${formatRate(totalPass, total)}%`);

  process.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
