import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

/**
 * API 响应与错误处理工具
 */

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ ok: true, data }, init);
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ ok: false, error: message, ...(extra ?? {}) }, { status });
}

/** 统一包裹路由处理函数，把异常转成可读 JSON */
export function handler<Args extends unknown[]>(
  fn: (...args: Args) => Promise<NextResponse> | NextResponse,
): (...args: Args) => Promise<NextResponse> {
  return async (...args: Args) => {
    try {
      return await fn(...args);
    } catch (error) {
      if (error instanceof ZodError) {
        const issues = error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
        return fail(`参数校验失败：${issues}`, 422);
      }
      const message = error instanceof Error ? error.message : String(error);
      const status = /不存在/.test(message) ? 404 : 500;
      console.error('[api]', message);
      return fail(message, status);
    }
  };
}

export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
}
