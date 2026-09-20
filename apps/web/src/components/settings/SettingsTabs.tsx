'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CAPABILITY_LABELS,
  PROMPT_CATEGORY_LABELS,
  PROTOCOL_LABELS,
  PROVIDER_PRESETS,
  findPreset,
  formatPricing,
  type Capability,
  type ModelEntry,
  type ProviderProtocol,
} from '@sakura/core';
import { Badge, Button, Card, Empty, Field, Input, Select, Textarea } from '@/components/ui';
import {
  deleteProviderAction,
  fetchProviderBalanceAction,
  probeProviderAction,
  pullProviderModelsAction,
  saveAppSettingsAction,
  saveModelRouteAction,
  saveProviderAction,
} from '@/app/actions/settings';
import { createCameraMoveAction, deleteCameraMoveAction } from '@/app/actions/production';
import { deletePromptTemplateAction, savePromptTemplateAction } from '@/app/actions/prompts';
import type { AppSettings } from '@sakura/db';
import type { SettingsData } from './SettingsClient';

/**
 * 设置页标签页：API 接入 / 模型路由 / 提示词库 / 运镜库 / 通用设置
 */

export interface ProviderRow {
  id: string;
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  enabled: boolean;
  models: ModelEntry[];
}

export interface ProviderFormState {
  id: string;
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKey: string;
  accessKey: string;
  secretKey: string;
  groupId: string;
  timeoutSec: number;
}

/* ============================ 模型路由 ============================ */

export function ModelsTab({ data }: { data: SettingsData }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState<Record<string, { providerId: string; modelId: string }>>(
    Object.fromEntries(
      data.routes.map((route) => [route.capability, { providerId: route.providerId, modelId: route.modelId }]),
    ),
  );

  const capabilities: Capability[] = ['text', 'image', 'video'];

  async function save(capability: Capability) {
    const pick = selection[capability];
    if (!pick?.providerId || !pick.modelId) return;
    setBusy(true);
    await saveModelRouteAction({ capability, providerId: pick.providerId, modelId: pick.modelId });
    router.refresh();
    setBusy(false);
  }

  return (
    <Card title="模型路由" extra={<span className="text-[11px] text-slate-500">文本 / 图片 / 视频分别指定供应商与模型</span>}>
      <div className="space-y-3">
        {capabilities.map((capability) => {
          const pick = selection[capability] ?? { providerId: '', modelId: '' };
          const provider = data.providers.find((item) => item.id === pick.providerId);
          const models = provider?.models.filter((model) => model.capability === capability) ?? [];
          return (
            <div key={capability} className="grid grid-cols-[110px_1fr_1fr_72px] items-end gap-2">
              <div className="pb-2 text-[12px] text-slate-300">{CAPABILITY_LABELS[capability]}</div>
              <Select
                value={pick.providerId}
                onChange={(event) =>
                  setSelection({ ...selection, [capability]: { providerId: event.target.value, modelId: '' } })
                }
              >
                <option value="">选择供应商…</option>
                {data.providers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
              <Select
                value={pick.modelId}
                onChange={(event) =>
                  setSelection({ ...selection, [capability]: { ...pick, modelId: event.target.value } })
                }
              >
                <option value="">选择模型…</option>
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label || model.id}
                  </option>
                ))}
              </Select>
              <Button variant="primary" loading={busy} onClick={() => void save(capability)}>
                保存
              </Button>
            </div>
          );
        })}
      </div>
      <div className="mt-3 text-[11px] leading-relaxed text-slate-500">
        提示：视频模型（可灵 / Seedance / 海螺 / 万相 / Sora）多为异步任务，系统会自动轮询；某供应商不支持的能力会被自动跳过并回退到其它供应商。
      </div>
    </Card>
  );
}

/* ============================ 通用设置 ============================ */

