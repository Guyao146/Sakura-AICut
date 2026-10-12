import { z } from 'zod';
import type { ModelEntry, ProviderConfig, ProviderProtocol } from '@sakura/core';
import { createProvider, getProvider, listModelRoutes, listProviders, transaction, updateProvider } from '@sakura/db';
import { fetchAuthorizedConfig, loadAuthorization } from './gateway-oauth';
import type { GatewayConnectInput, GatewayConnectionSummary, GatewaySyncResult } from '../gateway';
import { GatewayError, normalizeGatewayUrl, requestGatewayJson } from './gateway-http';

const GATEWAY_PROTOCOL: ProviderProtocol = 'openai';
const secret = z.string().min(1).max(4096).regex(/^[\x21-\x7e]+$/);
const inputSchema = z.object({
  providerId: z.string().min(1).max(100).optional(),
  baseUrl: z.string().min(1).max(2048),
  apiKey: z.string().trim().max(4096),
  name: z.string().trim().max(100).optional(),
  allowPrivateNetwork: z.boolean(),
  renewAuthorization: z.boolean().optional(),
});
const configSchema = z.object({
  verified: z.literal(true),
  gateway: z.object({ service: z.literal('sakura-ai-gateway'), version: z.string().min(1).max(64) }),
  apiKey: z.object({
    id: z.string().min(1).max(200),
    name: z.string().max(200).optional().default(''),
    modelAccessMode: z.string().min(1).max(64),
  }),
  endpoints: z.object({
    openai: z.object({ models: z.literal('/v1/models'), chat: z.literal('/v1/chat/completions') }),
  }),
  models: z.array(z.object({
    id: z.string().min(1).max(512).regex(/^[^\u0000-\u001f\u007f]+$/),
    supportsThinking: z.boolean().nullable().optional().default(null),
    thinkingLevels: z.array(z.string().max(64)).max(32).optional().default([]),
  })).max(5000),
  authorization: z.object({ id: z.string().min(1).max(200), status: z.literal('active'), token: secret.optional() }).optional(),
});

type GatewayConfig = z.infer<typeof configSchema>;
const pending = new Set<string>();

function parseConfig(payload: unknown): GatewayConfig {
  const parsed = configSchema.safeParse(payload);
  if (!parsed.success) throw new GatewayError('网关配置格式不兼容，或未提供受支持的文本对话接口');
  return parsed.data;
}

function isGateway(provider: ProviderConfig): boolean {
  return Boolean(provider.credentials?.gatewayBaseUrl && provider.credentials.gatewayToken);
}

function summary(provider: ProviderConfig): GatewayConnectionSummary {
  const credentials = provider.credentials ?? {};
  return {
    providerId: provider.id,
    name: provider.name,
    baseUrl: credentials.gatewayBaseUrl ?? provider.baseUrl,
    keyName: credentials.gatewayKeyName ?? '',
    modelAccessMode: credentials.gatewayAccessMode ?? '',
    gatewayVersion: credentials.gatewayVersion ?? '',
    modelCount: provider.models.length,
    syncedAt: credentials.gatewaySyncedAt ?? '',
    allowPrivateNetwork: credentials.gatewayAllowPrivateNetwork === 'true',
  };
}

export function listGatewayConnections(): GatewayConnectionSummary[] {
  return listProviders().filter(isGateway).map(summary);
}

function gatewayProvider(id: string): ProviderConfig {
  const provider = getProvider(id);
  if (!provider || !isGateway(provider)) throw new GatewayError('网关接入不存在，请刷新设置页');
  if (provider.baseUrl !== provider.credentials?.gatewayBaseUrl || provider.protocol !== GATEWAY_PROTOCOL) {
    throw new GatewayError('网关接口配置已被修改，请删除该接入后重新连接');
  }
  return provider;
}

async function exclusive<T>(baseUrl: string, operation: () => Promise<T>): Promise<T> {
  if (pending.has(baseUrl)) throw new GatewayError('该网关正在验证或同步，请稍后再试');
  pending.add(baseUrl);
  try { return await operation(); }
  finally { pending.delete(baseUrl); }
}

function saveConfig(options: {
  existing?: ProviderConfig;
  baseUrl: string;
  apiKey: string;
  token: string;
  authorizationId: string;
  allowPrivateNetwork: boolean;
  name?: string;
  config: GatewayConfig;
}): GatewaySyncResult {
  const { existing, config, baseUrl } = options;
  return transaction(() => {
    const current = existing ? gatewayProvider(existing.id) : undefined;
    if (current && (current.credentials?.gatewayToken !== existing?.credentials?.gatewayToken
      || current.credentials?.apiKey !== existing?.credentials?.apiKey)) {
      throw new GatewayError('网关凭据已在其他请求中更新，请重新验证');
    }
    const previousModels = new Map(current?.models.map((model) => [model.id, model]));
    const uniqueModels = new Map(config.models.map((model) => [model.id, model]));
    const models: ModelEntry[] = [...uniqueModels.values()].map((model) => ({
      ...previousModels.get(model.id),
      id: model.id,
      label: previousModels.get(model.id)?.label ?? model.id,
      // 接入协议仅声明文本端点，不根据名字猜测图片或视频生成能力。
      capability: 'text',
      mode: 'sync',
      supportsThinking: model.supportsThinking,
      thinkingLevels: model.thinkingLevels,
    }));
    const credentials = {
      apiKey: options.apiKey,
      gatewayBaseUrl: baseUrl,
      gatewayToken: options.token,
      gatewayAuthorizationId: options.authorizationId,
      gatewayKeyId: config.apiKey.id,
      gatewayKeyName: config.apiKey.name,
      gatewayAccessMode: config.apiKey.modelAccessMode,
      gatewayVersion: config.gateway.version,
      gatewaySyncedAt: new Date().toISOString(),
      gatewayAllowPrivateNetwork: String(options.allowPrivateNetwork),
    };
    const fields = { name: options.name || current?.name || '网关接入', protocol: GATEWAY_PROTOCOL, baseUrl, credentials, models };
    const provider = current ? updateProvider(current.id, fields) : createProvider(fields);
    const warning = models.length === 0
      ? '凭据验证成功，但此 Key 当前没有可用模型；请在网关授予模型权限或发布模型后刷新配置。'
      : listModelRoutes().some((route) => route.providerId === provider.id && !models.some((model) => model.id === route.modelId))
        ? '已同步权限；原模型路由中的部分模型已不可用，请到「模型路由」重新选择。'
        : undefined;
    return { connection: summary(provider), created: !current, ...(warning ? { warning } : {}) };
  });
}

