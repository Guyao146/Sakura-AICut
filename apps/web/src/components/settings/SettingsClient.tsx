'use client';

import { useState } from 'react';
import clsx from 'clsx';
import type { AppSettings } from '@sakura/db';
import type { OidcProviderKind } from '@sakura/db';
import type { Capability, ModelEntry, ProviderProtocol } from '@sakura/core';
import { AboutTab, CameraTab, GeneralTab, ModelsTab, OidcTab, PromptsTab, ProvidersTab } from './SettingsTabs';

/**
 * 设置区：API 接入 / 模型路由 / 提示词库 / 运镜库 / 第三方登录 / 通用设置 / 关于我们
 */

export interface SettingsData {
  providers: Array<{
    id: string;
    name: string;
    protocol: ProviderProtocol;
    baseUrl: string;
    enabled: boolean;
    models: ModelEntry[];
    remark?: string | null;
  }>;
  routes: Array<{ capability: Capability; providerId: string; modelId: string }>;
  prompts: Array<{ id: string; source: string; name: string; category: string; description: string; template: string; useCount: number }>;
  cameraMoves: Array<{ id: string; name: string; category: string; prompt: string; description: string }>;
  oidcProviders: Array<{
    id: string;
    name: string;
    kind: OidcProviderKind;
    issuer: string;
    clientId: string;
    hasSecret: boolean;
    scope: string;
    enabled: boolean;
    label: string;
  }>;
  settings: AppSettings;
  initialTab: string;
}

const TABS = [
  { key: 'providers', label: 'API 接入' },
  { key: 'models', label: '模型路由' },
  { key: 'prompts', label: '提示词库' },
  { key: 'camera', label: '运镜库' },
  { key: 'oidc', label: '第三方登录' },
  { key: 'general', label: '通用设置' },
  { key: 'about', label: '关于我们' },
];

export function SettingsClient({ data }: { data: SettingsData }) {
  const [tab, setTab] = useState(TABS.some((item) => item.key === data.initialTab) ? data.initialTab : 'providers');
  return (
    <div className="mx-auto grid w-full max-w-[1600px] items-start gap-6 p-4 sm:p-6 lg:p-8 xl:grid-cols-[168px_minmax(0,1fr)]">
      <nav aria-label="设置分类" className="surface-card flex min-w-0 gap-1.5 overflow-x-auto rounded-xl border border-ink-600 bg-ink-800 p-2 xl:sticky xl:top-6 xl:flex-col">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            aria-pressed={tab === item.key}
            aria-controls="settings-content"
            className={clsx(
              'choice-chip shrink-0 rounded-lg border px-3 py-2.5 text-left text-xs',
              tab === item.key ? 'border-pink-400/30 bg-pink-500/10 text-pink-200' : 'border-transparent text-slate-400 hover:bg-white/5',
            )}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <section key={tab} id="settings-content" aria-label={TABS.find((item) => item.key === tab)?.label} className="panel-enter min-w-0 space-y-4">
        {tab === 'providers' && <ProvidersTab data={data} />}
        {tab === 'models' && <ModelsTab data={data} />}
        {tab === 'prompts' && <PromptsTab data={data} />}
        {tab === 'camera' && <CameraTab data={data} />}
        {tab === 'oidc' && <OidcTab data={data} />}
        {tab === 'general' && <GeneralTab data={data} />}
        {tab === 'about' && <AboutTab />}
      </section>
    </div>
  );
}
