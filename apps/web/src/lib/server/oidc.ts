import { createHash, randomBytes } from 'node:crypto';
import type { OidcProviderConfig, OidcProviderKind } from '@sakura/db';
import { getEnabledOidcProvider, OIDC_PRESETS } from '@sakura/db';
import { fetchJson, HttpError } from '@sakura/core/server';

/**
 * OIDC 客户端：授权码 + PKCE（S256）
 *
 * 同时支持 Sakura-Auth-Server 与通用 OIDC 身份服务：两者都实现标准
 * OAuth 2.0 Authorization Code Flow with PKCE，差异仅在预设元数据。
 *
 * 流程：
 *   1. 生成 code_verifier/state，重定向到 {issuer}/authorize
 *   2. 回调带 code，POST {issuer}/token 换 access_token (+ id_token)
 *   3. 用 access_token 调 {issuer}/userinfo 拿用户信息（sub / preferred_username / email）
 *   4. 以 sub 为身份标识签发本地会话（与本地登录同一 cookie）
 */

export interface OidcAuthRequest {
  state: string;
  codeChallenge: string;
  authorizeUrl: string;
}

export interface OidcUserInfo {
  sub: string;
  preferredUsername: string | null;
  name: string | null;
  email: string | null;
  groups: string[] | null;
}

interface OidcEndpoints {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
}

const discoveryCache = new Map<string, { endpoints: OidcEndpoints; at: number }>();
const DISCOVERY_TTL_MS = 10 * 60 * 1000;

/** 从发现文档解析端点；失败时回落到 issuer 标准路径 */
async function resolveEndpoints(provider: OidcProviderConfig): Promise<OidcEndpoints> {
  const cached = discoveryCache.get(provider.id);
  if (cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.endpoints;

  const fallback: OidcEndpoints = {
    authorizationEndpoint: `${provider.issuer}/authorize`,
    tokenEndpoint: `${provider.issuer}/token`,
    userinfoEndpoint: `${provider.issuer}/userinfo`,
  };

  try {
    const doc = await fetchJson<{ authorization_endpoint?: string; token_endpoint?: string; userinfo_endpoint?: string }>(
      `${provider.issuer}/.well-known/openid-configuration`,
      {},
      { timeoutMs: 10_000, retries: 0 },
    );
    const endpoints: OidcEndpoints = {
      authorizationEndpoint: doc?.authorization_endpoint ?? fallback.authorizationEndpoint,
      tokenEndpoint: doc?.token_endpoint ?? fallback.tokenEndpoint,
      userinfoEndpoint: doc?.userinfo_endpoint ?? fallback.userinfoEndpoint,
    };
    discoveryCache.set(provider.id, { endpoints, at: Date.now() });
    return endpoints;
  } catch {
    // 发现文档不可达时尝试约定路径；非约定部署必须提供发现文档
    return fallback;
  }
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 生成一对 PKCE verifier/challenge（S256） */
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/** 只允许站内相对路径，防开放重定向 */
function fromSafe(from: string): boolean {
  return from.startsWith('/') && !from.startsWith('//') && !from.toLowerCase().startsWith('/\\');
}

/** 发起授权：生成 state + PKCE，返回跳转地址 */
export async function buildAuthorizeRequest(
  kind: OidcProviderKind,
  redirectUri: string,
  from?: string,
): Promise<OidcAuthRequest | null> {
  const provider = getEnabledOidcProvider(kind);
  if (!provider) return null;

  const { verifier, challenge } = generatePkce();
  const state = `${base64url(randomBytes(24))}:${base64url(Buffer.from(JSON.stringify({ from: from ?? '/', verifier })))}`;

  const endpoints = await resolveEndpoints(provider);
  const url = new URL(endpoints.authorizationEndpoint);
  url.searchParams.set('client_id', provider.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', provider.scope);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');

  return { state, codeChallenge: challenge, authorizeUrl: url.toString() };
}

/** 解析 state，带回跳目标与 PKCE verifier */
export function parseState(state: string): { from: string; verifier: string } | null {
  const separatorIndex = state.indexOf(':');
  if (separatorIndex <= 0) return null;
  try {
    const payload = JSON.parse(Buffer.from(state.slice(separatorIndex + 1), 'base64').toString('utf8')) as {
      from?: string;
      verifier?: string;
    };
    if (typeof payload.verifier !== 'string' || payload.verifier.length === 0) return null;
    const from = typeof payload.from === 'string' && fromSafe(payload.from) ? payload.from : '/';
    return { from, verifier: payload.verifier };
  } catch {
    return null;
  }
}

export interface OidcTokenResult {
  accessToken: string;
  idToken: string | null;
  refreshToken: string | null;
  expiresIn: number;
}

/** 用授权码换令牌 */
export async function exchangeCode(
  kind: OidcProviderKind,
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<OidcTokenResult> {
  const provider = getEnabledOidcProvider(kind);
  if (!provider) throw new Error(`${OIDC_PRESETS[kind].label} 登录未启用`);

  const endpoints = await resolveEndpoints(provider);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: provider.clientId,
    code_verifier: verifier,
  });
  if (provider.clientSecret) body.set('client_secret', provider.clientSecret);

  const res = await fetch(endpoints.tokenEndpoint, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new HttpError(`${OIDC_PRESETS[kind].label} 换取令牌失败 HTTP ${res.status}: ${text.slice(0, 200)}`, res.status, endpoints.tokenEndpoint);
  }
  let payload: Record<string, unknown> = {};
  try {
    payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new Error(`${OIDC_PRESETS[kind].label} 返回的令牌响应不是合法 JSON`);
  }
  const accessToken = payload.access_token;
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new Error(`${OIDC_PRESETS[kind].label} 未返回 access_token：${text.slice(0, 200)}`);
  }
  return {
    accessToken,
    idToken: typeof payload.id_token === 'string' ? payload.id_token : null,
    refreshToken: typeof payload.refresh_token === 'string' ? payload.refresh_token : null,
    expiresIn: typeof payload.expires_in === 'number' ? payload.expires_in : 0,
  };
}

/** 用 access_token 拉用户信息 */
export async function fetchUserInfo(kind: OidcProviderKind, accessToken: string): Promise<OidcUserInfo> {
  const provider = getEnabledOidcProvider(kind);
  if (!provider) throw new Error(`${OIDC_PRESETS[kind].label} 登录未启用`);

  const endpoints = await resolveEndpoints(provider);
  const res = await fetch(endpoints.userinfoEndpoint, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new HttpError(`${OIDC_PRESETS[kind].label} 获取用户信息失败 HTTP ${res.status}`, res.status, endpoints.userinfoEndpoint);
  }
  const payload = (await res.json()) as Partial<{
    sub?: unknown;
    preferred_username?: unknown;
    name?: unknown;
    email?: unknown;
    groups?: unknown;
  }>;
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw new Error(`${OIDC_PRESETS[kind].label} 返回的用户信息缺少 sub`);
  }
  return {
    sub: payload.sub,
    preferredUsername: typeof payload.preferred_username === 'string' ? payload.preferred_username : null,
    name: typeof payload.name === 'string' ? payload.name : null,
    email: typeof payload.email === 'string' ? payload.email : null,
    groups: Array.isArray(payload.groups) ? payload.groups.filter((item): item is string => typeof item === 'string') : null,
  };
}

/** 生成 OIDC 回调地址（本站绝对路径） */
export function buildRedirectUri(kind: OidcProviderKind, publicBaseUrl: string): string {
  return `${publicBaseUrl.replace(/\/+$/, '')}/api/auth/callback/${kind}`;
}
