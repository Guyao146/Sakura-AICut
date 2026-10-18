import { createHash, randomBytes, randomInt } from 'node:crypto';
import { decryptJson, encryptJson } from '@sakura/core/server';
import { getDb, nowIso, transaction } from '../client';

export const ECOSYSTEM_READ_SCOPE = 'projects:read projects:create jobs:status';
export const SCREENPLAY_IMPORT_SCOPE = 'screenplay:import';
/** 可颁发的权限白名单；导入与渲染都必须显式授权 */
export const ECOSYSTEM_SCOPES = ['projects:read', 'projects:create', 'jobs:status', 'jobs:submit', SCREENPLAY_IMPORT_SCOPE] as const;
export interface EcosystemGrant {
  id: string; name: string; kind: string; peerBaseUrl: string; scope: string;
  pairedAt: string; revokedAt: string | null; createdAt: string; updatedAt: string;
}
export interface EcosystemPairing {
  id: string; code: string; name: string; peerBaseUrl: string; scope: string;
  expiresAt: string; grantId: string | null; createdAt: string;
}
interface GrantRow {
  id: string; name: string; kind: string; peer_base_url: string; scope: string;
  paired_at: string; revoked_at: string | null; created_at: string; updated_at: string;
}
interface PairingRow {
  id: string; code: string; name: string; peer_base_url: string; scope: string;
  expires_at: string; grant_id: string | null; created_at: string;
}
export function ecosystemDigest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
function mapGrant(row: GrantRow): EcosystemGrant {
  return { id: row.id, name: row.name, kind: row.kind, peerBaseUrl: row.peer_base_url, scope: row.scope,
    pairedAt: row.paired_at, revokedAt: row.revoked_at, createdAt: row.created_at, updatedAt: row.updated_at };
}
function mapPairing(row: PairingRow): EcosystemPairing {
  return { id: row.id, code: row.code, name: row.name, peerBaseUrl: row.peer_base_url, scope: row.scope,
    expiresAt: row.expires_at, grantId: row.grant_id, createdAt: row.created_at };
}

