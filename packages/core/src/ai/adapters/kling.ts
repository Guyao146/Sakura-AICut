import { createHmac } from 'node:crypto';
import { fetchJson } from '../../utils/http';
import type {
  AdapterContext,
  AsyncTaskHandle,
  AsyncTaskState,
  ImageGenerateRequest,
  ImageGenerateResult,
  ProbeResult,
  ProviderAdapter,
  TextGenerateRequest,
  TextGenerateResult,
  VideoGenerateRequest,
} from '../types';
import { contextOptions, extractImages, mapRemoteStatus, normalizeBaseUrl, pickNumber } from '../utils';

/**
 * 快手可灵 Kling（AK/SK 签名）
 * - JWT(HS256)：payload = { iss: accessKey, exp: now+1800, nbf: now-5 }
 * - 文生视频：POST /v1/videos/text2video   图生视频：POST /v1/videos/image2video
 * - 查询：GET  /v1/videos/{text2video|image2video}/{task_id}
 * - 图片：POST /v1/images/generations
 */
function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 生成可灵 JWT 鉴权头 */
export function klingAuthHeader(ctx: AdapterContext): string {
  const { accessKey, secretKey, apiKey } = ctx.credentials;
  const ak = accessKey ?? apiKey ?? '';
  const sk = secretKey ?? '';
  if (!ak || !sk) throw new Error('可灵需要同时配置 AccessKey 与 SecretKey');
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iss: ak, exp: now + 1800, nbf: now - 5 }));
  const signature = base64url(createHmac('sha256', sk).update(`${header}.${payload}`).digest());
  return `Bearer ${header}.${payload}.${signature}`;
}

function klingHeaders(ctx: AdapterContext): Record<string, string> {
  return { 'Content-Type': 'application/json', ...(ctx.extraHeaders ?? {}), Authorization: klingAuthHeader(ctx) };
}

function klingUrl(ctx: AdapterContext, path: string): string {
  const base = normalizeBaseUrl(ctx.baseUrl);
  const suffix = path.replace(/^\/v1/, '');
  return base.endsWith('/v1') ? `${base}${suffix}` : `${base}/v1${suffix}`;
}

interface KlingEnvelope<T> {
  code?: number;
  message?: string;
  data?: T;
}

function unwrap<T>(payload: KlingEnvelope<T> | undefined, action: string): T {
  if (!payload) throw new Error(`可灵 ${action} 返回空响应`);
  if (payload.code !== undefined && payload.code !== 0) {
    throw new Error(`可灵 ${action} 失败（code=${payload.code}）：${payload.message ?? '未知错误'}`);
  }
  if (!payload.data) throw new Error(`可灵 ${action} 返回数据为空`);
  return payload.data;
}

/** 可灵任务查询结果 → 统一状态 */
function parseKlingTask(payload: KlingEnvelope<Record<string, unknown>>, action: string): AsyncTaskState {
  const data = unwrap(payload, action);
  const rawStatus = String(data.task_status ?? 'processing');
  const result = (data.task_result ?? {}) as {
    videos?: Array<Record<string, unknown>>;
    images?: Array<Record<string, unknown>>;
  };
  const video = result.videos?.[0];
  return {
    status: mapRemoteStatus(rawStatus, {
      submitted: 'queued',
      processing: 'running',
      succeed: 'succeeded',
      failed: 'failed',
    }),
    videoUrl: typeof video?.url === 'string' ? video.url : undefined,
    durationSec: pickNumber(video?.duration),
    error: (data.task_status_msg as string) || undefined,
    rawStatus,
    raw: data,
  };
}

