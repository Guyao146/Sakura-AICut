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

/** 协议类型决定适配器；持久化标识保留以兼容已有配置，界面使用中性名称。 */
export type ProviderProtocol =
  | 'openai'
  | 'volcengine'
  | 'kling'
  | 'minimax'
  | 'dashscope'
  | 'anthropic'
  | 'gemini';

export const PROTOCOL_LABELS: Record<ProviderProtocol, string> = {
  openai: '通用兼容接口',
  volcengine: '内容任务接口（v3）',
  kling: '签名媒体接口（AK/SK）',
  minimax: '文件任务接口',
  dashscope: '服务任务接口',
  anthropic: '消息接口（Messages）',
  gemini: '多模态内容接口',
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
  /** 用户自定义名称，例如 "内部模型服务" */
  name: string;
  protocol: ProviderProtocol;
  /** 接口根地址，例如 https://models.example.com */
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
  /** 签名鉴权 AK/SK */
  accessKey?: string;
  secretKey?: string;
  /** 按需扩展 */
  [key: string]: string | undefined;
}

/** 计费展示：把 ModelEntry.pricing 格式化成「¥0.3/张」这样的短文本 */
export function formatPricing(pricing?: { price: number; unit: string; currency?: string }): string | null {
  if (!pricing || typeof pricing.price !== 'number') return null;
  const currency = pricing.currency === 'USD' ? '$' : '¥';
  return `${currency}${pricing.price}/${pricing.unit}`;
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
