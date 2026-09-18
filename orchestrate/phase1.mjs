/**
 * tiered-collab · Phase 1 编排脚本体（canonical 源）
 *
 * 用法：把本文件正文（去掉本段注释）作为 `workflow` 工具的 script 参数。
 * 阶段：plan(T0) → implement(T1/T2) → verify(T1) → escalate(带 findings 重试一次)
 *
 * 设计要点（对应方案原文）：
 *  - Planner 只产结构化任务卡，不写代码（§4 铁律 1）
 *  - Worker 独立上下文，只做这一张卡，不许扩范围（§3 铁律 2）
 *  - Verifier 只看 diff + 验收标准，不看推理过程（§3 铁律 3）
 *  - 先硬后软：验收命令不过直接 reject，不浪费语义判定（§8.1）
 *  - reject 时带 findings 重试一次，第二次仍 reject 就如实报 failed（§5.2 / §11 坑 2）
 *
 * 已知限制（如实记录，不要假装没有）：
 *  - workflow 的 agent() 只支持 provider/model 覆盖，**不支持 reasoning_effort**，
 *    所以本脚本只能做到「模型分档」（pro / flash），做不到「思考/非思考分档」。
 *    思考档位要靠 subagent 工具（需开启 subagent-model-selection 设置）或 preset 的 agentOptions。
 */

const OFFICIAL = 'deepseek-official'
const T0_MODEL = 'deepseek-v4-pro'
const T1_MODEL = 'deepseek-v4-flash'

const ENV = [
  '【本机环境硬约束，违反必然失败】',
  '- 沙箱内 PATH 是空字符串：node / git / npm 都不能裸调，必须写绝对路径。',
  '- Node 绝对路径：C:\\Program Files\\nodejs\\node.exe （v23.2.0）',
  '- 本仓库根目录是 tiered-collab/，不要往仓库外写文件。',
  '- 只用 Node 内置模块，禁止第三方依赖；文件 UTF-8 无 BOM。',
  '- 只允许 Windows PowerShell（pwsh 工具）。',
].join('\n')

const ACCEPT_A = '& "C:\\Program Files\\nodejs\\node.exe" tiered-collab/scripts/verdict-stats.mjs --input tiered-collab/fixtures/verdicts.sample.jsonl'
const ACCEPT_B = '& "C:\\Program Files\\nodejs\\node.exe" tiered-collab/scripts/verdict-stats.mjs --input tiered-collab/fixtures/verdicts.alt.jsonl'

const EXPECT_A = [
  'L0 T2 pass=3 total=3 rate=100.0%',
  'L1 T1 pass=2 total=3 rate=66.7%',
  'L1 T2 pass=2 total=2 rate=100.0%',
  'L2 T0 pass=1 total=2 rate=50.0%',
  'OVERALL pass=8 total=10 rate=80.0%',
].join('\n')

const EXPECT_B = [
  'L0 T2 pass=2 total=2 rate=100.0%',
  'L1 T1 pass=0 total=2 rate=0.0%',
  'L2 T0 pass=1 total=2 rate=50.0%',
  'OVERALL pass=3 total=6 rate=50.0%',
].join('\n')

const TASKCARD_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['id', 'title', 'difficulty', 'tier', 'goal', 'inScope', 'acceptance'],
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    difficulty: { type: 'string', enum: ['L0', 'L1', 'L2'] },
    tier: { type: 'string', enum: ['T0', 'T1', 'T2'] },
    goal: { type: 'string' },
    constraints: { type: 'array', items: { type: 'string' } },
    inScope: { type: 'array', items: { type: 'string' } },
    outOfScope: { type: 'array', items: { type: 'string' } },
    acceptance: {
      type: 'object', additionalProperties: false, required: ['commands'],
      properties: {
        commands: { type: 'array', items: { type: 'string' } },
        expected: { type: 'string' },
      },
    },
    contextRefs: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['path'],
        properties: { path: { type: 'string' }, lines: { type: 'string' } },
      },
    },
  },
}

