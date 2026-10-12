import { createHash, randomBytes } from 'node:crypto';
import { getSetting, setSetting } from '@sakura/db';
import type { GatewayAuthorizationResult, GatewayAuthorizationSession } from '../gateway';
import { GatewayError, normalizeGatewayUrl, requestGatewayJson } from './gateway-http';

const DRAFTS = new Map<string, AuthorizationDraft>();
const DRAFT_TTL_MS = 10 * 60 * 1000;
const PENDING_SETTINGS_KEY = 'gateway_authorization_pending';
const AUTH_SETTINGS_KEY = 'gateway_authorization';
const CLIENT_NAME = 'Sakura AI Cut';
const SCOPES = 'models:read models:invoke offline_access';
export const REDIRECT_PATH = '/settings/gateway/callback';

interface AuthorizationDraft {
  gatewayUrl: string;
  verifier: string;
  state: string;
  expiresAt: number;
}

export interface GatewayAuthorizationRecord {
  gatewayUrl: string;
  accessToken: string;
  refreshToken: string;
  clientId: string;
  expiresAt: string;
}

function gcDrafts(): void {
  const now = Date.now();
  for (const [id, draft] of DRAFTS) if (draft.expiresAt <= now) DRAFTS.delete(id);
}

export function gatewayDraft(id: string): AuthorizationDraft | undefined {
  gcDrafts();
  const draft = DRAFTS.get(id);
  return draft ? { ...draft } : undefined;
}

function publicBaseUrl(): string {
  const configured = process.env.SAKURA_PUBLIC_BASE_URL?.trim();
  if (!configured) {
    throw new GatewayError('未配置外部访问地址；请在环境变量 SAKURA_PUBLIC_BASE_URL 设置本站部署根网址后再发起账号授权');
  }
  return configured.replace(/\/+$/, '');
}

function redirectUri(): string {
  return `${publicBaseUrl()}${REDIRECT_PATH}`;
}

export function startGatewayAuthorization(gatewayUrl: string): GatewayAuthorizationSession {
  const baseUrl = normalizeGatewayUrl(gatewayUrl);
  gcDrafts();
  if (DRAFTS.size > 200) throw new GatewayError('发起授权过于频繁，请稍后再试');
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(24).toString('base64url');
  const draftId = randomBytes(18).toString('base64url');
  const draft: AuthorizationDraft = {
    gatewayUrl: baseUrl,
    verifier,
    state,
    expiresAt: Date.now() + DRAFT_TTL_MS,
  };
  DRAFTS.set(draftId, draft);
  setSetting(PENDING_SETTINGS_KEY, draft);
  const parameters = new URLSearchParams({
    client_id: 'auto',
    name: CLIENT_NAME,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPES,
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  });
  return { draftId, authorizeUrl: `${baseUrl}/oauth/authorize?${parameters.toString()}`, state };
}

interface GatewayTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

function parseTokens(payload: unknown): GatewayTokenResponse {
  const value = payload as GatewayTokenResponse | undefined;
  if (!value || typeof value.access_token !== 'string' || !value.access_token) {
    throw new GatewayError('网关未返回有效的访问令牌');
  }
  return value;
}