export const klingAdapter: ProviderAdapter = {
  protocol: 'kling',
  label: '快手可灵 Kling',

  async chat(_ctx: AdapterContext, _req: TextGenerateRequest): Promise<TextGenerateResult> {
    throw new Error('可灵不提供文本模型，请在「模型路由」中把文本能力指向其它供应商');
  },

  async image(ctx: AdapterContext, req: ImageGenerateRequest): Promise<ImageGenerateResult> {
    const body: Record<string, unknown> = {
      model_name: req.model,
      prompt: req.prompt,
      negative_prompt: req.negativePrompt,
      n: Math.max(1, Math.min(req.count ?? 1, 9)),
      aspect_ratio: req.aspectRatio,
      ...(req.referenceImages && req.referenceImages.length > 0
        ? { image: req.referenceImages[0], image_reference: 'subject' }
        : {}),
      ...(req.seed !== undefined ? { seed: req.seed } : {}),
      ...(req.params ?? {}),
    };
    const payload = await fetchJson<KlingEnvelope<Record<string, unknown>>>(
      klingUrl(ctx, '/v1/images/generations'),
      { method: 'POST', headers: klingHeaders(ctx), body: JSON.stringify(body) },
      contextOptions(ctx),
    );
    const data = unwrap(payload, '图片生成');
    return { images: extractImages(data.images ?? data.task_result ?? data), model: req.model, raw: payload };
  },

  async submitVideo(ctx: AdapterContext, req: VideoGenerateRequest): Promise<AsyncTaskHandle> {
    const isImageToVideo = Boolean(req.firstFrameImage);
    const path = isImageToVideo ? '/v1/videos/image2video' : '/v1/videos/text2video';
    const body: Record<string, unknown> = {
      model_name: req.model,
      prompt: req.prompt,
      negative_prompt: req.negativePrompt,
      mode: (req.params?.mode as string) ?? 'pro',
      aspect_ratio: req.aspectRatio,
      duration: String(req.durationSec ?? 5),
      cfg_scale: (req.params?.cfgScale as number) ?? 0.5,
      ...(isImageToVideo ? { image: req.firstFrameImage } : {}),
      ...(req.lastFrameImage ? { image_tail: req.lastFrameImage } : {}),
    };
    const payload = await fetchJson<KlingEnvelope<Record<string, unknown>>>(
      klingUrl(ctx, path),
      { method: 'POST', headers: klingHeaders(ctx), body: JSON.stringify(body) },
      contextOptions(ctx),
    );
    const data = unwrap(payload, '视频任务提交');
    const taskId = String(data.task_id ?? '');
    if (!taskId) throw new Error(`可灵视频任务提交失败：${JSON.stringify(payload).slice(0, 300)}`);
    return { taskId, raw: payload };
  },

  async queryVideo(ctx: AdapterContext, taskId: string): Promise<AsyncTaskState> {
    const payload = await fetchJson<KlingEnvelope<Record<string, unknown>>>(
      klingUrl(ctx, `/v1/videos/text2video/${taskId}`),
      { headers: klingHeaders(ctx) },
      contextOptions(ctx),
    );
    if (payload?.code !== undefined && payload.code !== 0) {
      // 图生视频的任务需换接口查询
      const fallback = await fetchJson<KlingEnvelope<Record<string, unknown>>>(
        klingUrl(ctx, `/v1/videos/image2video/${taskId}`),
        { headers: klingHeaders(ctx) },
        contextOptions(ctx),
      );
      return parseKlingTask(fallback, '视频查询');
    }
    return parseKlingTask(payload, '视频查询');
  },

  async probe(ctx: AdapterContext): Promise<ProbeResult> {
    const started = Date.now();
    try {
      await fetchJson(
        klingUrl(ctx, '/v1/videos/text2video/probe-connection'),
        { headers: klingHeaders(ctx) },
        { ...contextOptions(ctx, 20_000), retries: 0 },
      );
      return { ok: true, message: '鉴权通过', latencyMs: Date.now() - started };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const authed = message.includes('任务不存在') || message.includes('not found') || message.includes('1200');
      return {
        ok: authed,
        message: authed ? '鉴权通过（探测任务 ID 不存在属正常）' : message,
        latencyMs: Date.now() - started,
      };
    }
  },
};

