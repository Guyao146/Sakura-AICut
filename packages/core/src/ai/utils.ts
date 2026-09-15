import type { TaskStatus } from '../types/common';
import type { AdapterContext, GeneratedImage } from './types';

/**
 * 适配器公共工具
 */

/** 拼接 baseUrl 与路径，自动处理 baseUrl 已带 /v1 的情况 */
export function joinUrl(baseUrl: string, path: string): string {
  const base = (baseUrl || '').trim().replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  if (base.endsWith('/v1') && p.startsWith('/v1/')) return `${base}${p.slice(3)}`;
  return `${base}${p}`;
}

export function authHeaders(ctx: AdapterContext): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(ctx.extraHeaders ?? {}),
  };
  const apiKey = ctx.credentials.apiKey;
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

export function normalizeBaseUrl(baseUrl: string): string {
  return (baseUrl || '').trim().replace(/\/+$/, '');
}

export function contextFetch(ctx: AdapterContext): typeof fetch {
  return ctx.fetchImpl ?? fetch;
}

export function contextOptions(ctx: AdapterContext, overrideMs?: number) {
  return { timeoutMs: overrideMs ?? Math.max(30, ctx.timeoutSec) * 1000, signal: ctx.signal };
}

/** 宽高比 → 像素尺寸（图片模型常用） */
export function aspectRatioToSize(
  aspectRatio: string | undefined,
  longestSide = 1024,
): { width: number; height: number } {
  const map: Record<string, [number, number]> = {
    '9:16': [9, 16],
    '16:9': [16, 9],
    '1:1': [1, 1],
    '4:3': [4, 3],
    '3:4': [3, 4],
    '21:9': [21, 9],
  };
  const [w, h] = map[aspectRatio ?? '1:1'] ?? [1, 1];
  if (w === h) return { width: longestSide, height: longestSide };
  if (w > h) {
    return { width: roundTo8(longestSide), height: roundTo8((longestSide * h) / w) };
  }
  return { width: roundTo8((longestSide * w) / h), height: roundTo8(longestSide) };
}

function roundTo8(value: number): number {
  return Math.max(256, Math.round(value / 8) * 8);
}

/** 各供应商状态文本 → 统一状态 */
export function mapRemoteStatus(raw: string | undefined, custom?: Record<string, TaskStatus>): TaskStatus {
  const status = (raw ?? '').toLowerCase();
  const table: Record<string, TaskStatus> = {
    queued: 'queued',
    pending: 'queued',
    submitted: 'queued',
    created: 'queued',
    in_queue: 'queued',
    waiting: 'queued',
    waiting_for_capacity: 'queued',
    running: 'running',
    processing: 'running',
    in_progress: 'running',
    generating: 'running',
    submitted_success: 'running',
    succeeded: 'succeeded',
    success: 'succeeded',
    completed: 'succeeded',
    complete: 'succeeded',
    done: 'succeeded',
    failed: 'failed',
    failure: 'failed',
    error: 'failed',
    canceled: 'canceled',
    cancelled: 'canceled',
    ...custom,
  };
  return table[status] ?? 'running';
}

/** 统一提取图片结果：兼容 url / b64_json / image_url 等字段 */
export function extractImages(payload: unknown): GeneratedImage[] {
  const root = payload as Record<string, unknown> | undefined;
  const list = (root?.data ?? root?.images ?? root?.output) as unknown;
  if (!Array.isArray(list)) {
    const single = root?.image as string | undefined;
    if (typeof single === 'string') return [{ url: single }];
    return [];
  }
  return list.map((item) => {
    if (typeof item === 'string') {
      return item.startsWith('data:') ? { b64: item } : { url: item };
    }
    const obj = item as Record<string, unknown>;
    const url = (obj.url ?? obj.image_url ?? obj.imageUrl) as string | undefined;
    const b64 = (obj.b64_json ?? obj.b64 ?? obj.image_base64) as string | undefined;
    const seed = obj.seed as number | undefined;
    return {
      url: url && !String(url).startsWith('data:') ? String(url) : undefined,
      b64: b64 ? String(b64) : url && String(url).startsWith('data:') ? String(url) : undefined,
      seed,
      revisedPrompt: (obj.revised_prompt ?? obj.revisedPrompt) as string | undefined,
    };
  });
}

/** 从各种嵌套结构里挖出第一个可用的 URL */
export function findFirstUrl(payload: unknown, keys: string[] = ['url', 'video_url', 'videoUrl', 'cover_url']): string | undefined {
  const seen = new Set<unknown>();
  const queue: unknown[] = [payload];
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) {
      queue.push(...node);
      continue;
    }
    const obj = node as Record<string, unknown>;
    for (const key of keys) {
      const value = obj[key];
      if (typeof value === 'string' && value.length > 0 && !value.startsWith('data:image')) return value;
    }
    queue.push(...Object.values(obj));
  }
  return undefined;
}

export function pickNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}
