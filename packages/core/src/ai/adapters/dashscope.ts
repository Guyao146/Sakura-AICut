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
import {
  aspectRatioToSize,
  authHeaders,
  contextOptions,
  extractImages,
  findFirstUrl,
  mapRemoteStatus,
  normalizeBaseUrl,
  pickNumber,
} from '../utils';

/**
 * 阿里云百炼 DashScope 适配器
 * - 文本：POST /compatible-mode/v1/chat/completions（OpenAI 兼容模式）
 * - 图片：POST /api/v1/services/aigc/text2image/image-synthesis（异步，Header X-DashScope-Async: enable）
 * - 视频：POST /api/v1/services/aigc/video-generation/video-synthesis（异步，万相 wanx / wan2.x）
 * - 查询：GET  /api/v1/tasks/{task_id}
 */
function dshUrl(ctx: AdapterContext, path: string): string {
  return `${normalizeBaseUrl(ctx.baseUrl)}${path}`;
}

function asyncHeaders(ctx: AdapterContext): Record<string, string> {
  return { ...authHeaders(ctx), 'X-DashScope-Async': 'enable' };
}

interface DshTaskResp {
  output?: Record<string, unknown>;
  request_id?: string;
  code?: string;
  message?: string;
}

function parseDshTask(payload: DshTaskResp, kind: 'image' | 'video'): AsyncTaskState {
  const output = payload.output ?? {};
  const status = mapRemoteStatus(typeof output.task_status === 'string' ? output.task_status : 'RUNNING', {
    pending: 'queued',
    running: 'running',
    succeeded: 'succeeded',
    failed: 'failed',
    canceled: 'canceled',
    unknown: 'running',
  });
  return {
    status,
    videoUrl:
      kind === 'video' ? ((output.video_url as string) ?? findFirstUrl(output, ['video_url', 'url'])) : undefined,
    coverUrl: (output.cover_url as string) ?? undefined,
    durationSec: pickNumber(output.duration),
    error: (output.message as string) ?? payload.message,
    rawStatus: typeof output.task_status === 'string' ? output.task_status : undefined,
    raw: payload,
  };
}

/** 轮询百炼异步任务直到结束 */
async function waitDashscopeTask(ctx: AdapterContext, taskId: string, kind: 'image' | 'video'): Promise<AsyncTaskState> {
  const deadline = Date.now() + 5 * 60 * 1000;
  for (;;) {
    const payload = await fetchJson<DshTaskResp>(
      dshUrl(ctx, `/api/v1/tasks/${taskId}`),
      { headers: authHeaders(ctx) },
      contextOptions(ctx),
    );
    const state = parseDshTask(payload, kind);
    if (state.status === 'succeeded' || state.status === 'failed' || state.status === 'canceled') return state;
    if (Date.now() > deadline) throw new Error('百炼异步任务轮询超时');
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

export const dashscopeAdapter: ProviderAdapter = {
  protocol: 'dashscope',
  label: '阿里云百炼 DashScope',

  async chat(ctx: AdapterContext, req: TextGenerateRequest): Promise<TextGenerateResult> {
    const payload = await fetchJson<{
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      model?: string;
    }>(
      dshUrl(ctx, '/compatible-mode/v1/chat/completions'),
      {
        method: 'POST',
        headers: authHeaders(ctx),
        body: JSON.stringify({
          model: req.model,
          messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
          temperature: req.temperature,
          max_tokens: req.maxTokens,
          ...(req.json ? { response_format: { type: 'json_object' } } : {}),
          ...(req.params ?? {}),
        }),
      },
      contextOptions(ctx),
    );
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
    const size =
      req.width && req.height ? { width: req.width, height: req.height } : aspectRatioToSize(req.aspectRatio, 1024);
    const payload = await fetchJson<DshTaskResp>(
      dshUrl(ctx, '/api/v1/services/aigc/text2image/image-synthesis'),
      {
        method: 'POST',
        headers: asyncHeaders(ctx),
        body: JSON.stringify({
          model: req.model,
          input: { prompt: req.prompt, ...(req.negativePrompt ? { negative_prompt: req.negativePrompt } : {}) },
          parameters: { size: `${size.width}*${size.height}`, n: req.count ?? 1, ...(req.params ?? {}) },
        }),
      },
      contextOptions(ctx),
    );
    const taskId = String((payload.output?.task_id as string) ?? '');
    if (taskId) {
      // 图片接口同样是异步的，这里阻塞等待结果
      const finalState = await waitDashscopeTask(ctx, taskId, 'image');
      if (finalState.status === 'failed') throw new Error(`百炼图片生成失败：${finalState.error ?? '未知错误'}`);
      const results = (finalState.raw as DshTaskResp | undefined)?.output?.results as
        | Array<Record<string, unknown>>
        | undefined;
      return { images: extractImages(results ?? finalState.raw), model: req.model, raw: finalState.raw };
    }
    return { images: extractImages(payload), model: req.model, raw: payload };
  },

  async submitVideo(ctx: AdapterContext, req: VideoGenerateRequest): Promise<AsyncTaskHandle> {
    const size = req.aspectRatio === '9:16' ? '1080*1920' : '1920*1080';
    const payload = await fetchJson<DshTaskResp>(
      dshUrl(ctx, '/api/v1/services/aigc/video-generation/video-synthesis'),
      {
        method: 'POST',
        headers: asyncHeaders(ctx),
        body: JSON.stringify({
          model: req.model,
          input: {
            prompt: req.prompt,
            ...(req.firstFrameImage ? { img_url: req.firstFrameImage } : {}),
          },
          parameters: {
            size,
            duration: req.durationSec ?? 5,
            prompt_extend: true,
            ...(req.params ?? {}),
          },
        }),
      },
      contextOptions(ctx),
    );
    const taskId = String((payload.output?.task_id as string) ?? '');
    if (!taskId) throw new Error(`百炼视频任务提交失败：${JSON.stringify(payload).slice(0, 300)}`);
    return { taskId, raw: payload };
  },

  async queryVideo(ctx: AdapterContext, taskId: string): Promise<AsyncTaskState> {
    const payload = await fetchJson<DshTaskResp>(
      dshUrl(ctx, `/api/v1/tasks/${taskId}`),
      { headers: authHeaders(ctx) },
      contextOptions(ctx),
    );
    return parseDshTask(payload, 'video');
  },

  async probe(ctx: AdapterContext): Promise<ProbeResult> {
    const started = Date.now();
    try {
      await fetchJson(
        dshUrl(ctx, '/compatible-mode/v1/models'),
        { headers: authHeaders(ctx) },
        { ...contextOptions(ctx, 20_000), retries: 0 },
      );
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
