'use client';

import { useState } from 'react';
import clsx from 'clsx';
import type { AppSettings } from '@sakura/db';
import type { Capability, ProviderProtocol } from '@sakura/core';
import { CameraTab, GeneralTab, ModelsTab, PromptsTab, ProvidersTab } from './SettingsTabs';

/**
 * 设置区：API 接入 / 模型路由 / 提示词库 / 运镜库 / 通用设置
 */

export interface SettingsData {
  providers: Array<{
    id: string;
    name: string;
    protocol: ProviderProtocol;
    baseUrl: string;
    enabled: boolean;
    models: Array<{ id: string; label: string; capability: Capability }>;
    remark?: string | null;
  }>;
  routes: Array<{ capability: Capability; providerId: string; modelId: string }>;
  prompts: Array<{ id: string; source: string; name: string; category: string; description: string; template: string; useCount: number }>;
  cameraMoves: Array<{ id: string; name: string; category: string; prompt: string; description: string }>;
  settings: AppSettings;
  initialTab: string;
}

const TABS = [
  { key: 'providers', label: 'API 接入' },
  { key: 'models', label: '模型路由' },
  { key: 'prompts', label: '提示词库' },
  { key: 'camera', label: '运镜库' },
  { key: 'general', label: '通用设置' },
];

export function SettingsClient({ data }: { data: SettingsData }) {
  const [tab, setTab] = useState(data.initialTab);
  return (
    <div className="p-6">
      <div className="mb-4 flex gap-1.5">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={clsx(
              'rounded-lg border px-3 py-1.5 text-[12px]',
              tab === item.key ? 'border-pink-400/40 bg-pink-500/10 text-pink-200' : 'border-[#2b2436] text-slate-400',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'providers' && <ProvidersTab data={data} />}
      {tab === 'models' && <ModelsTab data={data} />}
      {tab === 'prompts' && <PromptsTab data={data} />}
      {tab === 'camera' && <CameraTab data={data} />}
      {tab === 'general' && <GeneralTab data={data} />}
    </div>
  );
}
