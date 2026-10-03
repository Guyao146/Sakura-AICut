import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { createId } from '@sakura/core';
import { getDb, nowIso } from '../client';
import { getSetting, setSetting } from './system';

/**
 * 本地账户仓储：密码哈希与会话记录
 *
 * 不依赖外部 IdP：单用户本地应用，密码以 scrypt 哈希存在 settings 表，
 * 会话令牌（HMAC）存在内存 / sessions 表用于踢出与统计在线设备。
 * sessions 表由 client.ts 的 applyMigrations 创建。
 */

const PASSWORD_SETTING_KEY = 'admin_password_hash';

export interface PasswordHash {
  /** scrypt 盐（hex） */
  salt: string;
  /** 哈希值（hex） */
  hash: string;
  /** 算法版本：将来更换 KDF 时用 */
  algo: 'scrypt';
}

/** 设置管理员密码（明文 → scrypt 哈希） */
export function setAdminPassword(plain: string): void {
  validatePassword(plain);
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(plain, salt, 64).toString('hex');
  setSetting(PASSWORD_SETTING_KEY, { salt, hash, algo: 'scrypt' } satisfies PasswordHash);
}

/** 读取密码哈希；未设置时返回 null */
export function getAdminPassword(): PasswordHash | null {
  return getSetting<PasswordHash | null>(PASSWORD_SETTING_KEY, null);
}

/** 校验明文密码是否匹配 */
export function verifyAdminPassword(plain: string): boolean {
  const record = getAdminPassword();
  if (!record) return false;
  const computed = scryptSync(plain, record.salt, 64);
  const expected = Buffer.from(record.hash, 'hex');
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

export function hasAdminPassword(): boolean {
  return getAdminPassword() !== null;
}

function validatePassword(plain: string): void {
  if (typeof plain !== 'string' || plain.length < 8) throw new Error('密码至少需要 8 个字符');
  if (plain.length > 128) throw new Error('密码不能超过 128 个字符');
}

/* ------------------------- 会话记录 ------------------------- */

export interface SessionRow {
  id: string;
  /** 令牌指纹：SHA-256，用于校验与踢出，不存原令牌 */
  digest: string;
  userAgent: string | null;
  remoteAddress: string | null;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
}

const SESSIONS_TABLE = 'sessions';

/** 记录一条活跃会话 */
export function recordSession(input: { digest: string; userAgent?: string | null; remoteAddress?: string | null }): void {
  const db = getDb();
  const id = `ses_${createId(12)}`;
  const now = nowIso();
  db.prepare(
    `INSERT INTO ${SESSIONS_TABLE} (id, digest, user_agent, remote_address, created_at, last_seen_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(digest) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
  ).run(id, input.digest, input.userAgent ?? null, input.remoteAddress ?? null, now, now);
}

/** 按 digest 查会话；不存在或已注销返回 null */
export function findSession(digest: string): SessionRow | null {
  const row = getDb()
    .prepare(`SELECT * FROM ${SESSIONS_TABLE} WHERE digest = ?`)
    .get(digest) as
    | {
        id: string;
        digest: string;
        user_agent: string | null;
        remote_address: string | null;
        created_at: string;
        last_seen_at: string;
        revoked_at: string | null;
      }
    | undefined;
  if (!row || row.revoked_at) return null;
  return {
    id: row.id,
    digest: row.digest,
    userAgent: row.user_agent,
    remoteAddress: row.remote_address,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at,
  };
}

/** 注销指定 digest 的会话 */
export function revokeSession(digest: string): void {
  getDb().prepare(`UPDATE ${SESSIONS_TABLE} SET revoked_at = ? WHERE digest = ? AND revoked_at IS NULL`).run(nowIso(), digest);
}

/** 注销除指定 digest 外的全部会话（用于「踢出其他设备」） */
export function revokeOtherSessions(digest: string): number {
  const db = getDb();
  const before = db.prepare(`SELECT COUNT(*) AS c FROM ${SESSIONS_TABLE} WHERE digest != ? AND revoked_at IS NULL`).get(digest) as
    | { c: number }
    | undefined;
  db.prepare(`UPDATE ${SESSIONS_TABLE} SET revoked_at = ? WHERE digest != ? AND revoked_at IS NULL`).run(nowIso(), digest);
  return before?.c ?? 0;
}

/** 列出活跃会话 */
export function listActiveSessions(): SessionRow[] {
  const rows = getDb()
    .prepare(`SELECT * FROM ${SESSIONS_TABLE} WHERE revoked_at IS NULL ORDER BY last_seen_at DESC LIMIT 20`)
    .all() as Array<{
    id: string;
    digest: string;
    user_agent: string | null;
    remote_address: string | null;
    created_at: string;
    last_seen_at: string;
    revoked_at: string | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    digest: row.digest,
    userAgent: row.user_agent,
    remoteAddress: row.remote_address,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at,
  }));
}

/** 定期清理 30 天前的已注销会话，控制表体积 */
export function pruneSessions(): void {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  getDb().prepare(`DELETE FROM ${SESSIONS_TABLE} WHERE revoked_at IS NOT NULL AND revoked_at < ?`).run(cutoff);
}
