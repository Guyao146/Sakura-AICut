import { NextResponse, type NextRequest } from 'next/server';
import { cookies, headers } from 'next/headers';
import { createHash } from 'node:crypto';
import { recordSession, OIDC_PRESETS } from '@sakura/db';
import { buildRedirectUri, exchangeCode, fetchUserInfo, parseState } from '@/lib/server/oidc';
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from '@/lib/session';
import type { OidcProviderKind } from '@sakura/db';

/**
 * GET /api/auth/callback/:kind
 * OIDC 回调：state 防 CSRF → code 换令牌 → userinfo → 签发本地会话
 * 此路由必须对未登录开放（proxy 放行），完成后带着 cookie 跳回业务页面
 */
export const dynamic = 'force-dynamic';

const VALID_KINDS = new Set<OidcProviderKind>(['sakura', 'authentik']);

function publicBaseUrl(request: NextRequest): string {
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const forwardedHost = request.headers.get('x-forwarded-host');
  if (forwardedHost) return `${forwardedProto ?? 'http'}://${forwardedHost}`;
  return new URL(request.url).origin;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ kind: string }> },
) {
  const { kind } = await context.params;
  if (!VALID_KINDS.has(kind as OidcProviderKind)) {
    return NextResponse.json({ ok: false, error: '不支持的登录方式' }, { status: 400 });
  }
  const providerKind = kind as OidcProviderKind;
  const { searchParams } = request.nextUrl;

  // 提供商返回的错误（用户拒绝授权等）
  const providerError = searchParams.get('error');
  if (providerError) {
    return redirectToLogin(request, `登录被拒绝：${providerError}`);
  }

  const state = searchParams.get('state');
  const code = searchParams.get('code');
  if (!state || !code) {
    return redirectToLogin(request, '回调缺少 state 或 code');
  }

  const parsed = parseState(state);
  if (!parsed) {
    return redirectToLogin(request, 'state 校验失败，请重试');
  }

  try {
    const redirectUri = buildRedirectUri(providerKind, publicBaseUrl(request));
    const token = await exchangeCode(providerKind, code, parsed.verifier, redirectUri);
    const user = await fetchUserInfo(providerKind, token.accessToken);

    // 与本地登录同一会话体系：HMAC 签名 cookie
    const sessionToken = createSessionToken();
    const digest = createHash('sha256').update(sessionToken).digest('hex');
    const jar = await cookies();
    jar.set(SESSION_COOKIE, sessionToken, sessionCookieOptions());

    try {
      const h = await headers();
      recordSession({
        digest,
        userAgent: h.get('user-agent'),
        remoteAddress: h.get('x-forwarded-for') ?? null,
      });
    } catch (error) {
      // 会话记录失败不阻断登录
      console.error('[auth] 记录 OIDC 会话失败：', error);
    }

    return NextResponse.redirect(new URL(parsed.from, request.url));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[auth] ${providerKind} 登录失败：`, message);
    return redirectToLogin(request, `${OIDC_PRESETS[providerKind].label} 登录失败：${message.slice(0, 120)}`);
  }
}

function redirectToLogin(request: NextRequest, reason: string): NextResponse {
  const url = new URL('/login', request.url);
  url.searchParams.set('error', reason);
  return NextResponse.redirect(url);
}
