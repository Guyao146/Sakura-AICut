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
  authHeaders,
  contextOptions,
  extractImages,
  findFirstUrl,
  joinUrl,
  mapRemoteStatus,
  normalizeBaseUrl,
} from '../utils';

/**
 * MiniMax 海螺适配器
 * - 文本：POST /v1/text/chatcompletion_v2
 * - 图片：POST /v1/image_generation（同步返回）
 * - 视频：POST /v1/video_generation（异步）→ GET /v1/query/video_generation?task_id=
 *         成功后拿到 file_id，再 GET /v1/files/retrieve?file_id= 取下载地址
 * 部分接口需要 GroupId 查询参数，可在凭证中配置 groupId。
 */
function mmUrl(ctx: AdapterContext, path: string, query?: Record<string, string | undefined>): string {
  const url = new URL(joinUrl(normalizeBaseUrl(ctx.baseUrl), path));
  const groupId = ctx.credentials.groupId;
  if (groupId) url.searchParams.set('GroupId', groupId);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}

function mmHeaders(ctx: AdapterContext): Record<string, string> {
  return { ...authHeaders(ctx), ...(ctx.extraHeaders ?? {}) };
}

interface MmBaseResp {
  base_resp?: { status_code?: number; status_msg?: string };
}

function assertMmOk(payload: MmBaseResp | undefined, action: string): void {
  const code = payload?.base_resp?.status_code;
  if (code !== undefined && code !== 0) {
    throw new Error(`MiniMax ${action} 失败（code=${code}）：${payload?.base_resp?.status_msg ?? ''}`);
  }
}

export const minimaxAdapter: ProviderAdapter = {
  protocol: 'minimax',
  label: 'MiniMax 海螺',

  async chat(ctx: AdapterContext, req: TextGenerateRequest): Promise<TextGenerateResult> {
    const payload = await fetchJson<
      MmBaseResp & {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number };
        model?: string;
      }
    >(
      mmUrl(ctx, '/v1/text/chatcompletion_v2'),
      {
        method: 'POST',
        headers: mmHeaders(ctx),
        body: JSON.stringify({
          model: req.model,
          messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
          temperature: req.temperature,
          max_tokens: req.maxTokens,
          ...(req.params ?? {}),
        }),
      },
      contextOptions(ctx),
    );
    assertMmOk(payload, '文本请求');
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
    const payload = await fetchJson<MmBaseResp & { data?: { image_urls?: string[] } }>(
      mmUrl(ctx, '/v1/image_generation'),
      {
        method: 'POST',
        headers: mmHeaders(ctx),
        body: JSON.stringify({
          model: req.model,
          prompt: req.prompt,
          aspect_ratio: req.aspectRatio ?? '1:1',
          n: Math.max(1, Math.min(req.count ?? 1, 9)),
          response_format: 'url',
          prompt_optimizer: true,
          ...(req.params ?? {}),
        }),
      },
      contextOptions(ctx, Math.max(ctx.timeoutSec, 300) * 1000),
    );
    assertMmOk(payload, '图片生成');
    return { images: extractImages(payload?.data?.image_urls ?? []), model: req.model, raw: payload };
  },

  async submitVideo(ctx: AdapterContext, req: VideoGenerateRequest): Promise<AsyncTaskHandle> {
    const payload = await fetchJson<MmBaseResp & { task_id?: string }>(
      mmUrl(ctx, '/v1/video_generation'),
      {
        method: 'POST',
        headers: mmHeaders(ctx),
        body: JSON.stringify({
          model: req.model,
          prompt: req.prompt,
          prompt_optimizer: (req.params?.promptOptimizer as boolean) ?? true,
          ...(req.firstFrameImage ? { first_frame_image: req.firstFrameImage } : {}),
          ...(req.lastFrameImage ? { last_frame_image: req.lastFrameImage } : {}),
          ...(req.params?.duration ? { duration: req.params.duration } : {}),
          ...(req.params?.resolution
            ? { resolution: req.params.resolution }
            : { resolution: req.resolution ?? '1080P' }),
        }),
      },
      contextOptions(ctx),
    );
    assertMmOk(payload, '视频任务提交');
    const taskId = String(payload?.task_id ?? '');
    if (!taskId) throw new Error(`MiniMax 视频任务提交失败：${JSON.stringify(payload).slice(0, 300)}`);
    return { taskId, raw: payload };
  },

  async queryVideo(ctx: AdapterContext, taskId: string): Promise<AsyncTaskState> {
    const payload = await fetchJson<MmBaseResp & { status?: string; file_id?: string }>(
      mmUrl(ctx, '/v1/query/video_generation', { task_id: taskId }),
      { headers: mmHeaders(ctx) },
      contextOptions(ctx),
    );
    assertMmOk(payload, '视频查询');
    const status = mapRemoteStatus(payload?.status, {
      preparing: 'queued',
      queueing: 'queued',
      processing: 'running',
      success: 'succeeded',
      fail: 'failed',
    });

    let videoUrl: string | undefined;
    if (status === 'succeeded' && payload?.file_id) {
      const filePayload = await fetchJson<
        MmBaseResp & { file?: { download_url?: string; backup_download_url?: string } }
      >(
        mmUrl(ctx, '/v1/files/retrieve', { file_id: payload.file_id }),
        { headers: mmHeaders(ctx) },
        contextOptions(ctx),
      );
      assertMmOk(filePayload, '视频文件获取');
      videoUrl = filePayload?.file?.download_url ?? filePayload?.file?.backup_download_url;
    }

    return {
      status,
      videoUrl: videoUrl ?? findFirstUrl(payload, ['download_url', 'url']),
      rawStatus: payload?.status,
      raw: payload,
    };
  },

  async probe(ctx: AdapterContext): Promise<ProbeResult> {
    const started = Date.now();
    try {
      const payload = await fetchJson<MmBaseResp>(
        mmUrl(ctx, '/v1/text/chatcompletion_v2'),
        {
          method: 'POST',
          headers: mmHeaders(ctx),
          body: JSON.stringify({
            model: 'MiniMax-Text-01',
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 1,
          }),
        },
        contextOptions(ctx, 30_000),
      );
      assertMmOk(payload, '连通性检测');
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
