import { listModelRoutes, listProviders } from '@sakura/db';

/**
 * 服务端可用的模型路由摘要（用于界面提示「文本/图片/视频分别走哪个模型」）
 */
export function connectedRoutesSummary() {
  const providers = listProviders({ maskCredentials: true });
  return {
    providers: providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
      enabled: provider.enabled,
      models: provider.models.map((model) => ({ id: model.id, label: model.label, capability: model.capability })),
    })),
    routes: listModelRoutes().map((route) => ({
      capability: route.capability,
      providerId: route.providerId,
      providerName: providers.find((p) => p.id === route.providerId)?.name ?? '（已删除）',
      modelId: route.modelId,
    })),
  };
}

export type RoutesSummary = ReturnType<typeof connectedRoutesSummary>;
