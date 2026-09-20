import { fetchJson, HttpError } from '../../utils/http';
import type {
  AdapterContext,
  AsyncTaskHandle,
  AsyncTaskState,
  AudioGenerateRequest,
  AudioGenerateResult,
  ImageGenerateRequest,
  ImageGenerateResult,
  ProbeResult,
  ProviderAdapter,
  TextGenerateRequest,
  TextGenerateResult,
  VideoGenerateRequest,
} from '../types';
import {
  aspectRatioToSize,
  authHeaders,
  contextFetch,
  contextOptions,
  extractImages,
  findFirstUrl,
  mapRemoteStatus,
  normalizeBaseUrl,
  pickNumber,
} from '../utils';

/**
 * 火山引擎方舟（Volcengine Ark）
 * - 文本/多模态：POST /api/v3/chat/completions
 * - 图片：POST /api/v3/images/generations （Seedream 系列，支持多参考图）
 * - 视频：POST /api/v3/contents/generations/tasks  （Seedance 系列，异步）
 *          控制参数以 " --ratio 9:16 --duration 5 --resolution 720p" 形式追加在提示词尾部
 */
function arkUrl(baseUrl: string, path: string): string {
  const base = normalizeBaseUrl(baseUrl);
  if (base.endsWith('/api/v3')) return `${base}${path}`;
  return `${base}/api/v3${path}`;
}

function mapArkError(payload: unknown): string | undefined {
  const obj = payload as { error?: { message?: string } | string } | undefined;
  if (!obj?.error) return undefined;
  return typeof obj.error === 'string' ? obj.error : obj.error.message;
}