const IMPL_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['changedFiles', 'summary', 'ranAcceptance'],
  properties: {
    changedFiles: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    ranAcceptance: { type: 'boolean' },
    rawOutput: { type: 'string' },
  },
}

const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['verdict', 'reason', 'commandResults'],
  properties: {
    verdict: { type: 'string', enum: ['pass', 'reject'] },
    reason: { type: 'string' },
    commandResults: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['command', 'status'],
        properties: {
          command: { type: 'string' },
          status: { type: 'string', enum: ['passed', 'failed'] },
          exitCode: { type: 'number' },
          evidence: { type: 'string' },
        },
      },
    },
    findings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'severity', 'problem', 'requiredFix'],
        properties: {
          id: { type: 'string' },
          severity: { type: 'string', enum: ['low', 'medium', 'high', 'blocker'] },
          problem: { type: 'string' },
          requiredFix: { type: 'string' },
          file: { type: 'string' },
        },
      },
    },
  },
}

const plannerPrompt = [
  '你是 T0 规划层（Planner）。你只拆任务，绝不写实现代码，也绝不输出任何文件内容。',
  '',
  '先用 read 工具真实读取这两个文件，不要凭猜测：',
  '- tiered-collab/docs/TASK_BRIEF.md（重点看 §3 的 F2 输出契约与 §4 技术约束）',
  '- tiered-collab/fixtures/verdicts.sample.jsonl（验收输入样本，10 条记录）',
  '',
  '目标：把里程碑 M1 的 T-001「实现通过率矩阵脚本」拆成**一张原子任务卡**。',
  '',
  ENV,
  '',
  '产出规则：',
  '- difficulty：L0 机械型 / L1 单点逻辑型 / L2 架构型，按你的判断打标。',
  '- tier：按 difficulty 给出建议档位（L0→T2，L1→T1，L2→T0）。',
  '- inScope：**只能有 1 个新文件** tiered-collab/scripts/verdict-stats.mjs。',
  '- outOfScope：至少写明不许改 fixtures/、不许改 docs/、不许引入依赖。',
  '- acceptance.commands：必须是可直接执行的 PowerShell 命令，含 node 绝对路径。',
  '- acceptance.expected：把 F2 契约里那 5 行期望输出原样写进去。',
  '- contextRefs：只放指针（path，可选 lines），**禁止内联文件内容**。',
  '- constraints：必须包含 PATH 为空、node 绝对路径、零第三方依赖这三条。',
].join('\n')

function workerPrompt(card, attempt, priorFindings) {
  return [
    `你是执行层 Worker（第 ${attempt} 次尝试）。范围已经定死，禁止"顺便"扩展。`,
    '',
    '【任务卡 TaskCard】',
    JSON.stringify(card, null, 2),
    '',
    ENV,
    '',
    `【上一次的失败原因（必须针对性修复）】\n${priorFindings}`,
    '',
    '执行要求：',
    '1. 先 read tiered-collab/docs/TASK_BRIEF.md 的 §3，确认 F2 输出契约（5 行的确切格式与数值规则）。',
    '2. 只在 inScope 内新建文件，不要碰 fixtures/ 与 docs/。',
    '3. 自己用 pwsh 跑一次验收命令，确认退出码 0 且输出与契约完全一致后再回报。',
    '',
    `验收命令：${ACCEPT_A}`,
    '期望输出（必须逐字一致）：',
    EXPECT_A,
    '',
    '回报要求：changedFiles 只列真实改动的文件；summary 一两句话；ranAcceptance 表示你是否真的跑过；',
    'rawOutput 粘贴你跑出来的实际 stdout（不要改写、不要美化）。',
  ].join('\n')
}

