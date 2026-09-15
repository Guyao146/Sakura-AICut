import { anthropicAdapter } from './adapters/anthropic';
import { dashscopeAdapter } from './adapters/dashscope';
import { geminiAdapter } from './adapters/gemini';
import { klingAdapter } from './adapters/kling';
import { minimaxAdapter } from './adapters/minimax';
import { openAICompatibleAdapter } from './adapters/openai';
import { volcengineAdapter } from './adapters/volcengine';
import type { ProviderAdapter } from './types';
import type { ProviderProtocol } from '../types/provider';

/**
 * 适配器注册表（服务端使用；含 node:crypto 依赖，勿在客户端组件中引入）
 */
export const ADAPTERS: Record<ProviderProtocol, ProviderAdapter> = {
  openai: openAICompatibleAdapter,
  volcengine: volcengineAdapter,
  kling: klingAdapter,
  minimax: minimaxAdapter,
  dashscope: dashscopeAdapter,
  anthropic: anthropicAdapter,
  gemini: geminiAdapter,
};

export function getAdapter(protocol: ProviderProtocol): ProviderAdapter {
  const adapter = ADAPTERS[protocol];
  if (!adapter) throw new Error(`未知的供应商协议：${protocol}`);
  return adapter;
}

export const SUPPORTED_PROTOCOLS: ProviderProtocol[] = Object.keys(ADAPTERS) as ProviderProtocol[];
