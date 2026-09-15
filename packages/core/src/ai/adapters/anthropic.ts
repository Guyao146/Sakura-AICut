import { fetchJson } from '../../utils/http';
import type {
  AdapterContext,
  ImageGenerateRequest,
  ImageGenerateResult,
  ProbeResult,
  ProviderAdapter,
  TextGenerateRequest,
  TextGenerateResult,
} from '../types';
import { contextOptions, normalizeBaseUrl } from '../utils';

/**
 * Anthropic Claude 适配器（Messages API）
 * - POST /v1/messages
 * - Header: x-api-key + anthropic-version
 * - 图片理解：content 数组中带 base64 图片块
 */
function anthropicHeaders(ctx: AdapterContext): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
    'x-api-key': ctx.credentials.apiKey ?? '',
    ...(ctx.extraHeaders ?? {}),
  };
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  source?: { type: 'base64'; media_type: string; data: string };
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[];
  usage?: { input_tokens?: number; output_tokens?: number };
  model?: string;
  type?: string;
  error?: { message?: string };
}

function dataUriToBlock(uri: string): AnthropicContentBlock | null {
  const match = uri.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  if (!match) return null;
  return { type: 'image', source: { type: 'base64', media_type: match[1] ?? 'image/png', data: match[2] ?? '' } };
}

export const anthropicAdapter: ProviderAdapter = {
  protocol: 'anthropic',
  label: 'Anthropic Claude',

  async chat(ctx: AdapterContext, req: TextGenerateRequest): Promise<TextGenerateResult> {
    const systemMessages = req.messages.filter((m) => m.role === 'system').map((m) => m.content);
    const messages = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: [
          ...(m.images ?? []).map(dataUriToBlock).filter((b): b is AnthropicContentBlock => b !== null),
          { type: 'text', text: m.content },
        ],
      }));

    const payload = await fetchJson<AnthropicResponse>(
      `${normalizeBaseUrl(ctx.baseUrl)}/v1/messages`,
      {
        method: 'POST',
        headers: anthropicHeaders(ctx),
        body: JSON.stringify({
          model: req.model,
          max_tokens: req.maxTokens ?? 4096,
          system: systemMessages.length > 0 ? systemMessages.join('\n\n') : undefined,
          messages,
          temperature: req.temperature ?? 0.7,
          ...(req.json ? { tools: [] } : {}),
          ...(req.params ?? {}),
        }),
      },
      contextOptions(ctx),
    );
    if (payload?.error) throw new Error(`Claude 请求失败：${payload.error.message}`);

    const text = (payload?.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('');

    return {
      text,
      usage: payload?.usage
        ? { promptTokens: payload.usage.input_tokens, completionTokens: payload.usage.output_tokens }
        : undefined,
      model: payload?.model ?? req.model,
      raw: payload,
    };
  },

  async image(_ctx: AdapterContext, _req: ImageGenerateRequest): Promise<ImageGenerateResult> {
    throw new Error('Claude 暂不提供图片生成，请在「模型路由」中把图片能力指向其它供应商');
  },

  async probe(ctx: AdapterContext): Promise<ProbeResult> {
    const started = Date.now();
    try {
      const payload = await fetchJson<AnthropicResponse>(
        `${normalizeBaseUrl(ctx.baseUrl)}/v1/messages`,
        {
          method: 'POST',
          headers: anthropicHeaders(ctx),
          body: JSON.stringify({
            model: 'claude-3-5-haiku-latest',
            max_tokens: 1,
            messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }],
          }),
        },
        { ...contextOptions(ctx, 30_000), retries: 0 },
      );
      if (payload?.error) return { ok: false, message: payload.error.message ?? '鉴权失败', latencyMs: Date.now() - started };
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
