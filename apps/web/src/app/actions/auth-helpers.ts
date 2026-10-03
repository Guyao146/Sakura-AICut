import type { ActionResult } from './project';

/** OIDC actions 与其它 actions 共用的错误格式化（非 server action） */
export function formatActionError(error: unknown, prefix = '[auth]'): ActionResult<never> {
  const message = error instanceof Error ? error.message : String(error);
  console.error(prefix, message);
  return { ok: false, error: message };
}