export const volcengineAdapter: ProviderAdapter = {
  protocol: 'volcengine',
  label: '火山引擎方舟',

  async chat(ctx: AdapterContext, req: TextGenerateRequest): Promise<TextGenerateResult> {
    const url = arkUrl(ctx.baseUrl, '/chat/completions');
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
      max_tokens: req.maxTokens,
      ...(req.json ? { response_format: { type: 'json_object' } } : {}),
      ...(req.params ?? {}),
    };
    const payload = await fetchJson<{
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      model?: string;
      error?: { message?: string };
    }>(url, { method: 'POST', headers: authHeaders(ctx), body: JSON.stringify(body) }, contextOptions(ctx));

    if (payload?.error) throw new Error(`火山方舟文本请求失败：${payload.error.message}`);
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

  async image(ctx: AdapterContext, req: ImageGenerateRequest): Promise<ImageGenerateResult> {
    const url = arkUrl(ctx.baseUrl, '/images/generations');
    const size =
      req.width && req.height ? { width: req.width, height: req.height } : aspectRatioToSize(req.aspectRatio, 2048);
    const body: Record<string, unknown> = {
      model: req.model,
      prompt: req.prompt,
      response_format: 'url',
      size: `${size.width}x${size.height}`,
      watermark: false,
      ...(req.seed !== undefined ? { seed: req.seed } : {}),
      ...(req.referenceImages && req.referenceImages.length > 0 ? { image: req.referenceImages } : {}),
      ...(req.negativePrompt ? { negative_prompt: req.negativePrompt } : {}),
      ...(req.params ?? {}),
    };
    const payload = await fetchJson<unknown>(
      url,
      { method: 'POST', headers: authHeaders(ctx), body: JSON.stringify(body) },
      contextOptions(ctx, Math.max(ctx.timeoutSec, 300) * 1000),
    );
    const error = mapArkError(payload);
    if (error) throw new Error(`火山方舟图片生成失败：${error}`);
    return { images: extractImages(payload), model: req.model, raw: payload };
  },

  async audio(ctx: AdapterContext, req: AudioGenerateRequest): Promise<AudioGenerateResult> {
    // 火山方舟 TTS：POST /api/v3/audio/speech（OpenAI 兼容格式，返回二进制音频）
    const url = arkUrl(ctx.baseUrl, '/audio/speech');
    const format = req.format ?? 'mp3';
    const body: Record<string, unknown> = {
      model: req.model,
      input: req.input,
      voice: req.voice ?? 'zh_female_shaoergushi_mars',
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
      throw new HttpError(`火山方舟语音合成失败 HTTP ${res.status}`, res.status, url, text.slice(0, 500));
    }
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const json = (await res.json()) as Record<string, unknown>;
      const error2 = mapArkError(json);
      if (error2) throw new Error(`火山方舟语音合成失败：${error2}`);
      const urlField = (json.url ?? json.audio ?? json.data) as string | undefined;
      if (typeof urlField === 'string' && urlField.startsWith('http')) {
        return { url: urlField, format, model: req.model, raw: json };
      }
      const b64 = (json.b64_json ?? json.audio_base64) as string | undefined;
      if (typeof b64 === 'string' && b64.length > 0) {
        return { b64: b64.startsWith('data:') ? b64 : `data:audio/${format};base64,${b64}`, format, model: req.model, raw: json };
      }
      throw new Error(`火山方舟语音合成返回了无法解析的 JSON：${JSON.stringify(json).slice(0, 300)}`);
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

  async submitVideo(ctx: AdapterContext, req: VideoGenerateRequest): Promise<AsyncTaskHandle> {
    const url = arkUrl(ctx.baseUrl, '/contents/generations/tasks');
    // Seedance 通过提示词尾部的参数串控制比例 / 时长 / 分辨率 / 固定镜头
    const flags: string[] = [];
    if (req.aspectRatio) flags.push(`--ratio ${req.aspectRatio}`);
    if (req.durationSec) flags.push(`--duration ${Math.max(3, Math.min(Math.round(req.durationSec), 12))}`);
    if (req.resolution) flags.push(`--resolution ${req.resolution}`);
    if (req.seed !== undefined) flags.push(`--seed ${req.seed}`);
    if (req.params?.cameraFixed !== undefined) flags.push(`--camerafixed ${req.params.cameraFixed}`);
    const text = [req.prompt, ...flags].join(' ');

    const content: Array<Record<string, unknown>> = [{ type: 'text', text }];
    if (req.firstFrameImage) {
      content.push({ type: 'image_url', image_url: { url: req.firstFrameImage }, role: 'first_frame' });
    }
    if (req.lastFrameImage) {
      content.push({ type: 'image_url', image_url: { url: req.lastFrameImage }, role: 'last_frame' });
    }
    for (const ref of req.referenceImages ?? []) {
      content.push({ type: 'image_url', image_url: { url: ref }, role: 'reference_image' });
    }

    const body: Record<string, unknown> = { model: req.model, content, ...(req.params?.extraBody as object) };
    if (!body.extraBody) delete body.extraBody;
    const payload = await fetchJson<Record<string, unknown>>(
      url,
      { method: 'POST', headers: authHeaders(ctx), body: JSON.stringify(body) },
      contextOptions(ctx),
    );
    const taskId = String(payload?.id ?? '');
    if (!taskId) throw new Error(`火山方舟视频任务提交失败：${JSON.stringify(payload).slice(0, 300)}`);
    return { taskId, raw: payload };
  },

  async queryVideo(ctx: AdapterContext, taskId: string): Promise<AsyncTaskState> {
    const url = arkUrl(ctx.baseUrl, `/contents/generations/tasks/${taskId}`);
    const payload = await fetchJson<Record<string, unknown>>(url, { headers: authHeaders(ctx) }, contextOptions(ctx));
    return {
      status: mapRemoteStatus(typeof payload?.status === 'string' ? payload.status : 'running'),
      videoUrl: findFirstUrl(payload?.content ?? payload, ['video_url', 'url']),
      coverUrl: findFirstUrl(payload, ['cover_url', 'poster_url']),
      durationSec: pickNumber(payload?.duration),
      error: mapArkError(payload),
      rawStatus: typeof payload?.status === 'string' ? payload.status : undefined,
      raw: payload,
    };
  },

  async cancelVideo(ctx: AdapterContext, taskId: string): Promise<void> {
    const url = arkUrl(ctx.baseUrl, `/contents/generations/tasks/${taskId}`);
    await fetchJson(url, { method: 'DELETE', headers: authHeaders(ctx) }, contextOptions(ctx));
  },

  async probe(ctx: AdapterContext): Promise<ProbeResult> {
    const started = Date.now();
    try {
      const url = arkUrl(ctx.baseUrl, '/models');
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
