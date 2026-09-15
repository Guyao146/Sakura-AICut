'use client';

import { useState } from 'react';
import { SHOT_SIZES, type ShotSize } from '@sakura/core';
import { Badge, Button, Card, Empty, Field, Input, Select, STATUS_LABELS, Textarea, statusTone } from '@/components/ui';
import {
  generateAssetsAction,
  planAssetsAction,
  refineAssetPromptAction,
  updateAssetAction,
} from '@/app/actions/production';
import type { StudioData } from './types';

/**
 * 第三步：资产面板（人物 / 场景 / 道具 参考图）
 */

interface PanelProps {
  data: StudioData;
  busy: boolean;
  run: (label: string, fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}

export function StepAssetsPanel({ data, busy, run }: PanelProps) {
  const [instructions, setInstructions] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const pending = data.assets.filter((asset) => asset.mediaIds.length === 0);

  return (
    <div className="space-y-3">
      <Card
        title="资产生成"
        extra={
          <div className="flex items-center gap-1.5">
            <Badge tone="green">第 3 步</Badge>
            <Badge tone={pending.length === 0 ? 'green' : 'amber'}>
              {data.assets.length - pending.length}/{data.assets.length} 就绪
            </Badge>
          </div>
        }
      >
        <div className="mb-3 flex flex-wrap gap-1.5">
          <Button
            loading={busy}
            onClick={() => run('规划资产', () => planAssetsAction(data.project.id, instructions || undefined))}
          >
            ① 按剧本规划资产
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={pending.length === 0}
            onClick={() => run('生成资产图', () => generateAssetsAction(data.project.id, [], { regenerate: false }))}
          >
            ② 生成全部资产图（{pending.length}）
          </Button>
          <Button
            variant="ghost"
            loading={busy}
            disabled={data.assets.length === 0}
            onClick={() => run('重绘全部', () => generateAssetsAction(data.project.id, [], { regenerate: true }))}
          >
            全部重绘
          </Button>
        </div>
        <Field label="额外要求（可选）" hint="例如：主角要两套造型 / 场景偏冷色调">
          <Input value={instructions} onChange={(event) => setInstructions(event.target.value)} />
        </Field>

        {data.assets.length === 0 ? (
          <Empty text="还没有资产。先完成第二步的剧本，再点「按剧本规划资产」自动生成人物 / 场景 / 道具清单。" />
        ) : (
          <div className="space-y-2">
            {data.assets.map((asset) => {
              const media = asset.mediaIds.map((id) => data.media[id]).filter(Boolean);
              const expanded = expandedId === asset.id;
              return (
                <div key={asset.id} className="rounded-lg border border-[#2b3240] bg-[#0e1116] p-2">
                  <div className="flex items-start gap-2">
                    <div className="size-16 shrink-0 overflow-hidden rounded bg-black/40">
                      {media[0] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={media[0].url} alt={asset.name} className="size-full object-cover" />
                      ) : (
                        <div className="flex size-full items-center justify-center text-[10px] text-slate-600">空</div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[12px] text-slate-100">{asset.name}</span>
                        <Badge tone={statusTone(asset.status)}>{STATUS_LABELS[asset.status] ?? asset.status}</Badge>
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-slate-500">{asset.description}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() =>
                            run('生成资产图', () =>
                              generateAssetsAction(data.project.id, [asset.id], { regenerate: false }),
                            )
                          }
                        >
                          生成
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => run('优化提示词', () => refineAssetPromptAction(asset.id))}
                        >
                          AI 改提示词
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setExpandedId(expanded ? null : asset.id)}>
                          {expanded ? '收起' : '编辑'}
                        </Button>
                        {asset.error ? (
                          <span className="text-[10px] text-red-400">{asset.error.slice(0, 40)}</span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {expanded && (
                    <AssetEditor
                      asset={asset}
                      busy={busy}
                      onSave={(patch) => run('保存资产', () => updateAssetAction(asset.id, patch))}
                    />
                  )}

                  {media.length > 1 && (
                    <div className="mt-2 flex gap-1.5 overflow-x-auto">
                      {media.map((item) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={item.id} src={item.url} alt="" className="h-14 rounded object-cover" />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

/** 单个资产的提示词编辑区 */
function AssetEditor({
  asset,
  busy,
  onSave,
}: {
  asset: StudioData['assets'][number];
  busy: boolean;
  onSave: (patch: { prompt?: string; description?: string; variants?: number }) => void;
}) {
  const [prompt, setPrompt] = useState(asset.prompt);
  const [description, setDescription] = useState(asset.description);
  const [variants, setVariants] = useState(asset.variants);

  return (
    <div className="mt-2 border-t border-[#242a36] pt-2">
      <Field label="资产描述">
        <Input value={description} onChange={(event) => setDescription(event.target.value)} />
      </Field>
      <Field label="图片提示词（英文效果最好）">
        <Textarea rows={4} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
      </Field>
      <div className="flex items-end gap-2">
        <div className="w-24">
          <Field label="张数">
            <Input
              type="number"
              min={1}
              max={4}
              value={variants}
              onChange={(event) => setVariants(Number(event.target.value))}
            />
          </Field>
        </div>
        <Button loading={busy} onClick={() => onSave({ prompt, description, variants })}>
          保存
        </Button>
      </div>
    </div>
  );
}
