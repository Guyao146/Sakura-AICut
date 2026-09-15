import { getAdapter } from './registry';
import type { AdapterContext, ProviderAdapter } from './types';
import type { Capability, ModelEntry, ModelRoute, ProviderConfig } from '../types/provider';

/**
 * 模型路由：把「能力」解析成「供应商 + 模型 + 适配器 + 调用上下文」
 * 支持用户显式指定（override），以及路由里配置的兜底链路。
 */

export interface RouteResolution {
  provider: ProviderConfig;
  model: ModelEntry;
  adapter: ProviderAdapter;
  ctx: AdapterContext;
}

export class RouteError extends Error {
  readonly capability: Capability;
  constructor(capability: Capability, message: string) {
    super(message);
    this.name = 'RouteError';
    this.capability = capability;
  }
}

function buildContext(provider: ProviderConfig): AdapterContext {
  return {
    providerId: provider.id,
    providerName: provider.name,
    baseUrl: provider.baseUrl,
    credentials: provider.credentials ?? {},
    extraHeaders: provider.extraHeaders,
    timeoutSec: provider.timeoutSec ?? 120,
  };
}

function pickModel(provider: ProviderConfig, modelId: string): ModelEntry | undefined {
  return provider.models.find((m) => m.id === modelId && m.enabled !== false);
}

/**
 * 解析路由
 * @param capability 需要的能力
 * @param routes     用户配置的路由表
 * @param providers  全部供应商（credentials 需已解密）
 * @param override   临时覆盖（例如「本次用可灵生成」）
 */
export function resolveRoute(
  capability: Capability,
  routes: ModelRoute[],
  providers: ProviderConfig[],
  override?: { providerId?: string; modelId?: string; params?: Record<string, unknown> },
): RouteResolution {
  const route = routes.find((r) => r.capability === capability);
  const candidates: Array<{ providerId: string; modelId: string }> = [];

  if (override?.providerId && override.modelId) {
    candidates.push({ providerId: override.providerId, modelId: override.modelId });
  }
  if (route) {
    candidates.push({ providerId: route.providerId, modelId: route.modelId });
    for (const fallback of route.fallbacks ?? []) candidates.push(fallback);
  }
  // 兜底：任意一个启用的、含该能力模型的供应商
  for (const provider of providers) {
    const model = provider.models.find((m) => m.capability === capability && m.enabled !== false);
    if (model) candidates.push({ providerId: provider.id, modelId: model.id });
  }

  const attempts: string[] = [];
  for (const candidate of candidates) {
    const provider = providers.find((p) => p.id === candidate.providerId);
    if (!provider || provider.enabled === false) {
      attempts.push(`${candidate.providerId}: 供应商不存在或已停用`);
      continue;
    }
    const model = pickModel(provider, candidate.modelId);
    if (!model) {
      attempts.push(`${provider.name}/${candidate.modelId}: 模型未启用`);
      continue;
    }
    if (model.capability !== capability && model.capability !== 'vision') {
      attempts.push(`${provider.name}/${candidate.modelId}: 能力不匹配（${model.capability} ≠ ${capability}）`);
      continue;
    }
    const adapter = getAdapter(provider.protocol);
    return {
      provider: { ...provider, models: [model, ...provider.models] },
      model: { ...model, ...(override?.params ? { defaultParams: { ...model.defaultParams, ...override.params } } : {}) },
      adapter,
      ctx: buildContext(provider),
    };
  }

  throw new RouteError(
    capability,
    `未找到可用的 ${capability} 模型，请到「设置 → 模型路由」中配置供应商与模型。${attempts.length > 0 ? `\n尝试记录：${attempts.join('；')}` : ''}`,
  );
}

/** 模型是否支持该能力（用于 UI 校验） */
export function modelSupports(model: ModelEntry, capability: Capability): boolean {
  return model.capability === capability;
}
