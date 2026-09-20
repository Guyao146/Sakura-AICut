import type {
  AsyncTaskHandle,
  AsyncTaskState,
  AudioGenerateRequest,
  AudioGenerateResult,
  Capability,
  ChatMessage,
  ImageGenerateRequest,
  ImageGenerateResult,
  TextGenerateResult,
  VideoGenerateRequest,
} from '@sakura/core';
import { getAdapter, resolveRoute } from '@sakura/core/server';
import type { RouteResolution } from '@sakura/core/server';
import { listModelRoutes, listProviders } from '@sakura/db';

/**
 * 统一模型调用入口（web 与 worker 共用）
 */

export interface RouteOverride {
  providerId?: string;
  modelId?: string;
  params?: Record<string, unknown>;
}

export function routeFor(capability: Capability, override?: RouteOverride): RouteResolution {
  return resolveRoute(capability, listModelRoutes(), listProviders(), override);
}

export function currentRouteSummary(): Array<{ capability: string; providerName: string; modelId: string }> {
  const providers = listProviders();
  return listModelRoutes().map((route) => ({
    capability: route.capability,
    providerName: providers.find((p) => p.id === route.providerId)?.name ?? '（供应商已删除）',
    modelId: route.modelId,
  }));
}

/** 文本生成（同步） */
export async function runText(
  input: {
    messages: ChatMessage[];
    json?: boolean;
    temperature?: number;
    maxTokens?: number;
    override?: RouteOverride;
    onDelta?: (chunk: string) => void;
  },
): Promise<TextGenerateResult & { providerId: string; providerName: string }> {
  const route = routeFor('text', input.override);
  const defaults = route.model.defaultParams ?? {};
  const result = await route.adapter.chat(route.ctx, {
    model: route.model.id,
    messages: input.messages,
    json: input.json,
    temperature: input.temperature ?? (defaults.temperature as number | undefined),
    maxTokens: input.maxTokens ?? (defaults.maxTokens as number | undefined),
    onDelta: input.onDelta,
    params: Object.keys(defaults).length > 0 ? defaults : undefined,
  });
  return { ...result, providerId: route.provider.id, providerName: route.provider.name };
}

/** 图片生成（同步返回结果，多数模型 10-60 秒） */
export async function runImage(
  input: Omit<ImageGenerateRequest, 'model'> & { model?: string; override?: RouteOverride },
): Promise<ImageGenerateResult & { providerId: string; providerName: string }> {
  const route = routeFor('image', input.override);
  if (!route.adapter.image) throw new Error(`供应商「${route.provider.name}」不支持图片生成`);
  const result = await route.adapter.image(route.ctx, {
    ...input,
    model: input.model ?? route.model.id,
    params: { ...(route.model.defaultParams ?? {}), ...(input.params ?? {}) },
  });
  return { ...result, providerId: route.provider.id, providerName: route.provider.name };
}

/** 语音合成（同步返回音频字节流） */
export async function runAudio(
  input: Omit<AudioGenerateRequest, 'model'> & { model?: string; override?: RouteOverride },
): Promise<AudioGenerateResult & { providerId: string; providerName: string }> {
  const route = routeFor('audio', input.override);
  if (!route.adapter.audio) throw new Error(`供应商「${route.provider.name}」不支持语音合成`);
  const result = await route.adapter.audio(route.ctx, {
    ...input,
    model: input.model ?? route.model.id,
    params: { ...(route.model.defaultParams ?? {}), ...(input.params ?? {}) },
  });
  return { ...result, providerId: route.provider.id, providerName: route.provider.name };
}

/** 提交视频任务（异步） */
export async function submitVideo(
  input: Omit<VideoGenerateRequest, 'model'> & { model?: string; override?: RouteOverride },
): Promise<{ handle: AsyncTaskHandle; providerId: string; providerName: string; modelId: string }> {
  const route = routeFor('video', input.override);
  if (!route.adapter.submitVideo) throw new Error(`供应商「${route.provider.name}」不支持视频生成`);
  const handle = await route.adapter.submitVideo(route.ctx, {
    ...input,
    model: input.model ?? route.model.id,
    params: { ...(route.model.defaultParams ?? {}), ...(input.params ?? {}) },
  });
  return { handle, providerId: route.provider.id, providerName: route.provider.name, modelId: route.model.id };
}

/** 查询视频任务状态 */
export async function queryVideoTask(providerId: string, taskId: string): Promise<AsyncTaskState> {
  const providers = listProviders();
  const provider = providers.find((item) => item.id === providerId);
  if (!provider) throw new Error(`供应商不存在：${providerId}`);
  const route = resolveRoute('video', listModelRoutes(), providers, { providerId });
  if (!route.adapter.queryVideo) throw new Error(`供应商「${provider.name}」不支持视频任务查询`);
  return route.adapter.queryVideo(route.ctx, taskId);
}

/** 供应商连通性检测 */
export async function probeProvider(providerId: string) {
  const providers = listProviders();
  const provider = providers.find((item) => item.id === providerId);
  if (!provider) throw new Error(`供应商不存在：${providerId}`);
  const adapter = getAdapter(provider.protocol);
  return adapter.probe({
    providerId: provider.id,
    providerName: provider.name,
    baseUrl: provider.baseUrl,
    credentials: provider.credentials ?? {},
    extraHeaders: provider.extraHeaders,
    timeoutSec: provider.timeoutSec ?? 60,
  });
}

/** 供应商余额查询（尽力而为，不支持时抛出可读错误） */
export async function fetchProviderBalance(providerId: string) {
  const providers = listProviders();
  const provider = providers.find((item) => item.id === providerId);
  if (!provider) throw new Error(`供应商不存在：${providerId}`);
  const adapter = getAdapter(provider.protocol);
  if (!adapter.fetchBalance) {
    return { supported: false as const, detail: `「${provider.name}」暂不支持余额查询（仅 OpenAI 兼容 / NewAPI / OneAPI 支持）` };
  }
  const result = await adapter.fetchBalance({
    providerId: provider.id,
    providerName: provider.name,
    baseUrl: provider.baseUrl,
    credentials: provider.credentials ?? {},
    extraHeaders: provider.extraHeaders,
    timeoutSec: provider.timeoutSec ?? 60,
  });
  if (!result) return { supported: false as const, detail: `「${provider.name}」余额查询失败：接口未返回有效数据` };
  return { supported: true as const, ...result };
}
