'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  APP_VERSION,
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
import { changePasswordAction } from '@/app/actions/auth';
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
        提示：视频生成通常为异步任务，系统会自动轮询；某供应商不支持的能力会被自动跳过并回退到其它供应商。
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
    <div className="space-y-4">
      <Card title="账户与登录">
        <div className="mb-3 text-[12px] text-slate-400">
          单用户本地账户，密码以 scrypt 哈希存储。修改密码后需重新登录。
        </div>
        <ChangePasswordForm />
      </Card>

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
    </div>
  );
}

/** 修改管理员密码：需校验旧密码 */
function ChangePasswordForm() {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (newPassword !== confirm) {
      setMessage({ tone: 'err', text: '两次输入的新密码不一致' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await changePasswordAction(oldPassword, newPassword);
      setMessage(
        result.ok
          ? { tone: 'ok', text: '密码已更新，其他设备的会话已失效，请重新登录' }
          : { tone: 'err', text: result.error ?? '修改失败' },
      );
      if (result.ok) {
        setOldPassword('');
        setNewPassword('');
        setConfirm('');
      }
    } catch (cause) {
      setMessage({ tone: 'err', text: cause instanceof Error ? cause.message : '网络错误' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-3 lg:grid-cols-3">
      <Field label="当前密码">
        <Input
          type="password"
          autoComplete="current-password"
          value={oldPassword}
          onChange={(event) => setOldPassword(event.target.value)}
        />
      </Field>
      <Field label="新密码" hint="至少 8 位">
        <Input
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
        />
      </Field>
      <Field label="确认新密码">
        <Input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
        />
      </Field>
      <div className="flex items-center gap-2 lg:col-span-3">
        <Button variant="default" type="submit" loading={busy}>
          更新密码
        </Button>
        {message ? (
          <span className={`text-[11px] ${message.tone === 'ok' ? 'text-emerald-300' : 'text-red-300'}`}>
            {message.text}
          </span>
        ) : null}
      </div>
    </form>
  );
}

export { OidcTab } from './OidcTab';

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
  const [modelsText, setModelsText] = useState('');
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
          <Empty text="还没有接入模型服务。请在右侧选择协议模板，并填写接口地址与实际模型 ID。" />
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
      <Field label="从协议模板添加">
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
        <Field label="AccessKey（签名鉴权）">
          <Input value={form.accessKey} onChange={(event) => setForm({ ...form, accessKey: event.target.value })} />
        </Field>
        <Field label="SecretKey（签名鉴权）">
          <Input
            type="password"
            value={form.secretKey}
            onChange={(event) => setForm({ ...form, secretKey: event.target.value })}
          />
        </Field>
      </div>
      <Field label="GroupId（按接口要求填写）">
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

/* ============================ 关于我们 ============================ */

const REPO_URL = 'https://github.com/Guyao146/Sakura-AICut';
/** GitHub Releases 最新版本接口：仅读取最新 Release 的版本号，用于更新提示 */
const LATEST_RELEASE_API = 'https://api.github.com/repos/Guyao146/Sakura-AICut/releases/latest';

type Semver = [number, number, number];

function parseSemver(version: string): Semver | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compareSemver(a: Semver, b: Semver): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

type UpdateState =
  | { status: 'checking' }
  | { status: 'latest' }
  | { status: 'available'; tag: string; url: string }
  | { status: 'error' };

/**
 * 版本更新检查：对比 GitHub Releases 最新版本与 APP_VERSION。
 * 只做提示，不强制更新；检查失败（离线 / 限流）静默降级为可重试的错误文案。
 */
function UpdateChecker() {
  const [state, setState] = useState<UpdateState>({ status: 'checking' });

  const check = useCallback(async () => {
    setState({ status: 'checking' });
    try {
      const response = await fetch(LATEST_RELEASE_API, {
        headers: { accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const release = (await response.json()) as { tag_name?: unknown; html_url?: unknown };
      const tag = typeof release.tag_name === 'string' ? release.tag_name.trim() : '';
      const latest = tag ? parseSemver(tag) : null;
      const current = parseSemver(APP_VERSION);
      if (latest && current && compareSemver(latest, current) > 0) {
        setState({
          status: 'available',
          tag,
          url: typeof release.html_url === 'string' ? release.html_url : `${REPO_URL}/releases/latest`,
        });
      } else {
        setState({ status: 'latest' });
      }
    } catch {
      setState({ status: 'error' });
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  return (
    <Card title="版本与更新">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="rounded-lg border border-ink-600 bg-ink-800/50 px-3 py-2 text-slate-300">
          当前版本 <span className="font-medium text-slate-100">v{APP_VERSION}</span>
        </span>
        <button
          type="button"
          onClick={() => void check()}
          disabled={state.status === 'checking'}
          className="ui-button rounded-lg border border-ink-600 px-4 py-2 text-slate-300 transition-colors hover:border-pink-400/40 hover:text-pink-200 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {state.status === 'checking' ? '检查中…' : '检查更新'}
        </button>
        {state.status === 'latest' && <span className="text-slate-400">已是最新版本。</span>}
        {state.status === 'available' && (
          <span className="flex flex-wrap items-center gap-2">
            <span className="rounded-lg bg-pink-500/10 px-3 py-2 text-pink-200">
              发现新版本 <span className="font-medium">{state.tag}</span>
            </span>
            <a
              className="text-pink-300 underline-offset-2 hover:text-pink-200 hover:underline"
              href={state.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              查看 Release
            </a>
          </span>
        )}
        {state.status === 'error' && (
          <span className="text-slate-500">
            检查更新失败（网络不可达或 GitHub API 限流），可稍后重试，或前往
            <a className="px-1 text-pink-300 hover:text-pink-200" href={`${REPO_URL}/releases`} target="_blank" rel="noopener noreferrer">Release 页面</a>
            手动查看。
          </span>
        )}
      </div>
      <p className="mt-3 text-[11px] leading-5 text-slate-500">
        打开本页时自动检查一次，仅作提示；Docker 部署不会自动更新，如需升级请按部署文档手动更换镜像。
      </p>
    </Card>
  );
}

export function AboutTab() {
  return (
    <div className="space-y-4">
      <Card
        title={
          <span className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-sakura-500/10 text-pink-300" aria-hidden="true">🌸</span>
            关于 Sakura AI Cut
          </span>
        }
      >
        <div className="space-y-3 text-xs leading-6 text-slate-400">
          <p>
            无限画布式 AI 短剧 / 电影生成与在线剪辑平台：把「剧本 → 资产生成 → 分镜运镜 → 在线剪辑」串成一条流水线，
            所有能力按五步工作台组织，内置自动规划 Agent。数据落在本机 SQLite，模型能力由你配置的外部 API 提供。
          </p>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-ink-600 bg-ink-800/50 p-3">
              <dt className="text-[11px] text-slate-500">当前版本</dt>
              <dd className="mt-1 text-sm font-medium text-slate-200">v{APP_VERSION}</dd>
            </div>
            <div className="rounded-lg border border-ink-600 bg-ink-800/50 p-3">
              <dt className="text-[11px] text-slate-500">部署方式</dt>
              <dd className="mt-1 text-sm font-medium text-slate-200">Docker 一键部署 · 数据本地存储</dd>
            </div>
            <div className="rounded-lg border border-ink-600 bg-ink-800/50 p-3">
              <dt className="text-[11px] text-slate-500">创作流程</dt>
              <dd className="mt-1 text-sm font-medium text-slate-200">设定 → 剧本 → 资产 → 分镜 → 剪辑</dd>
            </div>
            <div className="rounded-lg border border-ink-600 bg-ink-800/50 p-3">
              <dt className="text-[11px] text-slate-500">模型能力</dt>
              <dd className="mt-1 text-sm font-medium text-slate-200">自定义 API 接入 · 按能力路由</dd>
            </div>
          </dl>
        </div>
      </Card>

      <UpdateChecker />

      <Card title="许可证与授权">
        <div className="space-y-3 text-xs leading-6 text-slate-400">
          <p>
            本项目采用 <span className="font-medium text-slate-200">Sakura-License v1.2</span>（固定文本标识 <code className="rounded bg-ink-800 px-1 py-0.5 text-[11px] text-pink-200">Sakura-License-1.2</code>）。
            它是源码可用（source-available）许可证，不是 OSI 批准的开源许可证：阅读、运行、复制、修改与自部署免许可费，
            面向第三方的商业利用须先取得书面授权。
          </p>
          <ul className="list-disc space-y-1.5 pl-4">
            <li>许可正文与采用声明见仓库根目录 <a className="text-pink-300 hover:text-pink-200" href={`${REPO_URL}/blob/main/LICENSE`}>LICENSE</a> 与 <a className="text-pink-300 hover:text-pink-200" href={`${REPO_URL}/blob/main/NOTICE.md`}>NOTICE.md</a>；</li>
            <li>此前以 LGPL-2.1 取得副本的接收者，可继续按该许可使用；</li>
            <li>商用授权请在仓库 Issues 发起申请（请勿在公开 Issue 中提交敏感资料）。</li>
          </ul>
        </div>
      </Card>

      <Card title="资源与链接">
        <div className="flex flex-wrap gap-2">
          <a className="ui-button ui-button-primary rounded-lg bg-pink-500 px-4 py-2 text-xs font-medium text-white" href={REPO_URL}>源码仓库</a>
          <a className="ui-button rounded-lg border border-ink-600 px-4 py-2 text-xs text-slate-300" href="https://www.mcylyr.cn" target="_blank" rel="noopener noreferrer">顾瑶工作室官网</a>
          <a className="ui-button rounded-lg border border-ink-600 px-4 py-2 text-xs text-slate-300" href="https://wiki.mcylyr.cn/#/../licenses/Sakura-License-1.2">许可证正文（Wiki）</a>
          <a className="ui-button rounded-lg border border-ink-600 px-4 py-2 text-xs text-slate-300" href={`${REPO_URL}/issues`}>问题与授权申请</a>
        </div>
        <p className="mt-3 text-[11px] leading-5 text-slate-500">自部署、单用户使用；生成内容依赖你配置的外部模型服务。</p>
      </Card>
    </div>
  );
}

