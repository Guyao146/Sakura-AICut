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
import { contextOptions, normalizeBaseUrl } from '../utils';

/**
 * Google Gemini 适配器（Generative Language API）
 * - 文本 / 多模态：POST /v1beta/models/{model}:generateContent
 * - 图片（Gemini Image / Nano Banana）：同一接口，返回 inlineData 的 base64
 * - 视频（Veo）：POST /v1beta/models/{model}:predictLongRunning → 轮询 operation
 */
function geminiHeaders(ctx: AdapterContext): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-goog-api-key': ctx.credentials.apiKey ?? '',
    ...(ctx.extraHeaders ?? {}),
  };
}

function geminiUrl(ctx: AdapterContext, path: string): string {
  return `${normalizeBaseUrl(ctx.baseUrl)}/v1beta/${path}`;
}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
  inline_data?: { mime_type?: string; data?: string };
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
  error?: { message?: string; status?: string };
}

function uriToInlinePart(uri: string): GeminiPart | null {
  const match = uri.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { inlineData: { mimeType: match[1], data: match[2] } };
}

function collectText(payload: GeminiResponse): string {
  return (payload.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? '').join('');
}

export const geminiAdapter: ProviderAdapter = {
  protocol: 'gemini',
  label: 'Google Gemini',

  async chat(ctx: AdapterContext, req: TextGenerateRequest): Promise<TextGenerateResult> {
    const systemMessages = req.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const contents = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [
          ...(m.images ?? []).map(uriToInlinePart).filter((p): p is GeminiPart => p !== null),
          { text: m.content },
        ],
      }));

    const payload = await fetchJson<GeminiResponse>(
      geminiUrl(ctx, `models/${req.model}:generateContent`),
      {
        method: 'POST',
        headers: geminiHeaders(ctx),
        body: JSON.stringify({
          contents,
          ...(systemMessages ? { systemInstruction: { parts: [{ text: systemMessages }] } } : {}),
          generationConfig: {
            temperature: req.temperature,
            maxOutputTokens: req.maxTokens,
            ...(req.json ? { responseMimeType: 'application/json' } : {}),
            ...(req.params ?? {}),
          },
        }),
      },
      contextOptions(ctx),
    );
    if (payload?.error) throw new Error(`Gemini 请求失败：${payload.error.message}`);

    return {
      text: collectText(payload),
      usage: payload?.usageMetadata
        ? {
            promptTokens: payload.usageMetadata.promptTokenCount,
            completionTokens: payload.usageMetadata.candidatesTokenCount,
            totalTokens: payload.usageMetadata.totalTokenCount,
          }
        : undefined,
      model: req.model,
      raw: payload,
    };
  },

  async image(ctx: AdapterContext, req: ImageGenerateRequest): Promise<ImageGenerateResult> {
    const parts: GeminiPart[] = [{ text: req.prompt }];
    for (const ref of req.referenceImages ?? []) {
      const part = uriToInlinePart(ref);
      if (part) parts.push(part);
    }
    const payload = await fetchJson<GeminiResponse>(
      geminiUrl(ctx, `models/${req.model}:generateContent`),
      {
        method: 'POST',
        headers: geminiHeaders(ctx),
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: { responseModalities: ['IMAGE'], ...(req.params ?? {}) },
        }),
      },
      contextOptions(ctx, Math.max(ctx.timeoutSec, 300) * 1000),
    );
    if (payload?.error) throw new Error(`Gemini 图片生成失败：${payload.error.message}`);

    const images = (payload.candidates?.[0]?.content?.parts ?? [])
      .map((part) => {
        const inline = part.inlineData ?? part.inline_data;
        const data = inline?.data;
        const mime =
          part.inlineData?.mimeType ?? (part.inline_data as { mime_type?: string } | undefined)?.mime_type ?? 'image/png';
        return data ? { b64: `data:${mime};base64,${data}` } : null;
      })
      .filter((img): img is { b64: string } => img !== null);

    return { images, model: req.model, raw: payload };
  },

  async submitVideo(ctx: AdapterContext, req: VideoGenerateRequest): Promise<AsyncTaskHandle> {
    const instance: Record<string, unknown> = { prompt: req.prompt };
    if (req.firstFrameImage) {
      const match = req.firstFrameImage.match(/^data:([^;]+);base64,(.+)$/);
      if (match) instance.image = { bytesBase64Encoded: match[2], mimeType: match[1] };
    }
    const payload = await fetchJson<{ name?: string; error?: { message?: string } }>(
      geminiUrl(ctx, `models/${req.model}:predictLongRunning`),
      {
        method: 'POST',
        headers: geminiHeaders(ctx),
        body: JSON.stringify({
          instances: [instance],
          parameters: {
            aspectRatio: req.aspectRatio ?? '16:9',
            durationSeconds: req.durationSec ?? 8,
            ...(req.resolution ? { resolution: req.resolution } : {}),
            ...(req.negativePrompt ? { negativePrompt: req.negativePrompt } : {}),
            ...(req.params ?? {}),
          },
        }),
      },
      contextOptions(ctx),
    );
    const taskId = payload?.name;
    if (!taskId) throw new Error(`Veo 视频任务提交失败：${JSON.stringify(payload).slice(0, 300)}`);
    return { taskId, raw: payload };
  },

  async queryVideo(ctx: AdapterContext, taskId: string): Promise<AsyncTaskState> {
    const payload = await fetchJson<{
      done?: boolean;
      error?: { message?: string };
      response?: {
        generateVideoResponse?: { generatedSamples?: Array<{ video?: { uri?: string } }> };
        generatedVideos?: Array<{ video?: { uri?: string } }>;
      };
    }>(geminiUrl(ctx, taskId.replace(/^\/?v1beta\//, '')), { headers: geminiHeaders(ctx) }, contextOptions(ctx));

    if (payload?.error) return { status: 'failed', error: payload.error.message, raw: payload };
    if (!payload?.done) return { status: 'running', rawStatus: 'running', raw: payload };

    const samples =
      payload.response?.generateVideoResponse?.generatedSamples ?? payload.response?.generatedVideos ?? [];
    const uri = samples[0]?.video?.uri;
    if (!uri) return { status: 'failed', error: 'Veo 未返回视频地址', raw: payload };
    // 下载 Veo 产物需要附带 API Key
    return {
      status: 'succeeded',
      videoUrl: uri.includes('key=') ? uri : `${uri}${uri.includes('?') ? '&' : '?'}key=${ctx.credentials.apiKey ?? ''}`,
      rawStatus: 'succeeded',
      raw: payload,
    };
  },

  async probe(ctx: AdapterContext): Promise<ProbeResult> {
    const started = Date.now();
    try {
      const payload = await fetchJson<GeminiResponse>(
        geminiUrl(ctx, 'models/gemini-2.5-flash:generateContent'),
        {
          method: 'POST',
          headers: geminiHeaders(ctx),
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'ping' }] }] }),
        },
        { ...contextOptions(ctx, 30_000), retries: 0 },
      );
      if (payload?.error) {
        return { ok: false, message: payload.error.message ?? '鉴权失败', latencyMs: Date.now() - started };
      }
      return { ok: true, message: '连接成功', latencyMs: Date.now() - started };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - started,
      };
    }
  },
};
