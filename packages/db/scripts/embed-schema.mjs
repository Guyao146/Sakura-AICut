// 构建期把 schema.sql 内嵌成 TS 字符串，避免运行时动态读取文件
// （Next.js 16 的 Turbopack 会把动态 fs 访问视为错误，且 standalone 产物不便携带 .sql）
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, '..', 'src', 'schema.sql');
const target = join(here, '..', 'src', 'schema.generated.ts');

const sql = readFileSync(source, 'utf8');
const content = `/* eslint-disable */
// 该文件由 packages/db/scripts/embed-schema.mjs 自动生成，请勿手工修改。
// 源文件：packages/db/src/schema.sql
export const SCHEMA_SQL = ${JSON.stringify(sql)};
`;

writeFileSync(target, content, 'utf8');
console.log(`已生成 schema.generated.ts（${sql.length} 字符）`);