export function GeneralTab({ data }: { data: SettingsData }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(data.settings);

  return (
    <Card title="通用设置">
      <div className="grid gap-3 lg:grid-cols-2">
        <Field label="默认画幅">
          <Select
            value={settings.defaultAspectRatio}
            onChange={(event) => setSettings({ ...settings, defaultAspectRatio: event.target.value })}
          >
            {['9:16', '16:9', '1:1', '4:3', '3:4', '21:9'].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="默认目标时长（秒）">
          <Input
            type="number"
            value={settings.defaultTargetDurationSec}
            onChange={(event) => setSettings({ ...settings, defaultTargetDurationSec: Number(event.target.value) })}
          />
        </Field>
        <Field label="并发生成数量" hint="图片生成的并发上限">
          <Input
            type="number"
            min={1}
            max={8}
            value={settings.generationConcurrency}
            onChange={(event) => setSettings({ ...settings, generationConcurrency: Number(event.target.value) })}
          />
        </Field>
        <Field label="ffmpeg 路径" hint="Docker 镜像内即为 ffmpeg">
          <Input
            value={settings.ffmpegPath}
            onChange={(event) => setSettings({ ...settings, ffmpegPath: event.target.value })}
          />
        </Field>
      </div>
      <label className="mb-2 flex items-center gap-2 text-[12px] text-slate-400">
        <input
          type="checkbox"
          checked={settings.videoUseFirstFrame}
          onChange={(event) => setSettings({ ...settings, videoUseFirstFrame: event.target.checked })}
        />
        视频生成默认先生成首帧图（一致性更稳，成本更高）
      </label>
      <label className="mb-2 flex items-center gap-2 text-[12px] text-slate-400">
        <input
          type="checkbox"
          checked={settings.agentAutoApprove}
          onChange={(event) => setSettings({ ...settings, agentAutoApprove: event.target.checked })}
        />
        Agent 默认全自动执行（不逐步确认）
      </label>
      <label className="mb-3 flex items-center gap-2 text-[12px] text-slate-400">
        <input
          type="checkbox"
          checked={settings.keepRawResponse}
          onChange={(event) => setSettings({ ...settings, keepRawResponse: event.target.checked })}
        />
        保留供应商原始响应（调试用，占用更多存储）
      </label>
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            await saveAppSettingsAction(settings);
            setSaved(true);
            router.refresh();
            setBusy(false);
          }}
        >
          保存设置
        </Button>
        {saved ? <span className="text-[11px] text-emerald-300">已保存</span> : null}
      </div>
    </Card>
  );
}

export function CameraTab({ data }: { data: SettingsData }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ name: '', category: '特殊', description: '', prompt: '', usage: '' });

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
      <div className="space-y-2">
        {data.cameraMoves.length === 0 ? (
          <Empty text="暂无自定义运镜。内置运镜（固定 / 推拉 / 摇移 / 跟随 / 环绕 / 升降 / 特殊）已在第四步可直接选择。" />
        ) : (
          data.cameraMoves.map((move) => (
            <Card
              key={move.id}
              title={
                <span className="flex items-center gap-2">
                  {move.name}
                  <Badge tone="pink">自定义</Badge>
                  <Badge tone="default">{move.category}</Badge>
                </span>
              }
              extra={
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await deleteCameraMoveAction(null, move.id);
                    router.refresh();
                  }}
                >
                  删除
                </Button>
              }
            >
              <div className="text-[11px] text-slate-500">{move.description}</div>
              <div className="mt-2 rounded bg-black/30 p-2 text-[11px] text-slate-400">{move.prompt}</div>
            </Card>
          ))
        )}
      </div>

      <Card title="新建自定义运镜">
        <Field label="名称">
          <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </Field>
        <Field label="分类">
          <Select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>
            {['推拉', '摇移', '跟随', '环绕', '升降', '特殊', '固定'].map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="说明">
          <Input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
        </Field>
        <Field label="英文运镜提示词" hint="例如 slow dolly in toward the face, smooth stabilized">
          <Textarea rows={3} value={draft.prompt} onChange={(event) => setDraft({ ...draft, prompt: event.target.value })} />
        </Field>
        <Field label="推荐场景">
          <Input value={draft.usage} onChange={(event) => setDraft({ ...draft, usage: event.target.value })} />
        </Field>
        <Button
          variant="primary"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            await createCameraMoveAction(null, draft);
            setDraft({ name: '', category: '特殊', description: '', prompt: '', usage: '' });
            router.refresh();
            setBusy(false);
          }}
        >
          保存运镜模板
        </Button>
      </Card>
    </div>
  );
}


