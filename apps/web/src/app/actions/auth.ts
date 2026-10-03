'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createHash } from 'node:crypto';
import {
  hasAdminPassword,
  recordSession,
  revokeSession,
  setAdminPassword,
  verifyAdminPassword,
} from '@sakura/db';
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from '@/lib/session';

/**
 * 本地登录 Server Actions
 * 单用户本地应用，不接外部 IdP；密码 scrypt 哈希存在 settings 表。
 */

const MAX_ATTEMPTS = 5;
const LOCK_WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map<string, { count: number; firstAt: number }>();

function tokenDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function clientKey(): Promise<string> {
  const h = await headers();
  const header = h.get('x-forwarded-for') ?? h.get('x-real-ip');
  return (header ?? 'local').split(',')[0]?.trim() ?? 'local';
}

/** 登录：校验密码并签发会话 cookie */
export async function loginAction(password: string): Promise<{ ok: boolean; error?: string }> {
  if (!hasAdminPassword()) {
    return { ok: false, error: '尚未设置管理员密码，请先完成初始化' };
  }
  const key = await clientKey();
  const state = attempts.get(key);
  if (state && Date.now() - state.firstAt < LOCK_WINDOW_MS && state.count >= MAX_ATTEMPTS) {
    return { ok: false, error: '连续尝试失败次数过多，请 15 分钟后再试' };
  }

  const ok = verifyAdminPassword(password);
  if (!ok) {
    const prev = attempts.get(key);
    if (prev && Date.now() - prev.firstAt < LOCK_WINDOW_MS) prev.count += 1;
    else attempts.set(key, { count: 1, firstAt: Date.now() });
    return { ok: false, error: '密码错误' };
  }
  attempts.delete(key);

  const token = createSessionToken();
  const digest = tokenDigest(token);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, sessionCookieOptions());
  await recordSessionSafe(digest);
  return { ok: true };
}

/** 首次设置管理员密码（仅在从未设置时可用） */
export async function setupAdminPasswordAction(password: string, confirm: string): Promise<{ ok: boolean; error?: string }> {
  if (hasAdminPassword()) {
    return { ok: false, error: '管理员密码已存在，请前往设置页修改' };
  }
  if (password !== confirm) return { ok: false, error: '两次输入的密码不一致' };
  try {
    setAdminPassword(password);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  // 设置完成后直接登录，省一次跳转
  const token = createSessionToken();
  const digest = tokenDigest(token);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, sessionCookieOptions());
  await recordSessionSafe(digest);
  return { ok: true };
}

/** 修改密码：需校验旧密码 */
export async function changePasswordAction(
  oldPassword: string,
  newPassword: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!verifyAdminPassword(oldPassword)) return { ok: false, error: '旧密码错误' };
  try {
    setAdminPassword(newPassword);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true };
}

/** 注销：删除 cookie 并注销会话记录 */
export async function logoutAction(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    revokeSession(tokenDigest(token));
  }
  jar.delete(SESSION_COOKIE);
  redirect('/login');
}

async function recordSessionSafe(digest: string): Promise<void> {
  try {
    const h = await headers();
    recordSession({
      digest,
      userAgent: h.get('user-agent'),
      remoteAddress: h.get('x-forwarded-for') ?? null,
    });
  } catch (error) {
    // 会话记录是辅助功能，DB 初始化失败不应阻断登录
    console.error('[auth] 记录会话失败：', error);
  }
}
