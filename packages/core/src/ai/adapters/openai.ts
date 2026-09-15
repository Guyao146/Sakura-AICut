import { fetchJson, HttpError, readSseLines } from '../../utils/http';
import type {
  AdapterContext,
  ImageGenerateRequest,
  ImageGenerateResult,
  ProbeResult,
  ProviderAdapter,
  TextGenerateRequest,
  TextGenerateResult,
  VideoGenerateRequest,
  AsyncTaskHandle,
  AsyncTaskState,
} from '../types';
import {
  aspectRatioToSize,
  authHeaders,
  contextFetch,
  contextOptions,
  extractImages,
  findFirstUrl,
  joinUrl,
  mapRemoteStatus,
  pickNumber,
} from '../utils';

/**
 * OpenAI 兼容协议适配器
 * 覆盖：OpenAI 官方、NewAPI、OneAPI、DeepSeek、Moonshot、通义兼容模式、Ollama、vLLM 等
 *
 * - 文本：POST {base}/v1/chat/completions（支持流式）
 * - 图片：POST {base}/v1/images/generations
 * - 视频：POST {base}/v1/video/generations（Sora 风格异步接口）+ 轮询
 */
export const openAICompatibleAdapter: ProviderAdapter = {
  protocol: 'openai',
  label: 'OpenAI 兼容',

  async chat(ctx, req: TextGenerateRequest): Promise<TextGenerateResult> {
    const url = joinUrl(ctx.baseUrl, '/v1/chat/completions');
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages.map((m) => ({
        role: m.role,
        content:
          m.images && m.images.length > 0
            ? [
                { type: 'text', text: m.content },
                ...m.images.map((image) => ({ type: 'image_url', image_url: { url: image } })),
              ]
            : m.content,
      })),
      temperature: req.temperature,
      top_p: req.topP,
      max_tokens: req.maxTokens,
      ...(req.json ? { response_format: { type: 'json_object' } } : {}),
      ...(req.params ?? {}),
    };

    if (req.onDelta) {
      body.stream = true;
      const res = await contextFetch(ctx)(url, {
        method: 'POST',
        headers: authHeaders(ctx),
        body: JSON.stringify(body),
        signal: contextOptions(ctx).signal,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new HttpError(`对话请求失败 HTTP ${res.status}`, res.status, url, text);
      }
      let full = '';
      await readSseLines(res, (data) => {
        try {
          const chunk = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) {
            full += delta;
            req.onDelta?.(delta);
          }
        } catch {
          /* 忽略心跳等非 JSON 行 */
        }
      });
      return { text: full };
    }

    const payload = await fetchJson<{
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      model?: string;
    }>(url, { method: 'POST', headers: authHeaders(ctx), body: JSON.stringify(body) }, contextOptions(ctx));

    return {
      text: payload?.choices?.[0]?.message?.content ?? '',
      usage: payload?.usage
        ? {
            promptTokens: payload.usage.prompt_tokens,
            completionTokens: payload.usage.completion_tokens,
            totalTokens: payload.usage.total_tokens,
          }
        : undefined,
      model: payload?.model ?? req.model,
      raw: payload,
    };
  },

  async image(ctx, req: ImageGenerateRequest): Promise<ImageGenerateResult> {
    const url = joinUrl(ctx.baseUrl, '/v1/images/generations');
    const size = req.width && req.height ? { width: req.width, height: req.height } : aspectRatioToSize(req.aspectRatio);
    const body: Record<string, unknown> = {
      model: req.model,
      prompt: req.negativePrompt ? `${req.prompt}\n\nAvoid: ${req.negativePrompt}` : req.prompt,
      n: Math.max(1, Math.min(req.count ?? 1, 8)),
      size: `${size.width}x${size.height}`,
      response_format: 'url',
      ...(req.seed !== undefined ? { seed: req.seed } : {}),
      ...(req.referenceImages && req.referenceImages.length > 0 ? { image: req.referenceImages } : {}),
      ...(req.strength !== undefined ? { strength: req.strength } : {}),
      ...(req.params ?? {}),
    };

    const payload = await fetchJson<unknown>(
      url,
      { method: 'POST', headers: authHeaders(ctx), body: JSON.stringify(body) },
      contextOptions(ctx, Math.max(ctx.timeoutSec, 300) * 1000),
    );
    return { images: extractImages(payload), model: req.model, raw: payload };
  },

  async submitVideo(ctx, req: VideoGenerateRequest): Promise<AsyncTaskHandle> {
    const url = joinUrl(ctx.baseUrl, '/v1/video/generations');
    const body: Record<string, unknown> = {
      model: req.model,
      prompt: req.prompt,
      ...(req.negativePrompt ? { negative_prompt: req.negativePrompt } : {}),
      seconds: String(req.durationSec ?? 5),
      size: req.aspectRatio === '9:16' ? '720x1280' : '1280x720',
      ...(req.firstFrameImage ? { input_reference: req.firstFrameImage } : {}),
      ...(req.seed !== undefined ? { seed: req.seed } : {}),
      ...(req.params ?? {}),
    };
    const payload = await fetchJson<Record<string, unknown>>(
      url,
      { method: 'POST', headers: authHeaders(ctx), body: JSON.stringify(body) },
      contextOptions(ctx),
    );
    const taskId = String(payload?.id ?? payload?.task_id ?? '');
    if (!taskId) throw new Error(`视频任务提交失败：未返回任务 ID（${JSON.stringify(payload).slice(0, 300)}）`);
    return { taskId, raw: payload };
  },

  async queryVideo(ctx, taskId: string): Promise<AsyncTaskState> {
    const url = joinUrl(ctx.baseUrl, `/v1/video/generations/${taskId}`);
    const payload = await fetchJson<Record<string, unknown>>(url, { headers: authHeaders(ctx) }, contextOptions(ctx));
    const errorObj = payload?.error as { message?: string } | undefined;
    return {
      status: mapRemoteStatus(typeof payload?.status === 'string' ? payload.status : 'running'),
      progress: pickNumber(payload?.progress),
      videoUrl: findFirstUrl(payload, ['url', 'video_url', 'videoUrl']),
      coverUrl: findFirstUrl(payload, ['cover_url', 'thumbnail_url', 'poster']),
      durationSec: pickNumber(payload?.duration ?? payload?.seconds),
      error: errorObj?.message,
      rawStatus: typeof payload?.status === 'string' ? payload.status : undefined,
      raw: payload,
    };
  },

  async probe(ctx: AdapterContext): Promise<ProbeResult> {
    const started = Date.now();
    try {
      const url = joinUrl(ctx.baseUrl, '/v1/models');
      const payload = await fetchJson<{ data?: Array<{ id?: string }> }>(
        url,
        { headers: authHeaders(ctx) },
        contextOptions(ctx, 20_000),
      );
      const models = (payload?.data ?? []).map((m) => String(m.id ?? '')).filter(Boolean);
      return { ok: true, message: `连接成功，发现 ${models.length} 个模型`, models, latencyMs: Date.now() - started };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - started,
      };
    }
  },
};