export function PromptsTab({ data }: { data: SettingsData }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ name: '', category: 'screenplay', description: '', template: '' });

  const list = data.prompts.filter((prompt) =>
    query ? prompt.name.includes(query) || prompt.description.includes(query) || prompt.template.includes(query) : true,
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
      <div className="space-y-2">
        <Input value={query} placeholder="搜索模板…" onChange={(event) => setQuery(event.target.value)} />
        {list.length === 0 ? (
          <Empty text="没有匹配的模板。" />
        ) : (
          list.map((prompt) => (
            <Card
              key={prompt.id}
              title={
                <span className="flex items-center gap-2">
                  {prompt.name}
                  <Badge tone={prompt.source === 'builtin' ? 'blue' : 'pink'}>
                    {prompt.source === 'builtin' ? '内置' : '自定义'}
                  </Badge>
                  <Badge tone="default">用 {prompt.useCount} 次</Badge>
                </span>
              }
              extra={
                prompt.source === 'custom' ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await deletePromptTemplateAction(prompt.id);
                      router.refresh();
                    }}
                  >
                    删除
                  </Button>
                ) : (
                  <span className="text-[11px] text-slate-500">内置模板</span>
                )
              }
            >
              <div className="text-[11px] text-slate-500">{prompt.description}</div>
              <div className="mt-2 max-h-[120px] overflow-y-auto whitespace-pre-wrap rounded bg-black/30 p-2 text-[11px] text-slate-400">
                {prompt.template}
              </div>
              <div className="mt-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setDraft({
                      name: `${prompt.name}（副本）`,
                      category: prompt.category,
                      description: prompt.description,
                      template: prompt.template,
                    })
                  }
                >
                  复制到编辑器
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>

      <Card title="新建模板">
        <Field label="模板名称">
          <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </Field>
        <Field label="分类">
          <Select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>
            {Object.entries(PROMPT_CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="用途说明">
          <Input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
        </Field>
        <Field label="模板内容" hint="支持 {{变量}} 与 {{#if 变量}}…{{/if}}">
          <Textarea
            rows={10}
            value={draft.template}
            onChange={(event) => setDraft({ ...draft, template: event.target.value })}
          />
        </Field>
        <Button
          variant="primary"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            await savePromptTemplateAction({
              name: draft.name,
              category: draft.category as never,
              description: draft.description,
              template: draft.template,
            });
            setDraft({ name: '', category: 'screenplay', description: '', template: '' });
            router.refresh();
            setBusy(false);
          }}
        >
          保存为新模板
        </Button>
      </Card>
    </div>
  );
}


