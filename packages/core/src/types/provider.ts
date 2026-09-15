import type { ID, Timestamps } from './common';

/**
 * 模型供应商与模型路由
 */

/** 模型能力 */
export type Capability = 'text' | 'image' | 'video' | 'audio' | 'vision' | 'embedding';

export const CAPABILITY_LABELS: Record<Capability, string> = {
  text: '文本 / 剧本 / 提示词',
  image: '图片生成',
  video: '视频生成',
  audio: '语音合成 / 音乐',
  vision: '图像理解',
  embedding: '向量',
};

/**
 * 协议类型：决定使用哪个适配器
 * - openai:        OpenAI 标准（/v1/chat/completions、/v1/images/generations 等）
 * - volcengine:    火山引擎方舟（文本同步、图片同步、视频为异步任务 /contents/generations/tasks）
 * - kling:         可灵（AK/SK JWT，全异步）
 * - minimax:       海螺（异步任务）
 * - dashscope:     阿里云百炼（兼容模式 + 原生异步视频）
 * - anthropic:     Claude Messages API
 * - gemini:        Google Generative Language API
 */
export type ProviderProtocol =
  | 'openai'
  | 'volcengine'
  | 'kling'
  | 'minimax'
  | 'dashscope'
  | 'anthropic'
  | 'gemini';

export const PROTOCOL_LABELS: Record<ProviderProtocol, string> = {
  openai: 'OpenAI 兼容（NewAPI / OneAPI / DeepSeek / Ollama 等）',
  volcengine: '火山引擎 方舟（Volcengine Ark）',
  kling: '快手可灵 Kling（AK/SK）',
  minimax: 'MiniMax 海螺',
  dashscope: '阿里云百炼 DashScope',
  anthropic: 'Anthropic Claude',
  gemini: 'Google Gemini',
};

/** 调用模式：同步 / 异步（提交任务后轮询） */
export type InvocationMode = 'sync' | 'async';

export interface ModelEntry {
  /** 调用时使用的模型 ID */
  id: string;
  label: string;
  capability: Capability;
  mode: InvocationMode;
  /** 支持的时长（视频模型） */
  durations?: number[];
  /** 支持的画幅 */
  aspectRatios?: string[];
  /** 默认参数，会合并进请求 */
  defaultParams?: Record<string, unknown>;
  /** 是否支持首尾帧 */
  supportsFirstFrame?: boolean;
  supportsLastFrame?: boolean;
  /** 是否支持参考图（人物一致性） */
  supportsReferenceImage?: boolean;
  /** 计费参考：单价 + 单位 */
  pricing?: { price: number; unit: string; currency?: string };
  /** 是否启用 */
  enabled?: boolean;
}

/** 供应商实例（API Key 加密存储于 credentialsEnc 字段） */
export interface ProviderConfig extends Timestamps {
  id: ID;
  /** 用户自定义名称，例如 "公司NewAPI" */
  name: string;
  protocol: ProviderProtocol;
  /** 接口根地址，例如 https://newapi.example.com */
  baseUrl: string;
  /** 运行时解密后的凭证（不会持久化明文） */
  credentials?: ProviderCredentials;
  /** 附加请求头 */
  extraHeaders?: Record<string, string>;
  /** 代理 */
  proxyUrl?: string | null;
  enabled: boolean;
  /** 是否为该能力的默认供应商 */
  isDefault?: boolean;
  /** 并发上限 */
  concurrency: number;
  /** 超时（秒） */
  timeoutSec: number;
  /** 可用模型列表 */
  models: ModelEntry[];
  /** 备注 */
  remark?: string | null;
}

export interface ProviderCredentials {
  /** 通用 API Key */
  apiKey?: string;
  /** 可灵 AK/SK */
  accessKey?: string;
  secretKey?: string;
  /** 按需扩展 */
  [key: string]: string | undefined;
}

/** 路由：每种能力选一个供应商 + 模型 */
export interface ModelRoute {
  capability: Capability;
  providerId: ID;
  modelId: string;
  /** 兜底链路 */
  fallbacks?: Array<{ providerId: ID; modelId: string }>;
  /** 覆盖参数（温度、尺寸等） */
  params?: Record<string, unknown>;
}

/** 内置供应商预设，方便一键添加 */
export interface ProviderPreset {
  key: string;
  label: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  docsUrl: string;
  credentialFields: Array<{ key: keyof ProviderCredentials & string; label: string; hint?: string }>;
  defaultModels: ModelEntry[];
  /** 描述 */
  description: string;
}
