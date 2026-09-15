import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { SCHEMA_SQL } from './schema.generated';

/**
 * SQLite 连接与迁移
 * 使用 Node 22.5+ 内置的 node:sqlite，零原生依赖，容器内开箱即用。
 * 建表语句在构建期由 schema.sql 内嵌为字符串（见 scripts/embed-schema.mjs）。
 */

let instance: DatabaseSync | null = null;

let cachedDataDir: string | null = null;

/**
 * 数据目录
 * 1. 优先使用环境变量 SAKURA_DATA_DIR
 * 2. 否则向上查找仓库根目录（含 pnpm-workspace.yaml），使用 <root>/data
 * 3. 兜底使用 <cwd>/data
 * 这样 web / worker / CLI 在任意工作目录下都会命中同一个数据库。
 */
export function dataDir(): string {
  if (cachedDataDir) return cachedDataDir;
  const configured = process.env.SAKURA_DATA_DIR?.trim();
  if (configured) {
    cachedDataDir = isAbsolute(configured) ? configured : resolve(/* turbopackIgnore: true */ process.cwd(), configured);
    return cachedDataDir;
  }
  let dir = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(/* turbopackIgnore: true */ dir, 'pnpm-workspace.yaml'))) {
      cachedDataDir = join(dir, 'data');
      return cachedDataDir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  cachedDataDir = join(process.cwd(), 'data');
  return cachedDataDir;
}

export function ensureDir(dir: string): string {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** 解析 schema.sql 的位置（兼容本地开发、Monorepo、Docker 镜像三种情况） */
function applyMigrations(db: DatabaseSync): void {
  db.exec(SCHEMA_SQL);
  const now = new Date().toISOString();
  db.prepare('INSERT OR REPLACE INTO migrations (id, applied_at) VALUES (?, ?)').run('0001_init', now);
}

/** 获取数据库连接（单例） */
export function getDb(): DatabaseSync {
  if (instance) return instance;
  const dir = ensureDir(dataDir());
  const file = process.env.SAKURA_DB_FILE?.trim() || join(dir, 'sakura.db');
  ensureDir(dirname(file));

  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 8000;');
  applyMigrations(db);
  instance = db;
  return db;
}

/** 关闭连接（测试 / 退出时用） */
export function closeDb(): void {
  instance?.close();
  instance = null;
}

/** 事务包装 */
export function transaction<T>(fn: (db: DatabaseSync) => T): T {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(db);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw error;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** JSON 列解析 */
export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function boolToInt(value: boolean | undefined): number {
  return value ? 1 : 0;
}

export function intToBool(value: unknown): boolean {
  return value === 1 || value === true;
}

/** 生成动态 UPDATE 语句 */
export function buildUpdate(
  table: string,
  id: string,
  fields: Record<string, unknown>,
): { sql: string; values: unknown[] } {
  const keys = Object.keys(fields);
  if (keys.length === 0) throw new Error('没有需要更新的字段');
  const setClause = keys.map((key) => `${key} = ?`).join(', ');
  const values = keys.map((key) => fields[key] as never);
  return { sql: `UPDATE ${table} SET ${setClause}, updated_at = ? WHERE id = ?`, values: [...values, nowIso(), id] };
}
