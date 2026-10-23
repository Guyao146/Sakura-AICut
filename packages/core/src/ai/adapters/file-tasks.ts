import { fetchJson } from '../../utils/http';
import type { Language } from '../../types/common';
import type {
  AdapterContext,
  AsyncTaskHandle,
  AsyncTaskState,
  AudioGenerateRequest,
  AudioGenerateResult,
  AudioVoice,
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
 * 文件任务接口适配器
 * - 文本：POST /v1/text/chatcompletion_v2
 * - 图片：POST /v1/image_generation（同步返回）
 * - 语音：POST /v1/t2a_v2（T2A，非流式返回 hex 编码音频）
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
    throw new Error(`文件任务接口 ${action} 失败（code=${code}）：${payload?.base_resp?.status_msg ?? ''}`);
  }
}

/**
 * T2A 语言枚举（language_boost），与内部 Language 一一对应；
 * 不传时由接口自动判断文本语言。
 */
const T2A_LANGUAGES: Record<Language, string> = {
  'zh-CN': 'Chinese',
  'en-US': 'English',
  'ja-JP': 'Japanese',
  'ko-KR': 'Korean',
  'fr-FR': 'French',
  'de-DE': 'German',
  'es-ES': 'Spanish',
  'pt-BR': 'Portuguese',
  'it-IT': 'Italian',
  'ru-RU': 'Russian',
  'ar-SA': 'Arabic',
  'hi-IN': 'Hindi',
  'th-TH': 'Thai',
  'vi-VN': 'Vietnamese',
  'id-ID': 'Indonesian',
  'ms-MY': 'Malay',
  'tr-TR': 'Turkish',
  'nl-NL': 'Dutch',
  'pl-PL': 'Polish',
  'uk-UA': 'Ukrainian',
};

export const fileTasksAdapter: ProviderAdapter = {
  protocol: 'minimax',
  label: '文件任务接口',
  audioSpeedRange: { min: 0.5, max: 2 },

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

  async audio(ctx: AdapterContext, req: AudioGenerateRequest): Promise<AudioGenerateResult> {
    if (req.speed !== undefined && (!Number.isFinite(req.speed) || req.speed < 0.5 || req.speed > 2)) {
      throw new Error('文件任务接口语速范围为 0.5–2，请调整后重试');
    }
    // TTS：POST /v1/t2a_v2，非流式返回 hex 编码音频（output_format=url 时返回下载地址）
    const format = req.format === 'wav' || req.format === 'flac' ? req.format : 'mp3';
    const voiceSetting: Record<string, unknown> = {
      ...(req.params?.voice_setting as Record<string, unknown> | undefined),
    };
    voiceSetting.voice_id = req.voice || voiceSetting.voice_id || req.params?.voice || 'male-qn-qingse';
    if (req.speed !== undefined) voiceSetting.speed = req.speed;
    if (req.volume !== undefined) voiceSetting.vol = req.volume;
    if (req.pitch !== undefined) voiceSetting.pitch = req.pitch;
    const emotion = req.params?.emotion as string | undefined;
    if (emotion) voiceSetting.emotion = emotion;

    const audioSetting: Record<string, unknown> = { sample_rate: 32000, bitrate: 128000, channel: 1,
      ...(req.params?.audio_setting as Record<string, unknown> | undefined), format };
    const sampleRate = (req.params?.sampleRate ?? req.params?.sample_rate) as number | undefined;
    if (typeof sampleRate === 'number') audioSetting.sample_rate = sampleRate;
    const bitrate = req.params?.bitrate as number | undefined;
    if (typeof bitrate === 'number') audioSetting.bitrate = bitrate;

    // 已在嵌套结构中消费的键不再透传到顶层，避免重复或无效字段
    const rest: Record<string, unknown> = { ...(req.params ?? {}) };
    delete rest.emotion;
    delete rest.sampleRate;
    delete rest.sample_rate;
    delete rest.bitrate;
    delete rest.voice;
    delete rest.voice_setting;
    delete rest.audio_setting;

    const payload = await fetchJson<
      MmBaseResp & {
        data?: { audio?: string };
        extra_info?: { audio_length?: number; audio_format?: string };
      }
    >(
      mmUrl(ctx, '/v1/t2a_v2'),
      {
        method: 'POST',
        headers: mmHeaders(ctx),
        body: JSON.stringify({
          ...rest,
          model: req.model,
          text: req.input,
          stream: false,
          voice_setting: voiceSetting,
          audio_setting: audioSetting,
          output_format: 'hex',
          ...(req.language ? { language_boost: T2A_LANGUAGES[req.language] } : {}),
        }),
      },
      contextOptions(ctx, Math.max(ctx.timeoutSec, 180) * 1000),
    );
    assertMmOk(payload, '语音合成');
    const audio = payload?.data?.audio;
    if (typeof audio !== 'string' || !audio) throw new Error('文件任务接口语音合成失败：未返回音频内容');
    const durationSec = typeof payload.extra_info?.audio_length === 'number' ? payload.extra_info.audio_length / 1000 : undefined;
    if (/^https?:\/\//i.test(audio)) return { url: audio, format, durationSec, model: req.model, raw: payload };
    // hex → base64，转成 data URI 以复用统一的媒体落盘流程
    const hex = audio.replace(/\s+/g, '');
    if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) throw new Error('文件任务接口语音合成失败：音频数据无法解码');
    const b64 = Buffer.from(hex, 'hex').toString('base64');
    return {
      b64: `data:audio/${format};base64,${b64}`,
      format,
      durationSec,
      model: req.model,
      raw: payload,
    };
  },

  async listVoices(ctx: AdapterContext): Promise<AudioVoice[]> {
    type Voice = { voice_id?: string; voice_name?: string; description?: string[] };
    const payload = await fetchJson<MmBaseResp & {
      system_voice?: Voice[]; voice_cloning?: Voice[]; voice_generation?: Voice[];
    }>(mmUrl(ctx, '/v1/get_voice'), {
      method: 'POST', headers: mmHeaders(ctx), body: JSON.stringify({ voice_type: 'all' }),
    }, contextOptions(ctx));
    assertMmOk(payload, '查询音色');
    return [...new Map([...(payload.system_voice ?? []), ...(payload.voice_cloning ?? []), ...(payload.voice_generation ?? [])]
      .filter((voice) => typeof voice.voice_id === 'string' && voice.voice_id)
      .map((voice) => [voice.voice_id!, { id: voice.voice_id!, name: voice.voice_name || voice.voice_id!,
        description: voice.description?.join('；') }])).values()];
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
    if (!taskId) throw new Error(`文件任务接口 视频任务提交失败：${JSON.stringify(payload).slice(0, 300)}`);
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
