import { bootstrap, getAppSettings, listCustomCameraMoves, listOidcProviders, listPromptTemplates } from '@sakura/db';
import { AppShell } from '@/components/AppShell';
import { SettingsClient } from '@/components/settings/SettingsClient';
import { connectedRoutesSummary } from '@/lib/server/ai';

/**
 * 设置页：API 接入 / 模型路由 / 提示词库 / 运镜库 / 通用设置 / 关于我们
 * 所有全局设置集中在此，不在主导航铺开。
 */
export const dynamic = 'force-dynamic';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  bootstrap();
  const { tab } = await searchParams;
  const summary = connectedRoutesSummary();

  return (
    <AppShell>
      <SettingsClient
        data={{
          providers: summary.providers.map((provider) => ({
            id: provider.id,
            name: provider.name,
            protocol: provider.protocol,
            baseUrl: provider.baseUrl,
            enabled: provider.enabled,
            models: provider.models,
          })),
          routes: summary.routes.map((route) => ({
            capability: route.capability,
            providerId: route.providerId,
            modelId: route.modelId,
          })),
          prompts: listPromptTemplates().map((template) => ({
            id: template.id,
            source: template.source,
            name: template.name,
            category: template.category,
            description: template.description,
            template: template.template,
            useCount: template.useCount,
          })),
          cameraMoves: listCustomCameraMoves().map((move) => ({
            id: move.id,
            name: move.name,
            category: move.category,
            prompt: move.prompt,
            description: move.description,
          })),
          oidcProviders: listOidcProviders().map((provider) => ({
            id: provider.id,
            name: provider.name,
            kind: provider.kind,
            issuer: provider.issuer,
            clientId: provider.clientId,
            hasSecret: provider.hasSecret,
            scope: provider.scope,
            enabled: provider.enabled,
            label: provider.label,
          })),
          settings: getAppSettings(),
          initialTab: tab ?? 'providers',
        }}
      />
    </AppShell>
  );
}
