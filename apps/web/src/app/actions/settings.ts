'use server';

import { revalidatePath } from 'next/cache';
import {
  createProvider,
  deleteProvider,
  getProvider,
  listProviders,
  saveAppSettings,
  updateProvider,
  upsertModelRoute,
  type AppSettings,
  type ProviderInput,
} from '@sakura/db';
import type { ModelRoute, ProviderCredentials, ProviderProtocol } from '@sakura/core';
import { probeProvider } from '@sakura/pipeline';
import type { ActionResult } from './project';

/**
 * 设置区动作：API 接入 / 模型路由 / 通用设置（提示词库见 settings-prompt.ts）
 */

function toError(error: unknown): ActionResult<never> {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[settings]', message);
  return { ok: false, error: message };
}

function refreshSettings(): void {
  revalidatePath('/settings');
}

/* ---------------------------- 供应商 ---------------------------- */

export async function saveProviderAction(input: {
  id?: string;
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  credentials?: ProviderCredentials;
  models?: ProviderInput['models'];
  enabled?: boolean;
  timeoutSec?: number;
  concurrency?: number;
  remark?: string;
}): Promise<ActionResult<{ id: string }>> {
  try {
    if (!input.name.trim()) throw new Error('请填写供应商名称');
    if (!input.baseUrl.trim()) throw new Error('请填写接口地址');

    if (input.id) {
      const existing = getProvider(input.id);
      if (!existing) throw new Error('供应商不存在');
      // 空凭证表示「不修改」，避免编辑时把已保存的 Key 清空
      const hasCredentials =
        input.credentials && Object.values(input.credentials).some((value) => (value ?? '').length > 0);
      updateProvider(input.id, {
        name: input.name,
        protocol: input.protocol,
        baseUrl: input.baseUrl,
        models: input.models ?? existing.models,
        enabled: input.enabled ?? existing.enabled,
        timeoutSec: input.timeoutSec ?? existing.timeoutSec,
        concurrency: input.concurrency ?? existing.concurrency,
        remark: input.remark ?? existing.remark,
        ...(hasCredentials ? { credentials: input.credentials } : {}),
      });
      refreshSettings();
      return { ok: true, data: { id: input.id } };
    }

    const provider = createProvider({
      name: input.name,
      protocol: input.protocol,
      baseUrl: input.baseUrl,
      credentials: input.credentials,
      models: input.models ?? [],
      enabled: input.enabled ?? true,
      timeoutSec: input.timeoutSec ?? 300,
      concurrency: input.concurrency ?? 3,
      remark: input.remark,
    });
    refreshSettings();
    return { ok: true, data: { id: provider.id } };
  } catch (error) {
    return toError(error);
  }
}

export async function deleteProviderAction(id: string): Promise<ActionResult> {
  try {
    deleteProvider(id);
    refreshSettings();
    return { ok: true };
  } catch (error) {
    return toError(error);
  }
}

/** 连通性检测（通常 1-3 秒，直接同步执行） */
export async function probeProviderAction(id: string) {
  try {
    return { ok: true as const, data: await probeProvider(id) };
  } catch (error) {
    return toError(error);
  }
}

export async function listProvidersAction() {
  try {
    return { ok: true as const, data: listProviders({ maskCredentials: true }) };
  } catch (error) {
    return toError(error);
  }
}

/* ---------------------------- 模型路由 / 通用设置 ---------------------------- */

export async function saveModelRouteAction(route: ModelRoute): Promise<ActionResult> {
  try {
    upsertModelRoute(route);
    refreshSettings();
    return { ok: true };
  } catch (error) {
    return toError(error);
  }
}

export async function saveAppSettingsAction(patch: Partial<AppSettings>): Promise<ActionResult<AppSettings>> {
  try {
    const settings = saveAppSettings(patch);
    refreshSettings();
    return { ok: true, data: settings };
  } catch (error) {
    return toError(error);
  }
}