export async function connectGateway(input: GatewayConnectInput): Promise<GatewaySyncResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new GatewayError('请检查网关网址、调用 Key 和接入名称');
  const values = parsed.data;
  const baseUrl = normalizeGatewayUrl(values.baseUrl);
  return exclusive(baseUrl, async () => {
    let existing = values.providerId ? gatewayProvider(values.providerId) : undefined;
    if (existing && existing.credentials?.gatewayBaseUrl !== baseUrl) {
      throw new GatewayError('已有接入不能更换网关网址；请新增接入，避免向其他站点发送已保存的凭据');
    }
    const apiKey = values.apiKey || existing?.credentials?.apiKey || '';
    if (!secret.safeParse(apiKey).success) throw new GatewayError('请填写网关本地调用 Key，不能使用本站密码或接入令牌');
    // 重复提交相同地址与调用 Key 时复用已有授权，避免生成重复供应商。
    existing ??= listProviders().find((provider) => isGateway(provider)
      && provider.credentials?.gatewayBaseUrl === baseUrl && provider.credentials.apiKey === apiKey);
    const savedToken = existing?.credentials?.gatewayToken;
    const authorization = values.renewAuthorization ? undefined : savedToken;
    const config = parseConfig(await requestGatewayJson(baseUrl, '/api/integration/verify', {
      allowPrivateNetwork: values.allowPrivateNetwork,
      body: { apiKey, label: `Sakura AI Cut${values.name ? ` · ${values.name}` : ''}`, ...(authorization ? { authorization } : {}) },
    }));
    const token = config.authorization?.token ?? authorization;
    if (!config.authorization || !token) throw new GatewayError('网关未返回有效的接入令牌，未保存配置');
    return saveConfig({ existing, baseUrl, apiKey, token, authorizationId: config.authorization.id,
      allowPrivateNetwork: values.allowPrivateNetwork, name: values.name, config });
  });
}

export async function refreshGateway(providerId: string): Promise<GatewaySyncResult> {
  const provider = gatewayProvider(providerId);
  const credentials = provider.credentials!;
  const baseUrl = credentials.gatewayBaseUrl!;
  return exclusive(baseUrl, async () => {
    // 接入令牌或账号授权撤销后必须停止配置同步；既不能用底层调用 Key 绕过撤销，
    // 也不能在授权失效时直接读取网关上的其他账号信息。
    let token = credentials.gatewayToken;
    let allowPrivateNetwork = credentials.gatewayAllowPrivateNetwork === 'true';
    const authorization = loadAuthorization();
    if (authorization?.gatewayUrl === baseUrl) {
      const authenticated = await fetchAuthorizedConfig();
      token = authenticated.token;
      allowPrivateNetwork = true;
    }
    const config = parseConfig(await requestGatewayJson(baseUrl, '/api/integration/config', {
      allowPrivateNetwork, token,
    }));
    if (config.apiKey.id !== credentials.gatewayKeyId) {
      throw new GatewayError('网关授权对应的调用 Key 已变化，请重新验证并填写当前调用 Key');
    }
    return saveConfig({ existing: provider, baseUrl, apiKey: credentials.apiKey!, token: credentials.gatewayToken!,
      authorizationId: credentials.gatewayAuthorizationId!, allowPrivateNetwork: credentials.gatewayAllowPrivateNetwork === 'true', config });
  });
}

/** 账号授权通过后，把网关配置同步到供应商记录；不保存来源 Key 明文。 */
export async function connectGatewayByAuthorization(): Promise<GatewaySyncResult> {
  const authenticated = await fetchAuthorizedConfig();
  return exclusive(authenticated.gatewayUrl, async () => {
    const config = parseConfig(await requestGatewayJson(authenticated.gatewayUrl, '/api/integration/config', {
      allowPrivateNetwork: true,
      token: authenticated.token,
    }));
    const existing = listProviders().find((provider) => isGateway(provider) && provider.credentials?.gatewayBaseUrl === authenticated.gatewayUrl);
    return saveConfig({
      existing,
      baseUrl: authenticated.gatewayUrl,
      apiKey: `oauth:${config.apiKey.id}`,
      token: loadAuthorization()?.accessToken ?? '',
      authorizationId: `oauth:${config.apiKey.id}`,
      allowPrivateNetwork: true,
      name: existing?.name,
      config,
    });
  });
}