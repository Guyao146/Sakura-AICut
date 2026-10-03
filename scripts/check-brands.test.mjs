import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkRepository, scanText, validatePolicy, POLICY_FILE } from './check-brands.mjs';

// 使用虚构词，避免测试本身重新引入产品文案。
const word = 'samplevendor';
const policy = { forbidden: [word, '测试商标'], exceptions: [] };

test('大小写、全角字符与零宽字符不能绕过检测', () => {
  for (const text of [word.toUpperCase(), `${word}Adapter`, 'ｓａｍｐｌｅｖｅｎｄｏｒ', 'sample\u200bvendor', '引用测试商标']) {
    assert.ok(scanText('notes.txt', text, policy).length);
  }
  assert.equal(scanText('notes.txt', 'Sakura 与通用模型接口', policy).length, 0);
});

test('文件名与未列举的扩展名同样检查', () => {
  for (const file of ['docs/readme.mdx', '.env.example', 'Dockerfile', '.githooks/pre-commit', 'schema.sql']) {
    assert.ok(scanText(file, word, policy).length);
  }
  assert.ok(scanText(`images/${word}.svg`, '', policy).length);
});

test('技术例外只豁免精确片段，不能豁免同一行的宣传文案', () => {
  const rule = { file: 'adapter.ts', text: `protocol: '${word}'`, count: 1, reason: '持久化协议兼容' };
  const p = validatePolicy({ ...policy, exceptions: [rule] });
  assert.deepEqual(scanText(rule.file, rule.text, p), []);
  assert.ok(scanText(rule.file, `${rule.text}, label: '${word}'`, p).length);
  assert.ok(scanText('other.ts', rule.text, p).length);
  assert.ok(scanText(rule.file, `${rule.text}\n${rule.text}`, p).length);
  assert.ok(scanText(rule.file, '', p).some((hit) => hit.reason.includes('失效')));
});

test('拒绝整文件白名单、通配路径、重复词与额外元数据', () => {
  assert.throws(() => validatePolicy({ ...policy, allowedFiles: ['anything.ts'] }));
  assert.throws(() => validatePolicy({ forbidden: ['\u200b'], exceptions: [] }));
  assert.throws(() => validatePolicy({ forbidden: [word, word.toUpperCase()], exceptions: [] }));
  assert.throws(() => validatePolicy({ ...policy, exceptions: [{ file: '**/*.ts', text: word, count: 1, reason: '协议' }] }));
  assert.throws(() => validatePolicy({ ...policy, exceptions: [{ file: 'a.ts', text: word, count: 1, reason: word }] }));
});

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'sakura-brand-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  function git(...args) {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  git('init', '--quiet');
  git('config', 'core.autocrlf', 'false');
  mkdirSync(join(root, 'scripts'));
  writeFileSync(join(root, POLICY_FILE), JSON.stringify(policy));
  return { root, git, write: (file, text) => writeFileSync(join(root, file), text) };
}

test('全仓库扫描包含未跟踪文件，忽略依赖但不忽略已跟踪文件', (t) => {
  const f = fixture(t);
  f.write('.gitignore', 'generated/\n');
  mkdirSync(join(f.root, 'generated'));
  f.write('generated/ignored.txt', word);
  assert.equal(checkRepository(f.root).hits.length, 0);
  f.write('untracked.mdx', word);
  assert.ok(checkRepository(f.root).hits.some((hit) => hit.file === 'untracked.mdx'));
  f.git('add', '-f', 'generated/ignored.txt');
  assert.ok(checkRepository(f.root).hits.some((hit) => hit.file === 'generated/ignored.txt'));
});

test('暂存树检查不会被工作区的未暂存修复或规则修改绕过', (t) => {
  const f = fixture(t);
  f.write('readme.txt', word);
  f.git('add', '.');
  f.write('readme.txt', '已修复');
  assert.equal(checkRepository(f.root).hits.length, 0);
  assert.ok(checkRepository(f.root, { staged: true }).hits.length);
  f.write(POLICY_FILE, JSON.stringify({ forbidden: ['differentword'], exceptions: [] }));
  assert.ok(checkRepository(f.root, { staged: true }).hits.length);
  f.git('add', 'readme.txt');
  assert.equal(checkRepository(f.root, { staged: true }).hits.length, 0);
});

test('UTF-16 文本可检查；二进制和缺失例外不会被谎报为全面通过', (t) => {
  const f = fixture(t);
  f.write('notes.txt', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(word, 'utf16le')]));
  f.write('image.bin', Buffer.from([0, 1, 2, 3]));
  const result = checkRepository(f.root);
  assert.equal(result.binary, 1);
  assert.ok(result.hits.some((hit) => hit.file === 'notes.txt'));
  f.write(POLICY_FILE, JSON.stringify({ ...policy, exceptions: [{ file: 'missing.ts', text: word, count: 1, reason: '协议兼容' }] }));
  assert.ok(checkRepository(f.root).hits.some((hit) => hit.reason.includes('不存在')));
});

test('规则读取或解析失败必须报错，不能静默跳过', (t) => {
  const f = fixture(t);
  f.write(POLICY_FILE, '{');
  assert.throws(() => checkRepository(f.root));
  rmSync(join(f.root, POLICY_FILE));
  assert.throws(() => checkRepository(f.root));
});
