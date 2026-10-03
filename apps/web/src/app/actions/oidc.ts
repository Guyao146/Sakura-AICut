'use server';

import {
  createOidcProvider,
  deleteOidcProvider,
  listOidcProviders,
  updateOidcProvider,
  type OidcProviderInput,
  type OidcProviderKind,
} from '@sakura/db';
import type { ActionResult } from './project';
import { formatActionError } from './auth-helpers';

/**
 * 第三方登录（OIDC）Server Actions：接入 / 编辑 / 启停 / 删除
 */

function toError(error: unknown): ActionResult<never> {
  return formatActionError(error, '[settings/oidc]');
}

export async function saveOidcProviderAction(input: OidcProviderInput & { id?: string }): Promise<ActionResult<{ id: string }>> {
  try {
    if (!input.name.trim()) throw new Error('请填写名称');
    if (!input.issuer.trim()) throw new Error('请填写 Issuer 地址');
    if (!input.clientId.trim()) throw new Error('请填写 Client ID');
    if (!/^https?:\/\//i.test(input.issuer.trim())) throw new Error('Issuer 必须是 http(s) 开头的地址');

    if (input.id) {
      updateOidcProvider(input.id, input);
      return { ok: true, data: { id: input.id } };
    }
    const provider = createOidcProvider(input);
    return { ok: true, data: { id: provider.id } };
  } catch (error) {
    return toError(error);
  }
}

export async function toggleOidcProviderAction(
  id: string,
  enabled: boolean,
): Promise<ActionResult> {
  try {
    updateOidcProvider(id, { enabled });
    return { ok: true };
  } catch (error) {
    return toError(error);
  }
}

export async function deleteOidcProviderAction(id: string): Promise<ActionResult> {
  try {
    deleteOidcProvider(id);
    return { ok: true };
  } catch (error) {
    return toError(error);
  }
}

export async function listOidcProvidersAction(): Promise<
  ActionResult<Array<ReturnType<typeof listOidcProviders>[number]>>
> {
  try {
    return { ok: true, data: listOidcProviders() };
  } catch (error) {
    return toError(error);
  }
}

export type { OidcProviderKind };
