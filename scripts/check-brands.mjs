import { spawnSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const POLICY_FILE = 'scripts/brand-policy.json';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function normalize(text) {
  return text.normalize('NFKC').replace(/[\u200b-\u200d\ufeff]/g, '').toLowerCase();
}
function matches(text, forbidden) {
  const normalized = normalize(text);
  const hits = [];
  for (const term of forbidden) {
    const needle = normalize(term);
    let start = 0;
    for (let at; (at = normalized.indexOf(needle, start)) !== -1; start = at + needle.length) {
      // 较长名称同时检查变量名中的嵌入；短英文词保留边界，避免误伤普通单词。
      const ascii = /^[a-z0-9]/i.test(needle) && needle.length <= 4;
      if (ascii && (/[a-z0-9]/i.test(normalized[at - 1] ?? '') || /[a-z]/i.test(normalized[at + needle.length] ?? ''))) continue;
      hits.push({ at, term });
    }
  }
  return hits;
}

export function validatePolicy(policy) {
  if (!policy || Object.keys(policy).some((key) => !['forbidden', 'exceptions'].includes(key)) ||
      !Array.isArray(policy.forbidden) || !policy.forbidden.length || !Array.isArray(policy.exceptions)) {
    throw new Error('品牌规则格式错误，不允许整文件白名单或额外字段');
  }
  if (policy.forbidden.some((term) => typeof term !== 'string' || !normalize(term).trim()) ||
      new Set(policy.forbidden.map(normalize)).size !== policy.forbidden.length) throw new Error('词表存在空项或重复项');
  const unique = new Set();
  for (const rule of policy.exceptions) {
    if (Object.keys(rule).some((key) => !['file', 'text', 'count', 'reason'].includes(key)) ||
        typeof rule.file !== 'string' || !rule.file || /[\\*?]|^\/|(?:^|\/)\.\.(?:\/|$)/.test(rule.file) ||
        rule.file === POLICY_FILE || typeof rule.text !== 'string' || !rule.text.trim() || rule.text.includes('\n') ||
        !Number.isInteger(rule.count) || rule.count < 1 || typeof rule.reason !== 'string' || !rule.reason.trim() ||
        !matches(rule.text, policy.forbidden).length || matches(rule.reason, policy.forbidden).length) {
      throw new Error('技术例外必须包含精确文件、单行代码片段、次数与中性原因');
    }
    const key = `${rule.file}\0${rule.text}`;
    if (unique.has(key)) throw new Error('技术例外重复');
    unique.add(key);
  }
  return policy;
}

export function scanText(file, text, policy) {
  const hits = matches(file, policy.forbidden).map(() => ({ file, line: 0, reason: '文件名含品牌' }));
  if (file === POLICY_FILE) return hits; // 仅经过严格格式验证的规则元数据可记录匹配词。
  const rules = policy.exceptions.filter((rule) => rule.file === file);
  const used = new Map();
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index];
    for (const rule of rules) {
      let at;
      while ((at = line.indexOf(rule.text)) !== -1 && (used.get(rule) ?? 0) < rule.count) {
        line = line.slice(0, at) + ' '.repeat(rule.text.length) + line.slice(at + rule.text.length);
        used.set(rule, (used.get(rule) ?? 0) + 1);
      }
    }
    for (const _hit of matches(line, policy.forbidden)) hits.push({ file, line: index + 1, reason: '含非必要品牌信息' });
  }
  for (const rule of rules) {
    if ((used.get(rule) ?? 0) !== rule.count) hits.push({ file, line: 0, reason: '技术例外已失效，必须同步删除或更新' });
  }
  return hits;
}

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`无法读取版本管理文件：${result.error?.message ?? result.stderr?.toString()}`);
  return result.stdout;
}
function decode(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString('utf16le');
  if (buffer.includes(0)) return null;
  return buffer.toString('utf8').replace(/^\ufeff/, '');
}

export function checkRepository(root = ROOT, { staged = false } = {}) {
  const files = [...new Set(git(root, ['ls-files', '-z', '--cached', ...(staged ? [] : ['--others', '--exclude-standard'])])
    .toString('utf8').split('\0').filter(Boolean))];
  function read(file) {
    if (staged) return git(root, ['show', `:${file}`]);
    const full = join(root, file);
    try {
      if (!lstatSync(full).isFile()) throw new Error(`不支持自动审查的文件类型：${file}`);
      return readFileSync(full);
    } catch (error) {
      if (error.code === 'ENOENT' && file !== POLICY_FILE) return null; // 工作区待提交的删除
      throw error;
    }
  }
  const policy = validatePolicy(JSON.parse(decode(read(POLICY_FILE))));
  const hits = [];
  const seen = new Set();
  let scanned = 0;
  let binary = 0;
  for (const file of files) {
    const buffer = read(file);
    if (buffer === null) continue;
    seen.add(file);
    const text = decode(buffer);
    if (text === null) {
      binary++;
      hits.push(...scanText(file, '', { ...policy, exceptions: [] }));
      continue;
    }
    scanned++;
    hits.push(...scanText(file, text, policy));
  }
  for (const file of new Set(policy.exceptions.map((rule) => rule.file))) {
    if (!seen.has(file)) hits.push({ file, line: 0, reason: '技术例外指向不存在的文件' });
  }
  return { hits, scanned, binary };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.slice(2).some((arg) => arg !== '--staged')) throw new Error('仅支持 --staged 参数');
    const result = checkRepository(ROOT, { staged: process.argv.includes('--staged') });
    for (const hit of result.hits) console.error(`${join(ROOT, hit.file)}:${hit.line}: ${hit.reason}`);
    console.log(`品牌检查：扫描 ${result.scanned} 个文本文件，${result.hits.length} 项违规；${result.binary} 个二进制文件需人工审查。`);
    process.exitCode = result.hits.length ? 1 : 0;
  } catch (error) {
    console.error(`品牌检查失败：${error.message}`);
    process.exitCode = 1;
  }
}