export function createPairing(name: string, peerBaseUrl: string, allowRender = false, allowScreenplayImport = false, ttlMinutes = 10): EcosystemPairing {
  if (!name.trim() || name.length > 80 || !Number.isInteger(ttlMinutes) || ttlMinutes < 1 || ttlMinutes > 10) throw new Error('配对参数无效');
  const db = getDb();
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code: string;
  do { code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join(''); }
  while (db.prepare('SELECT id FROM ecosystem_pairings WHERE code = ?').get(code));
  const row: PairingRow = { id: `pair_${randomBytes(12).toString('hex')}`, code, name: name.trim(),
    peer_base_url: peerBaseUrl,
    scope: `${ECOSYSTEM_READ_SCOPE}${allowRender ? ' jobs:submit' : ''}${allowScreenplayImport ? ` ${SCREENPLAY_IMPORT_SCOPE}` : ''}`,
    expires_at: new Date(Date.now() + ttlMinutes * 60_000).toISOString(), grant_id: null, created_at: nowIso() };
  db.prepare('INSERT INTO ecosystem_pairings (id,code,name,peer_base_url,scope,expires_at,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(row.id, row.code, row.name, row.peer_base_url, row.scope, row.expires_at, row.created_at);
  return mapPairing(row);
}
/** 给既有有效授权追加或移除权限；只能改成白名单内的组合 */
export function setGrantScope(grantId: string, scopes: readonly string[]): void {
  const unique = [...new Set(scopes)];
  if (!unique.length || unique.some((scope) => !(ECOSYSTEM_SCOPES as readonly string[]).includes(scope))) throw new Error('权限范围无效');
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM ecosystem_grants WHERE id = ? AND revoked_at IS NULL').get(grantId)) throw new Error('授权不存在或已吊销');
  db.prepare('UPDATE ecosystem_grants SET scope = ?, updated_at = ? WHERE id = ?').run(unique.join(' '), nowIso(), grantId);
}

export function listActivePairings(): EcosystemPairing[] {
  return (getDb().prepare('SELECT * FROM ecosystem_pairings WHERE expires_at > ? AND grant_id IS NULL ORDER BY created_at DESC')
    .all(nowIso()) as unknown as PairingRow[]).map(mapPairing);
}

export function consumePairing(input: { code: string; clientName: string; kind: string; peerBaseUrl: string; peerToken: string }): EcosystemGrant & { apiKey: string } {
  return transaction((db) => {
    const row = db.prepare('SELECT * FROM ecosystem_pairings WHERE code = ?').get(input.code.trim().toUpperCase()) as unknown as PairingRow | undefined;
    if (!row || row.grant_id || row.expires_at <= nowIso() || row.peer_base_url !== input.peerBaseUrl || row.name !== input.clientName) {
      throw new Error('配对码无效、已使用、已过期，或应用名称/地址不匹配');
    }
    const apiKey = `sak_live_${randomBytes(32).toString('base64url')}`;
    const now = nowIso();
    const grant: GrantRow = { id: `grant_${randomBytes(12).toString('hex')}`, name: row.name, kind: input.kind,
      peer_base_url: row.peer_base_url, scope: row.scope, paired_at: now, revoked_at: null, created_at: now, updated_at: now };
    db.prepare('INSERT INTO ecosystem_grants (id,name,kind,api_key,peer_base_url,peer_token,scope,paired_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(grant.id, grant.name, grant.kind, ecosystemDigest(apiKey), grant.peer_base_url, encryptJson(input.peerToken), grant.scope, now, now, now);
    db.prepare('UPDATE ecosystem_pairings SET grant_id = ? WHERE id = ?').run(grant.id, row.id);
    return { ...mapGrant(grant), apiKey };
  });
}

export function listGrants(includeRevoked = false): EcosystemGrant[] {
  return (getDb().prepare(`SELECT * FROM ecosystem_grants ${includeRevoked ? '' : 'WHERE revoked_at IS NULL'} ORDER BY paired_at DESC`)
    .all() as unknown as GrantRow[]).map(mapGrant);
}
export function findActiveGrant(apiKey: string): EcosystemGrant | null {
  if (!apiKey || apiKey.length > 256) return null;
  const row = getDb().prepare('SELECT * FROM ecosystem_grants WHERE api_key = ? AND revoked_at IS NULL')
    .get(ecosystemDigest(apiKey)) as unknown as GrantRow | undefined;
  return row ? mapGrant(row) : null;
}
export function revokeGrant(id: string): void {
  getDb().prepare('UPDATE ecosystem_grants SET revoked_at = COALESCE(revoked_at, ?), updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), id);
}
export function deleteGrant(id: string): void {
  transaction((db) => {
    if (!db.prepare('SELECT id FROM ecosystem_grants WHERE id = ? AND revoked_at IS NOT NULL').get(id)) return;
    // 早期预览库可能带 ON DELETE SET NULL；先删消费码，避免外键行为使其复活。
    db.prepare('DELETE FROM ecosystem_pairings WHERE grant_id = ?').run(id);
    db.prepare('DELETE FROM ecosystem_grants WHERE id = ?').run(id);
  });
}
export function cancelPairing(id: string): void {
  getDb().prepare('DELETE FROM ecosystem_pairings WHERE id = ? AND grant_id IS NULL').run(id);
}
export function purgeExpiredPairings(): number {
  return Number(getDb().prepare('DELETE FROM ecosystem_pairings WHERE expires_at <= ?').run(nowIso()).changes);
}
export function getPeer(grantId: string, includeRevoked = false): { baseUrl: string; token: string } | null {
  const row = getDb().prepare(`SELECT peer_base_url, peer_token FROM ecosystem_grants WHERE id = ? ${includeRevoked ? '' : 'AND revoked_at IS NULL'}`)
    .get(grantId) as { peer_base_url: string; peer_token: string } | undefined;
  const token = row ? decryptJson<string>(row.peer_token) : null;
  return row && token ? { baseUrl: row.peer_base_url, token } : null;
}

/** 全局持久化限流，不信任可伪造的转发 IP；重启/多进程也不能绕过。 */
export function takeEcosystemRateLimit(bucket: string, max = 20, now = Date.now()): boolean {
  return transaction((db) => {
    const row = db.prepare('SELECT started_at, count FROM ecosystem_rate_limits WHERE bucket = ?').get(bucket) as { started_at: number; count: number } | undefined;
    if (row && now - row.started_at < 60_000) {
      if (row.count >= max) return false;
      db.prepare('UPDATE ecosystem_rate_limits SET count = count + 1 WHERE bucket = ?').run(bucket);
    } else db.prepare('INSERT OR REPLACE INTO ecosystem_rate_limits VALUES (?, ?, 1)').run(bucket, now);
    return true;
  });
}
export function linkEcosystemProject(projectId: string, ownerId: string, requestId?: string): void {
  getDb().prepare('INSERT INTO ecosystem_projects (project_id, owner_id, request_id) VALUES (?, ?, ?)').run(projectId, ownerId, requestId ?? null);
}
export function ownsEcosystemProject(projectId: string, ownerId: string): boolean {
  return Boolean(getDb().prepare('SELECT 1 FROM ecosystem_projects WHERE project_id = ? AND owner_id = ?').get(projectId, ownerId));
}
export function findEcosystemProject(ownerId: string, requestId: string): string | null {
  return (getDb().prepare('SELECT project_id FROM ecosystem_projects WHERE owner_id = ? AND request_id = ?')
    .get(ownerId, requestId) as { project_id: string } | undefined)?.project_id ?? null;
}

/* ------------------- 剧本草稿导入 ------------------- */

export interface ScreenplayImportRecord {
  id: string; grantId: string; projectId: string; idempotencyKey: string; screenplayId: string; version: number; importedAt: string;
}
interface ImportRow {
  id: string; grant_id: string; project_id: string; idempotency_key: string; screenplay_id: string; version: number; imported_at: string;
}
function mapImport(row: ImportRow): ScreenplayImportRecord {
  return { id: row.id, grantId: row.grant_id, projectId: row.project_id, idempotencyKey: row.idempotency_key,
    screenplayId: row.screenplay_id, version: row.version, importedAt: row.imported_at };
}
export function findScreenplayImport(grantId: string, idempotencyKey: string): ScreenplayImportRecord | null {
  if (!idempotencyKey) return null;
  const row = getDb().prepare('SELECT * FROM ecosystem_screenplay_imports WHERE grant_id = ? AND idempotency_key = ?')
    .get(grantId, idempotencyKey) as ImportRow | undefined;
  return row ? mapImport(row) : null;
}
export function createScreenplayImport(input: {
  grantId: string; projectId: string; idempotencyKey: string; screenplayId: string; version: number;
}): ScreenplayImportRecord {
  const db = getDb();
  const id = `imp_${randomBytes(12).toString('hex')}`;
  const now = nowIso();
  db.prepare(`INSERT INTO ecosystem_screenplay_imports (id, grant_id, project_id, idempotency_key, screenplay_id, version, imported_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, input.grantId, input.projectId, input.idempotencyKey, input.screenplayId, input.version, now);
  return { id, grantId: input.grantId, projectId: input.projectId, idempotencyKey: input.idempotencyKey,
    screenplayId: input.screenplayId, version: input.version, importedAt: now };
}