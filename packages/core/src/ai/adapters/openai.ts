import { fetchJson, HttpError, readSseLines } from '../../utils/http';
import type {
  AdapterContext,
  AudioGenerateRequest,
  AudioGenerateResult,
  BalanceResult,
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

  async audio(ctx, req: AudioGenerateRequest): Promise<AudioGenerateResult> {
    // OpenAI 标准 TTS：POST /v1/audio/speech，直接返回二进制音频流
    const url = joinUrl(ctx.baseUrl, '/v1/audio/speech');
    const format = req.format ?? 'mp3';
    const body: Record<string, unknown> = {
      model: req.model,
      input: req.input,
      voice: req.voice ?? 'alloy',
      response_format: format,
      ...(req.speed !== undefined ? { speed: req.speed } : {}),
      ...(req.language ? { language: req.language } : {}),
      ...(req.params ?? {}),
    };

    const res = await contextFetch(ctx)(url, {
      method: 'POST',
      headers: authHeaders(ctx),
      body: JSON.stringify(body),
      signal: contextOptions(ctx, Math.max(ctx.timeoutSec, 180) * 1000).signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new HttpError(`语音合成失败 HTTP ${res.status}`, res.status, url, text.slice(0, 500));
    }

    // 部分网关返回 JSON 包裹（{data: {...}} 或 {audio: '...'}），优先取二进制
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const json = (await res.json()) as Record<string, unknown>;
      const urlField = (json.url ?? json.audio ?? json.audio_url ?? json.data) as string | undefined;
      if (typeof urlField === 'string' && urlField.startsWith('http')) {
        return { url: urlField, format, model: req.model, raw: json };
      }
      const b64 = (json.b64_json ?? json.audio_base64 ?? json.data) as string | undefined;
      if (typeof b64 === 'string' && b64.length > 0) {
        return { b64: b64.startsWith('data:') ? b64 : `data:audio/${format};base64,${b64}`, format, model: req.model, raw: json };
      }
      throw new Error(`语音合成返回了无法解析的 JSON：${JSON.stringify(json).slice(0, 300)}`);
    }

    const buffer = new Uint8Array(await res.arrayBuffer());
    const b64 = Buffer.from(buffer).toString('base64');
    return {
      b64: `data:audio/${format};base64,${b64}`,
      format,
      model: req.model,
      raw: { contentType, size: buffer.byteLength },
    };
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

  async fetchBalance(ctx: AdapterContext): Promise<BalanceResult | null> {
    const tryFetch = async (path: string) =>
      fetchJson<Record<string, unknown>>(joinUrl(ctx.baseUrl, path), { headers: authHeaders(ctx) }, contextOptions(ctx, 15_000));

    // 1) NewAPI / OneAPI：/api/user/self（sk- 密钥即可查询）
    try {
      const payload = await tryFetch('/api/user/self');
      const data = (payload?.data ?? payload) as Record<string, unknown> | undefined;
      const quota = Number(data?.quota);
      const usedQuota = Number(data?.used_quota);
      if (Number.isFinite(quota) && quota >= 0) {
        // NewAPI 额度单位为美元的 500000 倍（quota_per_unit 默认 500000）
        const perUnit = Number(data?.quota_per_unit) || 500_000;
        const balance = quota / perUnit;
        const used = Number.isFinite(usedQuota) ? usedQuota / perUnit : undefined;
        return {
          balance: Math.round(balance * 10000) / 10000,
          used: used !== undefined ? Math.round(used * 10000) / 10000 : undefined,
          currency: 'USD',
          detail: `剩余 $${(Math.round(balance * 10000) / 10000).toFixed(4)}${used !== undefined ? `，已用 $${(Math.round(used * 10000) / 10000).toFixed(4)}` : ''}`,
          raw: payload,
        };
      }
    } catch {
      /* 端点不存在或无权限，继续尝试下一种 */
    }

    // 2) OpenAI 官方风格：/v1/dashboard/billing/credit_grants
    try {
      const payload = await tryFetch('/v1/dashboard/billing/credit_grants');
      const grants = payload?.grants as Array<{ grant_amount?: number; used_amount?: number }> | undefined;
      if (grants && grants.length > 0) {
        const total = grants.reduce((sum, g) => sum + Number(g.grant_amount ?? 0), 0);
        const used = grants.reduce((sum, g) => sum + Number(g.used_amount ?? 0), 0);
        return {
          balance: Math.round((total - used) * 100) / 100,
          used: Math.round(used * 100) / 100,
          currency: 'USD',
          detail: `剩余 $${(total - used).toFixed(2)}，已用 $${used.toFixed(2)}`,
          raw: payload,
        };
      }
    } catch {
      /* 不支持则返回 null */
    }

    return null;
  },
};
