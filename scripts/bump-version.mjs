/**
 * 一键升级全工作区版本号：同步更新所有 package.json 与前端版本常量。
 * 用法：
 *   pnpm bump              # 默认升 patch（0.2.0 -> 0.2.1）
 *   pnpm bump minor        # 0.2.0 -> 0.3.0
 *   pnpm bump major        # 0.2.0 -> 1.0.0
 *   pnpm bump 1.2.3        # 指定版本号
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  'package.json',
  'apps/web/package.json',
  'apps/worker/package.json',
  'packages/core/package.json',
  'packages/db/package.json',
  'packages/pipeline/package.json',
];
const versionFile = join(root, 'packages/core/src/version.ts');

function bump(current, mode) {
  if (/^\d+\.\d+\.\d+$/.test(mode)) return mode;
  const [major, minor, patch] = current.split('.').map(Number);
  if (mode === 'major') return `${major + 1}.0.0`;
  if (mode === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor + 0}.${patch + 1}`;
}

const mode = process.argv[2] ?? 'patch';
let next = null;
for (const rel of files) {
  const path = join(root, rel);
  const json = JSON.parse(readFileSync(path, 'utf8'));
  if (!next) next = bump(json.version, mode);
  if (json.version === next && rel !== 'package.json') continue;
  json.version = next;
  writeFileSync(path, JSON.stringify(json, null, 2) + '\n');
  console.log(`${rel} -> ${next}`);
}
writeFileSync(versionFile, `/** 应用版本号（由 pnpm bump 同步，请勿手动编辑） */\nexport const APP_VERSION = '${next}';\n`);
console.log(`packages/core/src/version.ts -> ${next}`);
console.log(`✓ 版本已升级到 ${next}`);