export function ProvidersTab({ data }: { data: SettingsData }) {
  const router = useRouter();
  const [presetKey, setPresetKey] = useState('');
  const [modelsText, setModelsText] = useState('gpt-4o:text\ngpt-image-1:image\nsora-2:video');
  const [busy, setBusy] = useState(false);
  const [probe, setProbe] = useState<Record<string, string>>({});
  const [balance, setBalance] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<ProviderFormState>({
    id: '',
    name: '',
    protocol: 'openai',
    baseUrl: '',
    apiKey: '',
    accessKey: '',
    secretKey: '',
    groupId: '',
    timeoutSec: 300,
  });

  function applyPreset(key: string) {
    setPresetKey(key);
    const preset = findPreset(key);
    if (!preset) return;
    setForm({ ...form, id: '', name: preset.label, protocol: preset.protocol, baseUrl: preset.baseUrl });
    setModelsText(preset.defaultModels.map((model) => `${model.id}:${model.capability}`).join('\n'));
  }

  async function save() {
    setBusy(true);
    setError(null);
    const models = modelsText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [id, capability] = line.split(':');
        return { id: id ?? '', label: id ?? '', capability: (capability ?? 'text') as Capability, mode: 'sync' as const };
      });
    const result = await saveProviderAction({
      id: form.id || undefined,
      name: form.name,
      protocol: form.protocol,
      baseUrl: form.baseUrl,
      credentials: {
        ...(form.apiKey ? { apiKey: form.apiKey } : {}),
        ...(form.accessKey ? { accessKey: form.accessKey } : {}),
        ...(form.secretKey ? { secretKey: form.secretKey } : {}),
        ...(form.groupId ? { groupId: form.groupId } : {}),
      },
      models,
      timeoutSec: form.timeoutSec,
    });
    if (!result.ok) setError(result.error ?? '保存失败');
    else {
      setForm({ ...form, id: '', apiKey: '', accessKey: '', secretKey: '' });
      router.refresh();
    }
    setBusy(false);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
      <div className="space-y-3">
        {data.providers.length === 0 ? (
          <Empty text="还没有接入模型供应商。右侧选择预设（NewAPI / OneAPI / 火山引擎 …）一键填入地址与模型。" />
        ) : (
          data.providers.map((provider) => (
            <ProviderCardView
              key={provider.id}
              provider={provider}
              probeText={probe[provider.id] ?? ''}
              balanceText={balance[provider.id] ?? ''}
              onProbe={async () => {
                setProbe({ ...probe, [provider.id]: '检测中…' });
                const result = await probeProviderAction(provider.id);
                setProbe({
                  ...probe,
                  [provider.id]:
                    result.ok && result.data?.ok
                      ? `✅ ${result.data.message}`
                      : `❌ ${(result.ok ? result.data?.message : result.error) ?? '失败'}`,
                });
              }}
              onPullModels={async () => {
                setProbe({ ...probe, [provider.id]: '拉取模型中…' });
                const result = await pullProviderModelsAction(provider.id);
                if (result.ok && result.data) {
                  const list = result.data;
                  if (list.length === 0) {
                    setProbe({ ...probe, [provider.id]: '⚠️ 该供应商未返回任何模型' });
                    return;
                  }
                  // 填入编辑表单，默认按名称猜测能力，用户可微调后保存
                  const guess = (id: string): Capability => {
                    const s = id.toLowerCase();
                    if (/sora|video|cogvideo|kling|seedance|wan|vidu|ltx|veo/.test(s)) return 'video';
                    if (/image|dall|seedream|flux|sd|stable|gpt-image|imagen/.test(s)) return 'image';
                    if (/tts|speech|audio|voice|music|cosyvoice/.test(s)) return 'audio';
                    return 'text';
                  };
                  setForm({ ...form, id: provider.id, name: provider.name, protocol: provider.protocol, baseUrl: provider.baseUrl });
                  setModelsText(list.map((id) => `${id}:${guess(id)}`).join('\n'));
                  setProbe({ ...probe, [provider.id]: `✅ 已拉取 ${list.length} 个模型，可在右侧表单中核对能力后保存` });
                } else {
                  setProbe({ ...probe, [provider.id]: `❌ ${result.error ?? '拉取失败'}` });
                }
              }}
              onBalance={async () => {
                setBalance({ ...balance, [provider.id]: '查询中…' });
                const result = await fetchProviderBalanceAction(provider.id);
                if (result.ok && result.data) {
                  setBalance({
                    ...balance,
                    [provider.id]: result.data.supported ? `💰 ${result.data.detail}` : `🚫 ${result.data.detail}`,
                  });
                } else {
                  setBalance({ ...balance, [provider.id]: `❌ ${result.error ?? '查询失败'}` });
                }
              }}
              onEdit={() => {
                setForm({
                  ...form,
                  id: provider.id,
                  name: provider.name,
                  protocol: provider.protocol,
                  baseUrl: provider.baseUrl,
                });
                setModelsText(provider.models.map((model) => `${model.id}:${model.capability}`).join('\n'));
              }}
              onDelete={async () => {
                await deleteProviderAction(provider.id);
                router.refresh();
              }}
            />
          ))
        )}
      </div>
      <ProviderFormView
        form={form}
        setForm={setForm}
        presetKey={presetKey}
        applyPreset={applyPreset}
        modelsText={modelsText}
        setModelsText={setModelsText}
        save={save}
        busy={busy}
        error={error}
      />
    </div>
  );
}