function expiryFrom(expiresIn: number | undefined): string {
  const seconds = Math.min(Math.max(Number(expiresIn) || 3600, 60), 3600);
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function persistedDraft(): AuthorizationDraft | null {
  const stored = getSetting<AuthorizationDraft | null>(PENDING_SETTINGS_KEY, null);
  if (!stored || !stored.gatewayUrl || !stored.verifier || !stored.state) return null;
  return stored;
}

let cachedAuthorization: GatewayAuthorizationRecord | null | undefined;

export function loadAuthorization(): GatewayAuthorizationRecord | null {
  if (cachedAuthorization !== undefined) return cachedAuthorization;
  cachedAuthorization = getSetting<GatewayAuthorizationRecord | null>(AUTH_SETTINGS_KEY, null);
  return cachedAuthorization;
}

export function saveAuthorization(record: GatewayAuthorizationRecord): void {
  setSetting(AUTH_SETTINGS_KEY, record);
  cachedAuthorization = record;
}

export function clearAuthorization(): void {
  setSetting(AUTH_SETTINGS_KEY, null);
  setSetting(PENDING_SETTINGS_KEY, null);
  cachedAuthorization = null;
}

/**
 * 处理网关授权回调。
 *
 * 授权码的有效期与 PKCE 校验都由网关负责；这里只把回调用到的草稿与令牌绑定，
 * 并在保存前要求远端明确承认该令牌可读取模型配置，避免拿到无效令牌。
 */
export async function completeGatewayAuthorization(input: {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
}): Promise<GatewayAuthorizationResult> {
  gcDrafts();
  if (input.error) {
    throw new GatewayError(`网关账号授权被拒绝${input.errorDescription ? `：${input.errorDescription}` : ''}`);
  }
  const code = typeof input.code === 'string' ? input.code.trim() : '';
  const state = typeof input.state === 'string' ? input.state.trim() : '';
  if (!code || !state) throw new GatewayError('网关回调缺少授权码或状态参数');
  const draft = [...DRAFTS.values()].find((item) => item.state === state) ?? persistedDraft();
  if (!draft || draft.state !== state) {
    throw new GatewayError('授权状态不匹配或已过期，请重新发起账号授权');
  }
  // 授权码的单次有效性由网关侧校验。
  const tokens = parseTokens(await requestGatewayJson(draft.gatewayUrl, '/oauth/token', {
    allowPrivateNetwork: true,
    timeoutMs: 15_000,
    body: {
      grant_type: 'authorization_code',
      client_id: 'auto',
      code,
      redirect_uri: redirectUri(),
      code_verifier: draft.verifier,
    },
  }));
  const config = await requestGatewayJson(draft.gatewayUrl, '/api/integration/config', {
    allowPrivateNetwork: true,
    token: tokens.access_token,
  });
  if ((config as { verified?: unknown } | undefined)?.verified !== true) {
    throw new GatewayError('网关未确认账号授权可读取模型配置，未保存授权');
  }
  setSetting(PENDING_SETTINGS_KEY, null);
  saveAuthorization({
    gatewayUrl: draft.gatewayUrl,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? '',
    clientId: 'auto',
    expiresAt: expiryFrom(tokens.expires_in),
  });
  return { ok: true, gatewayUrl: draft.gatewayUrl };
}

export async function refreshAuthorization(): Promise<GatewayAuthorizationRecord> {
  const current = loadAuthorization();
  if (!current) throw new GatewayError('尚无网关账号授权，请先完成授权');
  if (!current.refreshToken) throw new GatewayError('网关授权不支持免登录刷新，请重新授权');
  try {
    const tokens = parseTokens(await requestGatewayJson(current.gatewayUrl, '/oauth/token', {
      allowPrivateNetwork: true,
      timeoutMs: 15_000,
      body: { grant_type: 'refresh_token', client_id: current.clientId, refresh_token: current.refreshToken },
    }));
    const record: GatewayAuthorizationRecord = {
      gatewayUrl: current.gatewayUrl,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? current.refreshToken,
      clientId: current.clientId,
      expiresAt: expiryFrom(tokens.expires_in),
    };
    saveAuthorization(record);
    return record;
  } catch (error) {
    if (error instanceof GatewayError && /授权已取消|令牌|无效|过期|拒绝|HTTP 4\d\d/.test(error.message)) {
      clearAuthorization();
      throw new GatewayError('网关账号授权已失效，请重新授权');
    }
    throw error;
  }
}

/** 读取账号授权附带的访问令牌；过期时自动刷新，不会回来源 Key 明文。 */
export async function fetchAuthorizedConfig(): Promise<{ gatewayUrl: string; token: string }> {
  const current = loadAuthorization();
  if (!current) throw new GatewayError('尚无网关账号授权，请先完成授权');
  if (new Date(current.expiresAt).getTime() <= Date.now()) {
    const refreshed = await refreshAuthorization();
    return { gatewayUrl: refreshed.gatewayUrl, token: refreshed.accessToken };
  }
  return { gatewayUrl: current.gatewayUrl, token: current.accessToken };
}

export type { GatewayAuthorizationResult };