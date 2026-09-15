import type { TaskStatus } from '../types/common';
import type { ProviderCredentials, ProviderProtocol } from '../types/provider';

/**
 * 供应商适配层的统一契约
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** 多模态内容（图片理解） */
  images?: string[];
}

export interface TextGenerateRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  /** 要求模型返回 JSON */
  json?: boolean;
  /** 流式回调（不支持时忽略） */
  onDelta?: (chunk: string) => void;
  /** 供应商特有的额外参数 */
  params?: Record<string, unknown>;
}

export interface TextGenerateResult {
  text: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  model?: string;
  raw?: unknown;
}

export interface ImageGenerateRequest {
  model: string;
  prompt: string;
  negativePrompt?: string;
  /** 输出尺寸（优先级高于 aspectRatio） */
  width?: number;
  height?: number;
  aspectRatio?: string;
  /** 生成张数 */
  count?: number;
  seed?: number;
  /** 参考图（人物一致性 / 图生图），URL 或 data URI */
  referenceImages?: string[];
  /** 图生图强度 0-1 */
  strength?: number;
  params?: Record<string, unknown>;
}

export interface GeneratedImage {
  url?: string;
  b64?: string;
  seed?: number;
  width?: number;
  height?: number;
  revisedPrompt?: string;
}

export interface ImageGenerateResult {
  images: GeneratedImage[];
  model?: string;
  raw?: unknown;
}

export interface VideoGenerateRequest {
  model: string;
  prompt: string;
  negativePrompt?: string;
  /** 时长（秒） */
  durationSec?: number;
  aspectRatio?: string;
  resolution?: '480p' | '720p' | '1080p' | string;
  fps?: number;
  /** 首帧图 */
  firstFrameImage?: string;
  /** 尾帧图 */
  lastFrameImage?: string;
  /** 参考图（图生视频 / 主体参考） */
  referenceImages?: string[];
  seed?: number;
  /** 是否带原声 */
  withAudio?: boolean;
  params?: Record<string, unknown>;
}

export interface AsyncTaskHandle {
  /** 供应商侧任务 ID */
  taskId: string;
  /** 立即返回的结果（部分模型同步返回） */
  immediate?: VideoGenerateResult;
  raw?: unknown;
}

export interface AsyncTaskState {
  status: TaskStatus;
  /** 0-100 */
  progress?: number;
  videoUrl?: string;
  coverUrl?: string;
  durationSec?: number;
  error?: string;
  /** 供应商原始状态文本，用于展示 */
  rawStatus?: string;
  raw?: unknown;
}

export interface VideoGenerateResult {
  url: string;
  coverUrl?: string;
  durationSec?: number;
  width?: number;
  height?: number;
  raw?: unknown;
}

export interface ProbeResult {
  ok: boolean;
  message: string;
  /** 探测到的模型列表 */
  models?: string[];
  latencyMs?: number;
}

/** 适配器运行时上下文 */
export interface AdapterContext {
  /** 供应商 ID（用于日志） */
  providerId: string;
  providerName: string;
  baseUrl: string;
  credentials: ProviderCredentials;
  extraHeaders?: Record<string, string>;
  timeoutSec: number;
  /** 默认取全局 fetch，可注入假实现做单测 */
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export interface ProviderAdapter {
  protocol: ProviderProtocol;
  /** 供应商显示名 */
  label: string;
  chat(ctx: AdapterContext, req: TextGenerateRequest): Promise<TextGenerateResult>;
  image?(ctx: AdapterContext, req: ImageGenerateRequest): Promise<ImageGenerateResult>;
  /** 异步视频：提交任务 */
  submitVideo?(ctx: AdapterContext, req: VideoGenerateRequest): Promise<AsyncTaskHandle>;
  /** 异步视频：查询任务 */
  queryVideo?(ctx: AdapterContext, taskId: string): Promise<AsyncTaskState>;
  /** 取消任务（可选） */
  cancelVideo?(ctx: AdapterContext, taskId: string): Promise<void>;
  /** 连通性检测 */
  probe(ctx: AdapterContext): Promise<ProbeResult>;
}
