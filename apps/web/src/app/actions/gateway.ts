'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import type { GatewayConnectInput, GatewaySyncResult } from '@/lib/gateway';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';
import { connectGateway, refreshGateway } from '@/lib/server/gateway';
import { connectGatewayByAuthorization } from '@/lib/server/gateway';
import { GatewayError } from '@/lib/server/gateway-http';
import type { ActionResult } from './project';

async function authenticated(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!verifySessionToken(token)) throw new GatewayError('未登录或会话已过期，请重新登录');
}

function failure(error: unknown): ActionResult<GatewaySyncResult> {
  // 不把网络错误、远端正文或数据库异常中的凭据回显到浏览器和日志。
  return { ok: false, error: error instanceof GatewayError ? error.message : '网关配置保存失败，请稍后重试' };
}

export async function connectGatewayAction(input: GatewayConnectInput): Promise<ActionResult<GatewaySyncResult>> {
  try {
    await authenticated();
    const data = await connectGateway(input);
    revalidatePath('/settings');
    return { ok: true, data };
  } catch (error) { return failure(error); }
}

export async function refreshGatewayAction(providerId: string): Promise<ActionResult<GatewaySyncResult>> {
  try {
    await authenticated();
    if (typeof providerId !== 'string' || !providerId || providerId.length > 100) throw new GatewayError('请选择有效的网关接入');
    const data = await refreshGateway(providerId);
    revalidatePath('/settings');
    return { ok: true, data };
  } catch (error) { return failure(error); }
}

export async function syncAuthorizedGatewayAction(): Promise<ActionResult<GatewaySyncResult>> {
  try {
    await authenticated();
    const data = await connectGatewayByAuthorization();
    revalidatePath('/settings');
    return { ok: true, data };
  } catch (error) { return failure(error); }
}