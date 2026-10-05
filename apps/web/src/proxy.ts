import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';

/**
 * 全局登录守卫（Next.js 16 的 proxy 约定，替代旧 middleware 文件名）
 * - 放行：/login、Next 静态资源
 * - 其余路径校验会话 cookie：页面重定向到 /login；API 返回 401 JSON
 * - 会话校验只做 HMAC 签名验证，不查库，proxy 保持轻量
 */

const PUBLIC_PAGES = new Set(['/login']);
/** OIDC 登录发起与回调必须对未登录开放；/api/open/ 由开放 API 自行校验 X-API-Key */
const PUBLIC_API_PREFIXES = ['/api/auth/login/', '/api/auth/callback/', '/api/open/'];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PAGES.has(pathname)) return NextResponse.next();
  // OIDC 端点只在 GET 时公开（回调与发起都是 GET）
  if (PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (verifySessionToken(token)) return NextResponse.next();

  // API 与页面分开处理：前端 fetch 拿到 401 可以统一跳登录，而不是收到 HTML
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ ok: false, error: '未登录或会话已过期' }, { status: 401 });
  }
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = '/login';
  loginUrl.searchParams.set('from', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  /**
   * 排除静态资源与 favicon：middleware 不应拦截它们
   * （_next/static、_next/image、favicon.ico、robots.txt、site.webmanifest 等）
   */
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|manifest).*)'],
};
