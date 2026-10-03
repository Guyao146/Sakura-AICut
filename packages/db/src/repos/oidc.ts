import { createId } from '@sakura/core';
import { getDb, nowIso } from '../client';
import { hasAdminPassword } from './auth';

/**
 * OIDC 身份提供商配置仓储
 *
 * 支持两类标准 OIDC 提供商（授权码 + PKCE）：
 * - sakura：Sakura-Auth-Server（自有轻量 IdP）
 * - 通用 OIDC（本地或远端实例）
 * 两者共用同一套接入逻辑，仅预设元数据不同。
 */

export type OidcProviderKind = 'sakura' | 'authentik';

export interface OidcProviderConfig {
  id: string;
  /** 显示名称 */
  name: string;
  /** 提供商类型：决定内置预设与图标 */
  kind: OidcProviderKind;
  /** OIDC issuer，如 https://auth.example.com 或 http://localhost:9000 */
  issuer: string;
  /** OAuth client_id（在提供商控制台注册） */
  clientId: string;
  /** client_secret；公开客户端（token_auth=none）留空 */
  clientSecret: string | null;
  /** 请求的 scope（默认 openid profile email） */
  scope: string;
  /** 是否启用 */
  enabled: boolean;
  /** 登录按钮上的显示文案 */
  label: string;
  createdAt: string;
  updatedAt: string;
}

interface OidcRow {
  id: string;
  name: string;
  kind: string;
  issuer: string;
  client_id: string;
  client_secret: string | null;
  scope: string;
  enabled: number;
  label: string;
  created_at: string;
  updated_at: string;
}

const TABLE = 'oidc_providers';

// 历史默认显示名改为中性名称；保留内部类型与回调路径，兼容已注册的客户端。
function neutralLoginLabel(value: string, kind: string): string {
  return kind !== 'sakura' && value.trim().toLowerCase() === kind ? '通用 OIDC' : value;
}

function mapRow(row: OidcRow): OidcProviderConfig {
  return {
    id: row.id,
    name: neutralLoginLabel(row.name, row.kind),
    kind: row.kind as OidcProviderKind,
    issuer: row.issuer.replace(/\/+$/, ''),
    clientId: row.client_id,
    clientSecret: row.client_secret,
    scope: row.scope,
    enabled: row.enabled === 1,
    label: neutralLoginLabel(row.label, row.kind),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const DEFAULT_OIDC_SCOPE = 'openid profile email';

/** 各类型提供商的预置默认值 */
export const OIDC_PRESETS: Record<OidcProviderKind, { label: string; scope: string; icon: string }> = {
  sakura: { label: 'Sakura 账号', scope: DEFAULT_OIDC_SCOPE, icon: '🌸' },
  authentik: { label: '通用 OIDC', scope: DEFAULT_OIDC_SCOPE, icon: '🔐' },
};

export interface OidcProviderInput {
  name: string;
  kind: OidcProviderKind;
  issuer: string;
  clientId: string;
  clientSecret?: string | null;
  scope?: string;
  enabled?: boolean;
  label?: string;
}

export function createOidcProvider(input: OidcProviderInput): OidcProviderConfig {
  const id = `oidc_${createId(12)}`;
  const now = nowIso();
  const preset = OIDC_PRESETS[input.kind];
  getDb()
    .prepare(
      `INSERT INTO ${TABLE} (id, name, kind, issuer, client_id, client_secret, scope, enabled, label, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.name,
      input.kind,
      input.issuer.trim(),
      input.clientId.trim(),
      input.clientSecret?.trim() || null,
      input.scope?.trim() || preset.scope,
      input.enabled === false ? 0 : 1,
      input.label?.trim() || preset.label,
      now,
      now,
    );
  return getOidcProvider(id) as OidcProviderConfig;
}

export function getOidcProvider(id: string): OidcProviderConfig | null {
  const row = getDb().prepare(`SELECT * FROM ${TABLE} WHERE id = ?`).get(id) as unknown as OidcRow | undefined;
  return row ? mapRow(row) : null;
}

/** 按 kind 取唯一的启用的提供商（每类只允许一个生效配置） */
export function getEnabledOidcProvider(kind: OidcProviderKind): OidcProviderConfig | null {
  const row = getDb()
    .prepare(`SELECT * FROM ${TABLE} WHERE kind = ? AND enabled = 1 ORDER BY created_at ASC LIMIT 1`)
    .get(kind) as unknown as OidcRow | undefined;
  return row ? mapRow(row) : null;
}

/** 列出全部（设置页用；client_secret 打码） */
export function listOidcProviders(): Array<OidcProviderConfig & { hasSecret: boolean }> {
  const rows = getDb().prepare(`SELECT * FROM ${TABLE} ORDER BY created_at ASC`).all() as unknown as OidcRow[];
  return rows.map((row) => {
    const config = mapRow(row);
    return { ...config, clientSecret: null, hasSecret: Boolean(config.clientSecret) };
  });
}

export function updateOidcProvider(id: string, patch: Partial<OidcProviderInput>): OidcProviderConfig | null {
  const current = getOidcProvider(id);
  if (!current) return null;
  const fields: Record<string, unknown> = {};
  if (patch.name !== undefined) fields.name = patch.name;
  if (patch.kind !== undefined) fields.kind = patch.kind;
  if (patch.issuer !== undefined) fields.issuer = patch.issuer.trim();
  if (patch.clientId !== undefined) fields.client_id = patch.clientId.trim();
  // 空串表示不修改；null 表示显式清空密钥
  if (patch.clientSecret !== undefined && patch.clientSecret !== '') {
    fields.client_secret = (patch.clientSecret ?? '').trim() || null;
  }
  if (patch.scope !== undefined) fields.scope = patch.scope.trim();
  if (patch.enabled !== undefined) fields.enabled = patch.enabled ? 1 : 0;
  if (patch.label !== undefined) fields.label = patch.label.trim();
  if (Object.keys(fields).length === 0) return current;
  const setClause = Object.keys(fields).map((key) => `${key} = ?`).join(', ');
  getDb().prepare(`UPDATE ${TABLE} SET ${setClause}, updated_at = ? WHERE id = ?`).run(...[...Object.values(fields), nowIso(), id] as never[]);
  return getOidcProvider(id);
}

export function deleteOidcProvider(id: string): void {
  getDb().prepare(`DELETE FROM ${TABLE} WHERE id = ?`).run(id);
}

/** 判断某类登录是否可用（配置存在且启用） */
export function isOidcEnabled(kind: OidcProviderKind): boolean {
  return getEnabledOidcProvider(kind) !== null;
}

/** 判断是否还有任何登录方式可用（全关闭时不应把用户锁死） */
export function hasAnyLoginMethod(): boolean {
  return hasAdminPassword() || isOidcEnabled('sakura') || isOidcEnabled('authentik');
}