function verifierPrompt(card, impl) {
  return [
    '你是独立复核层 Verifier。你只能看任务卡、验收标准与 Worker 的产出，不要看它的推理过程。',
    '铁律：**先硬后软**。硬验收不过就直接 reject 并给出 findings，不要做语义评价。',
    '',
    '【任务卡】',
    JSON.stringify(card, null, 2),
    '',
    '【Worker 自报】',
    JSON.stringify(impl, null, 2),
    '',
    ENV,
    '',
    '=== 第 1 步：硬验收（必须自己用 pwsh 真实执行，不许凭 Worker 自报下结论）===',
    `A) ${ACCEPT_A}`,
    '   A 的期望输出：',
    EXPECT_A,
    `B) ${ACCEPT_B}`,
    '   B 的期望输出（Worker 不知道这组数字，用它判定脚本是否真在计算）：',
    EXPECT_B,
    '两条都通过才进入第 2 步；任何一条失败或退出码非 0 → verdict=reject。',
    '',
    '=== 第 2 步：软验收（仅在硬验收通过后执行）===',
    '1) 反作弊：脚本必须真的读取 --input 指向的文件并计算。用 read 工具检查实现；',
    '   若发现硬编码期望输出（写死五行字符串）、按文件名特判、或忽略 --input，判 reject。',
    '2) 契约：rate 保留一位小数；分组按 difficulty 再按 tier 字典序；OVERALL 在最后一行。',
    '3) 范围：实际改动文件必须全部落在 inScope 内；若动了 fixtures/ 或 docs/ 判 reject。',
    '',
    'reject 时 findings 必须非空，每条给出 id / severity / problem / requiredFix（可带 file）。',
    'commandResults 必须逐条对应你实际执行的命令，并带上真实 exitCode 与关键输出的 evidence。',
  ].join('\n')
}

// ── 执行 ────────────────────────────────────────────────────────────────────

phase('plan')
log('T0 规划层：拆任务卡（deepseek-v4-pro）')
const card = await agent(plannerPrompt, {
  schema: TASKCARD_SCHEMA, provider: OFFICIAL, model: T0_MODEL,
  label: 'planner-T0', phase: 'plan',
})
if (card === null) throw new Error('planner 未产出合法 TaskCard，停止编排')
log(`任务卡：${card.id} ${card.title} · difficulty=${card.difficulty} tier=${card.tier}`)

const attempts = []
let verdict = null
let impl = null

const MAX_ATTEMPTS = 2
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  const retrying = attempt > 1
  const stage = retrying ? 'escalate' : 'implement'
  const priorFindings = retrying
    ? JSON.stringify(verdict?.findings ?? [], null, 2)
    : '（首次尝试，无历史失败原因）'

  phase(stage)
  log(`Worker 第 ${attempt} 次尝试（deepseek-v4-flash）${retrying ? ' · 带上次 findings 重试' : ''}`)
  impl = await agent(workerPrompt(card, attempt, priorFindings), {
    schema: IMPL_SCHEMA, provider: OFFICIAL, model: T1_MODEL,
    label: `worker-${attempt}`, phase: stage,
  })

  phase('verify')
  log(`Verifier 第 ${attempt} 轮复核（deepseek-v4-flash）`)
  verdict = await agent(verifierPrompt(card, impl), {
    schema: VERDICT_SCHEMA, provider: OFFICIAL, model: T1_MODEL,
    label: `verifier-${attempt}`, phase: 'verify',
  })

  attempts.push({ attempt, impl, verdict })
  if (verdict?.verdict === 'pass') break
  if (attempt === MAX_ATTEMPTS) {
    log('已达重试上限，如实上报失败（不谎报成功）')
  }
}

return {
  card,
  attempts,
  finalStatus: verdict?.verdict === 'pass' ? 'passed' : 'failed',
  note: 'workflow agent() 不支持 reasoning_effort，本轮只做到模型分档；思考档位需 subagent-model-selection 设置或 preset agentOptions',
}
