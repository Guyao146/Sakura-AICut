'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import type { GatewayAuthorizationResult, GatewayAuthorizationSession } from '@/lib/gateway';
import type { GatewaySyncResult } from '@/lib/gateway';
import { connectGatewayByAuthorization } from '@/lib/server/gateway';
import {
  clearAuthorization,
  completeGatewayAuthorization,
  loadAuthorization,
  startGatewayAuthorization,
} from '@/lib/server/gateway-oauth';
import { GatewayError } from '@/lib/server/gateway-http';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';
import type { ActionResult } from './project';

async function authenticated(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!verifySessionToken(token)) throw new GatewayError('未登录或会话已过期，请重新登录');
}

function toError(error: unknown): ActionResult<never> {
  return { ok: false, error: error instanceof GatewayError ? error.message : '网关账号授权请求失败，请稍后重试' };
}

export async function startGatewayAuthorizationAction(gatewayUrl: string): Promise<ActionResult<GatewayAuthorizationSession>> {
  try {
    await authenticated();
    return { ok: true, data: startGatewayAuthorization(gatewayUrl) };
  } catch (error) { return toError(error); }
}

export async function completeGatewayAuthorizationAction(input: {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
}): Promise<ActionResult<GatewayAuthorizationResult>> {
  try {
    await authenticated();
    const data = await completeGatewayAuthorization(input);
    revalidatePath('/settings');
    return { ok: true, data };
  } catch (error) { return toError(error); }
}

export async function revokeGatewayAuthorizationAction(): Promise<ActionResult> {
  try {
    await authenticated();
    clearAuthorization();
    revalidatePath('/settings');
    return { ok: true };
  } catch (error) { return toError(error); }
}

export async function gatewayAuthorizationStatus(): Promise<{ authorized: boolean; gatewayUrl: string }> {
  const current = loadAuthorization();
  return { authorized: Boolean(current), gatewayUrl: current?.gatewayUrl ?? '' };
}

export async function syncAuthorizedGatewayAction(): Promise<ActionResult<GatewaySyncResult>> {
  try {
    await authenticated();
    const data = await connectGatewayByAuthorization();
    revalidatePath('/settings');
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: error instanceof GatewayError ? error.message : '同步网关授权配置失败，请稍后重试' };
  }
}