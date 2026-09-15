import { bootstrap, getAppSettings, listCustomCameraMoves, listPromptTemplates } from '@sakura/db';
import { AppShell, PageHeader } from '@/components/AppShell';
import { SettingsClient } from '@/components/settings/SettingsClient';
import { connectedRoutesSummary } from '@/lib/server/ai';

/**
 * 设置页：API 接入 / 模型路由 / 提示词库 / 运镜库 / 通用设置
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
    <AppShell active={tab ?? 'providers'}>
      <PageHeader
        title="设置"
        subtitle="接入模型供应商（NewAPI / OneAPI / 火山引擎 / 可灵 / MiniMax / 百炼 …）、配置能力路由、管理提示词与运镜模板"
      />
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
          settings: getAppSettings(),
          initialTab: tab ?? 'providers',
        }}
      />
    </AppShell>
  );
}
