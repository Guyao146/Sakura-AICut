import { messagesAdapter } from './adapters/messages';
import { serviceTasksAdapter } from './adapters/service-tasks';
import { contentGenerationAdapter } from './adapters/content-generation';
import { signedMediaAdapter } from './adapters/signed-media';
import { fileTasksAdapter } from './adapters/file-tasks';
import { compatibleAdapter } from './adapters/compatible';
import { contentTasksAdapter } from './adapters/content-tasks';
import type { ProviderAdapter } from './types';
import type { ProviderProtocol } from '../types/provider';

/**
 * 适配器注册表（服务端使用；含 node:crypto 依赖，勿在客户端组件中引入）
 */
export const ADAPTERS: Record<ProviderProtocol, ProviderAdapter> = {
  openai: compatibleAdapter,
  volcengine: contentTasksAdapter,
  kling: signedMediaAdapter,
  minimax: fileTasksAdapter,
  dashscope: serviceTasksAdapter,
  anthropic: messagesAdapter,
  gemini: contentGenerationAdapter,
};

export function getAdapter(protocol: ProviderProtocol): ProviderAdapter {
  const adapter = ADAPTERS[protocol];
  if (!adapter) throw new Error(`未知的供应商协议：${protocol}`);
  return adapter;
}

export const SUPPORTED_PROTOCOLS: ProviderProtocol[] = Object.keys(ADAPTERS) as ProviderProtocol[];
