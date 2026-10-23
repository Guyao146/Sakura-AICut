import { NextResponse, type NextRequest } from 'next/server';
import { buildAuthorizeRequest, buildRedirectUri } from '@/lib/server/oidc';
import { publicBaseUrl } from '@/lib/public-url';
import { OIDC_PRESETS } from '@sakura/db';
import type { OidcProviderKind } from '@sakura/db';

/**
 * GET /api/auth/login/:kind
 * 发起 OIDC 授权（Sakura / 通用 OIDC）：302 跳到提供商的 authorize 端点
 */
export const dynamic = 'force-dynamic';

const VALID_KINDS = new Set<OidcProviderKind>(['sakura', 'authentik']);

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