/** 供应商卡片 */
function ProviderCardView({
  provider,
  probeText,
  balanceText,
  onProbe,
  onPullModels,
  onBalance,
  onEdit,
  onDelete,
}: {
  provider: ProviderRow;
  probeText: string;
  balanceText: string;
  onProbe: () => void;
  onPullModels: () => void;
  onBalance: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {provider.name}
          <Badge tone={provider.enabled ? 'green' : 'default'}>{provider.enabled ? '启用' : '停用'}</Badge>
          <Badge tone="blue">{provider.protocol}</Badge>
        </span>
      }
      extra={
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" onClick={onProbe}>
            连通检测
          </Button>
          <Button size="sm" variant="ghost" onClick={onPullModels} title="从供应商接口拉取可用模型，填入右侧表单">
            拉取模型
          </Button>
          <Button size="sm" variant="ghost" onClick={onBalance} title="查询剩余额度（仅部分供应商支持）">
            余额
          </Button>
          <Button size="sm" variant="ghost" onClick={onEdit}>
            编辑
          </Button>
          <Button size="sm" variant="ghost" onClick={onDelete}>
            删除
          </Button>
        </div>
      }
    >
      <div className="text-[11px] text-slate-500">{provider.baseUrl}</div>
      <div className="mt-2 flex flex-wrap gap-1">
        {provider.models.length === 0 ? (
          <span className="text-[11px] text-slate-600">尚未配置模型，点击「拉取模型」一键获取</span>
        ) : (
          provider.models.map((model) => {
            const price = formatPricing(model.pricing);
            return (
              <span
                key={model.id}
                className="inline-flex items-center gap-1 rounded-full border border-[#2b3240] bg-[#12151c] px-2 py-0.5 text-[10px] text-slate-300"
                title={model.label}
              >
                <span className="text-slate-400">{model.id}</span>
                <span className="text-slate-600">·</span>
                <span>{CAPABILITY_LABELS[model.capability] ?? model.capability}</span>
                {price ? <span className="font-medium text-amber-300/90">{price}</span> : null}
              </span>
            );
          })
        )}
      </div>
      {probeText ? <div className="mt-2 text-[11px] text-slate-400">{probeText}</div> : null}
      {balanceText ? <div className="mt-1 text-[11px] text-amber-300/90">{balanceText}</div> : null}
    </Card>
  );
}

/** 供应商表单 */
function ProviderFormView({
  form,
  setForm,
  presetKey,
  applyPreset,
  modelsText,
  setModelsText,
  save,
  busy,
  error,
}: {
  form: ProviderFormState;
  setForm: (value: ProviderFormState) => void;
  presetKey: string;
  applyPreset: (key: string) => void;
  modelsText: string;
  setModelsText: (value: string) => void;
  save: () => void;
  busy: boolean;
  error: string | null;
}) {
  return (
    <Card title={form.id ? '编辑供应商' : '添加供应商'}>
      <Field label="从预设快速添加">
        <Select value={presetKey} onChange={(event) => applyPreset(event.target.value)}>
          <option value="">请选择…</option>
          {PROVIDER_PRESETS.map((preset) => (
            <option key={preset.key} value={preset.key}>
              {preset.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="显示名称">
        <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
      </Field>
      <Field label="协议">
        <Select
          value={form.protocol}
          onChange={(event) => setForm({ ...form, protocol: event.target.value as ProviderProtocol })}
        >
          {Object.entries(PROTOCOL_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="接口根地址">
        <Input value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} />
      </Field>
      <Field label="API Key" hint="留空表示不修改">
        <Input type="password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="AccessKey（可灵）">
          <Input value={form.accessKey} onChange={(event) => setForm({ ...form, accessKey: event.target.value })} />
        </Field>
        <Field label="SecretKey（可灵）">
          <Input
            type="password"
            value={form.secretKey}
            onChange={(event) => setForm({ ...form, secretKey: event.target.value })}
          />
        </Field>
      </div>
      <Field label="GroupId（MiniMax 可选）">
        <Input value={form.groupId} onChange={(event) => setForm({ ...form, groupId: event.target.value })} />
      </Field>
      <Field label="模型列表" hint="每行一个：模型ID:能力（text/image/video/audio）">
        <Textarea rows={5} value={modelsText} onChange={(event) => setModelsText(event.target.value)} />
      </Field>
      {error ? <div className="mb-2 text-[11px] text-red-300">{error}</div> : null}
      <div className="flex gap-2">
        <Button variant="primary" loading={busy} onClick={save}>
          保存供应商
        </Button>
        {form.id ? (
          <Button variant="ghost" onClick={() => setForm({ ...form, id: '' })}>
            取消编辑
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

