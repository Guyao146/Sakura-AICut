import { NextResponse, type NextRequest } from 'next/server';
import { buildAuthorizeRequest, buildRedirectUri } from '@/lib/server/oidc';
import { OIDC_PRESETS } from '@sakura/db';
import type { OidcProviderKind } from '@sakura/db';

/**
 * GET /api/auth/login/:kind
 * 发起 OIDC 授权（Sakura / 通用 OIDC）：302 跳到提供商的 authorize 端点
 */
export const dynamic = 'force-dynamic';

const VALID_KINDS = new Set<OidcProviderKind>(['sakura', 'authentik']);

function publicBaseUrl(request: NextRequest): string {
  // 优先信任反代设置的对外地址，其次取请求本身的 origin
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
  const from = request.nextUrl.searchParams.get('from') ?? undefined;
  const redirectUri = buildRedirectUri(kind as OidcProviderKind, publicBaseUrl(request));

  const auth = await buildAuthorizeRequest(kind as OidcProviderKind, redirectUri, from);
  if (!auth) {
    const preset = OIDC_PRESETS[kind as OidcProviderKind];
    return NextResponse.json(
      { ok: false, error: `${preset.label} 登录未配置或未启用，请在设置页接入` },
      { status: 503 },
    );
  }
  return NextResponse.redirect(auth.authorizeUrl);
}
