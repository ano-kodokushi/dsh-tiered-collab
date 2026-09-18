// tier-advice.mjs —— T-002 定档建议（阈值 + 最小样本量）
// 用法: "C:\Program Files\nodejs\node.exe" <仓库根>\scripts\tier-advice.mjs --input <path>
// 读取 JSONL 判决记录，按 difficulty 再按 tier 分组：样本量足够时输出 down/up/hold，
// 样本量不足时输出 none；只读输入，不写任何文件；独立于 verdict-stats.mjs，不影响其 F2 契约。
// 注意：本文件不得含 shebang / 派生进程，避免假设 node 在 PATH 上。
import { readFileSync } from 'node:fs';

const PASS = 'pass', RATE_DIGITS = 1, EXIT_RUNTIME = 1, EXIT_USAGE = 2, MIN_SAMPLE_SIZE = 3;
const DOWN_RATE_PCT = 100, UP_RATE_PCT = 50, ADVICE_DOWN = 'down', ADVICE_UP = 'up';
const ADVICE_HOLD = 'hold', ADVICE_NONE = 'none';

/** 解析 --input <path>；缺失或未带值时返回 null（调用方据此判用法错误）。 */
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

/** 读取并解析 JSONL；忽略空行与 BOM，字段缺失按空字符串处理，非对象或非法 JSON 抛出。 */
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

/** 通过率保留一位小数并返回数值，如 33.33 -> 33.3；无样本记 0。 */
function ratePercent(passCount, total) {
  return total === 0 ? 0 : Number(((passCount / total) * 100).toFixed(RATE_DIGITS));
}

/** 按 difficulty 字典序、再按 tier 字典序聚合，返回排序后的分组。 */
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

/** 判定定档建议：样本量不足返回 none 且不评估阈值；否则满分降档、低通过率升档、其余保持。 */
function decideAdvice(passCount, total) {
  if (total < MIN_SAMPLE_SIZE) return ADVICE_NONE;
  const rate = ratePercent(passCount, total);
  if (rate >= DOWN_RATE_PCT) return ADVICE_DOWN;
  if (rate < UP_RATE_PCT) return ADVICE_UP;
  return ADVICE_HOLD;
}

function main(argv) {
  const inputPath = parseArgs(argv);
  if (inputPath === null) {
    process.stderr.write('用法: "C:\\Program Files\\nodejs\\node.exe" <仓库根>\\scripts\\tier-advice.mjs --input <path>\n');
    return EXIT_USAGE;
  }
  let records;
  try {
    records = readRecords(inputPath);
  } catch (error) {
    process.stderr.write(`错误: 无法读取或解析输入 ${inputPath}: ${error.message}\n`);
    return EXIT_RUNTIME;
  }
  const lines = groupRecords(records).map(
    (group) =>
      `${group.difficulty} ${group.tier} pass=${group.pass} total=${group.total} ` +
      `rate=${ratePercent(group.pass, group.total).toFixed(RATE_DIGITS)}% advice=${decideAdvice(group.pass, group.total)}`,
  );
  process.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
