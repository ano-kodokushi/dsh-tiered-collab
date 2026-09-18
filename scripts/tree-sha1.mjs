// tree-sha1.mjs —— 文件树 SHA1 快照
//
// 用途：给一组目录做「相对路径 -> SHA1」快照，用于证明某棵树在执行前后未被改动。
// 为什么独立成模块：本仓库不是 git 仓库（`git rev-parse` 退出码 128），
//   没有 `git status` 可用，改动范围证据只能靠 mtime + 哈希（见 BOARD 阻塞区 B）。
//   一处实现、多处复用，避免每个校验脚本各写一遍。
// 边界条件：
//   - 只读，绝不写任何文件
//   - 目录不存在时跳过（不报错），便于对可选目录调用
//   - 键为工作区相对 POSIX 路径；新增/删除/改动都会体现为快照差异
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/** 对 root 下的每个 dir 递归收集 SHA1；返回 { 相对路径: sha1 }。 */
export function snapshotTree(root, dirs) {
  const out = {};
  const digest = (file) => createHash('sha1').update(readFileSync(file)).digest('hex');
  const walk = (abs) => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const child = join(abs, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) out[relative(root, child).replace(/\\/g, '/')] = digest(child);
    }
  };
  for (const dir of dirs) {
    const abs = join(root, dir);
    if (existsSync(abs)) walk(abs);
  }
  return out;
}

/** 比较两份快照，返回被新增/改动/删除的相对路径（字典序）。 */
export function diffSnapshots(before, after) {
  const changed = Object.keys(after).filter((k) => before[k] !== after[k]);
  const removed = Object.keys(before).filter((k) => after[k] === undefined);
  return [...changed, ...removed].sort();
}
