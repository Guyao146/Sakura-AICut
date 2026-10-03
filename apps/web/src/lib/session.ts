import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

/**
 * 本地登录：会话令牌的签发与校验
 *
 * 设计要点：
 * - 令牌 = base64url(payload).hmac(payload)，payload 含签发时间与过期时间
 * - HMAC 密钥与供应商凭证加密共用同一份：SAKURA_SECRET 环境变量 → 数据目录下的
 *   持久化随机密钥（.sakura_secret）。proxy 运行在数据库初始化之前，因此不依赖
 *   @sakura/db，避免把 node:sqlite 打进中间件包
 * - cookie 为 httpOnly + sameSite=lax + 7 天有效期，过期后重新登录
 * - proxy 只做签名校验（无查库开销）；密码校验在 server action 侧完成
 */

export const SESSION_COOKIE = 'sakura_session';
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

const SECRET_FILENAME = '.sakura_secret';
const SECRET_BYTES = 32;
let cachedSecret: string | null | undefined;

/**
 * 数据目录解析（与 packages/db/src/client.ts 的 dataDir 保持一致）
 * proxy 不能 import @sakura/db，这里内联同一段逻辑
 */
function resolveDataDir(): string {
  const configured = process.env.SAKURA_DATA_DIR?.trim();
  if (configured) {
    return isAbsolute(/* turbopackIgnore: true */ configured) ? configured : resolve(/* turbopackIgnore: true */ process.cwd(), configured);
  }
  let dir = /* turbopackIgnore: true */ process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return join(dir, 'data');
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return join(/* turbopackIgnore: true */ process.cwd(), 'data');
}

/**
 * 读取会话签名密钥。
 * 与 packages/db/src/secret.ts 的持久化随机密钥是同一个文件：
 * - SAKURA_SECRET 显式配置时直接使用
 * - 否则读取 .sakura_secret；不存在则生成一份（与 db 侧首次加密时生成的行为一致，
 *   两侧任意一方先触发都会落盘，另一方自然读到）
 * 返回 null 仅在密钥文件读取失败时
 */
export function sessionSecret(): string | null {
  if (cachedSecret !== undefined) return cachedSecret;
  const configured = process.env.SAKURA_SECRET?.trim();
  if (configured) {
    cachedSecret = configured;
    return configured;
  }
  const file = join(resolveDataDir(), SECRET_FILENAME);
  try {
    if (existsSync(file)) {
      const stored = readFileSync(file, 'utf8').trim();
      if (stored.length > 0) {
        cachedSecret = stored;
        return stored;
      }
    }
    // 尚未生成：与 db 侧约定同一个文件，主动生成一份
    mkdirSync(dirname(file), { recursive: true });
    const secret = randomBytes(SECRET_BYTES).toString('hex');
    writeFileSync(file, secret, { mode: 0o600 });
    cachedSecret = secret;
    return secret;
  } catch (error) {
    console.error('[session] 读取会话密钥失败：', error);
    cachedSecret = null;
    return null;
  }
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/** 签发一枚会话令牌 */
export function createSessionToken(): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({ iat: now, exp: now + SESSION_TTL_SECONDS, nonce: randomBytes(12).toString('hex') }),
  ).toString('base64url');
  const secret = sessionSecret();
  if (!secret) throw new Error('会话密钥不可用：请检查数据目录可读写');
  return `${payload}.${sign(payload, secret)}`;
}

/**
 * 校验会话令牌：签名正确且未过期
 * 恶意构造的令牌这里只做常数时间比较，不抛异常，返回布尔供调用方分流
 */
export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const secret = sessionSecret();
  if (!secret) return false;
  const dot = token.lastIndexOf('.');
  if (dot <= 0 || dot >= token.length - 1) return false;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  try {
    const expected = sign(payload, secret);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown };
    return typeof decoded.exp === 'number' && decoded.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

/** cookie 属性：httpOnly 防 XSS 窃取，sameSite=lax 防跨站自动携带 */
export function sessionCookieOptions(): { httpOnly: boolean; sameSite: 'lax'; path: string; maxAge: number } {
  return { httpOnly: true, sameSite: 'lax', path: '/', maxAge: SESSION_TTL_SECONDS };
}
