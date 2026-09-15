'use client';

import { useState } from 'react';
import { SHOT_SIZES, type ShotSize } from '@sakura/core';
import { Badge, Button, Card, Empty, Field, Input, Select, STATUS_LABELS, Textarea, statusTone } from '@/components/ui';
import {
  buildTimelineAction,
  deleteShotAction,
  generateFirstFrameAction,
  generateShotsAction,
  planShotsAction,
  renderTimelineAction,
  saveTimelineTracksAction,
  updateShotAction,
} from '@/app/actions/production';
import type { StudioData } from './types';

/**
 * 第四步：分镜与镜头片段面板
 */

interface PanelProps {
  data: StudioData;
  busy: boolean;
  run: (label: string, fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}

export function StepShotsPanel({ data, busy, run }: PanelProps) {
  const [maxShots, setMaxShots] = useState(20);
  const [cameraPreference, setCameraPreference] = useState('');
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [withFirstFrame, setWithFirstFrame] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const pending = data.shots.filter((shot) => shot.clipMediaIds.length === 0);

  return (
    <div className="space-y-3">
      <Card
        title="分镜与片段"
        extra={
          <div className="flex items-center gap-1.5">
            <Badge tone="amber">第 4 步</Badge>
            <Badge tone={pending.length === 0 ? 'green' : 'amber'}>
              {data.shots.length - pending.length}/{data.shots.length} 已生成
            </Badge>
          </div>
        }
      >
        <div className="mb-2 grid grid-cols-3 gap-2">
          <Field label="镜头数上限">
            <Input
              type="number"
              min={1}
              max={120}
              value={maxShots}
              onChange={(event) => setMaxShots(Number(event.target.value))}
            />
          </Field>
          <div className="col-span-2">
            <Field label="运镜偏好（可选）">
              <Input
                value={cameraPreference}
                placeholder="例如：多用推镜与环绕"
                onChange={(event) => setCameraPreference(event.target.value)}
              />
            </Field>
          </div>
        </div>
        <label className="mb-2 flex items-center gap-2 text-[12px] text-slate-400">
          <input
            type="checkbox"
            checked={replaceExisting}
            onChange={(event) => setReplaceExisting(event.target.checked)}
          />
          覆盖已有镜头（否则追加）
        </label>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button
            loading={busy}
            onClick={() =>
              run('拆解分镜', () =>
                planShotsAction(data.project.id, {
                  maxShots,
                  cameraPreference: cameraPreference || undefined,
                  replaceExisting,
                }),
              )
            }
          >
            ① AI 拆解分镜
          </Button>
          <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <input
              type="checkbox"
              checked={withFirstFrame}
              onChange={(event) => setWithFirstFrame(event.target.checked)}
            />
            先生成首帧
          </label>
          <Button
            variant="primary"
            loading={busy}
            disabled={pending.length === 0}
            onClick={() => run('生成片段', () => generateShotsAction(data.project.id, [], { withFirstFrame }))}
          >
            ② 生成全部片段（{pending.length}）
          </Button>
        </div>

        {data.shots.length === 0 ? (
          <Empty text="还没有镜头。先完成剧本，再点「AI 拆解分镜」。" />
        ) : (
          <div className="space-y-2">
            {data.shots.map((shot) => (
              <ShotRow
                key={shot.id}
                data={data}
                shotId={shot.id}
                busy={busy}
                run={run}
                withFirstFrame={withFirstFrame}
                expanded={expandedId === shot.id}
                onToggle={() => setExpandedId(expandedId === shot.id ? null : shot.id)}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/** 单个镜头行 + 编辑区 */
function ShotRow({
  data,
  shotId,
  busy,
  run,
  withFirstFrame,
  expanded,
  onToggle,
}: {
  data: StudioData;
  shotId: string;
  busy: boolean;
  run: PanelProps['run'];
  withFirstFrame: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const shot = data.shots.find((item) => item.id === shotId);
  if (!shot) return null;
  const clip = data.media[shot.selectedMediaId ?? shot.clipMediaIds[0] ?? ''];
  const camera = data.customCameraMoves.find((move) => move.id === shot.cameraTemplateId);

  return (
    <div className="rounded-lg border border-[#2b3240] bg-[#0e1116] p-2">
      <div className="flex items-start gap-2">
        <div className="h-16 w-12 shrink-0 overflow-hidden rounded bg-black/40">
          {clip ? (
            <video src={clip.url} muted className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center text-[10px] text-slate-600">空</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[12px] text-slate-100">
              #{shot.index} · {shot.shotSize} · {shot.durationSec}s
            </span>
            <Badge tone={statusTone(shot.status)}>{STATUS_LABELS[shot.status] ?? shot.status}</Badge>
          </div>
          <div className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">{shot.description}</div>
          {shot.dialogue ? <div className="mt-0.5 truncate text-[11px] text-sky-300/80">台词：{shot.dialogue}</div> : null}
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <Button
              size="sm"
              variant="primary"
              onClick={() => run('生成片段', () => generateShotsAction(data.project.id, [shot.id], { withFirstFrame }))}
            >
              生成片段
            </Button>
            <Button size="sm" variant="ghost" onClick={() => run('生成首帧', () => generateFirstFrameAction(shot.id))}>
              首帧
            </Button>
            <Button size="sm" variant="ghost" onClick={onToggle}>
              {expanded ? '收起' : '编辑'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => run('删除镜头', () => deleteShotAction(shot.id))}>
              删除
            </Button>
            {camera ? <Badge tone="blue">{camera.name}</Badge> : null}
          </div>
        </div>
      </div>

      {expanded && <ShotEditor data={data} shotId={shot.id} busy={busy} run={run} />}
    </div>
  );
}

/** 镜头提示词 / 运镜编辑 */
function ShotEditor({
  data,
  shotId,
  busy,
  run,
}: {
  data: StudioData;
  shotId: string;
  busy: boolean;
  run: PanelProps['run'];
}) {
  const shot = data.shots.find((item) => item.id === shotId);
  const [prompt, setPrompt] = useState(shot?.prompt ?? '');
  const [description, setDescription] = useState(shot?.description ?? '');
  const [dialogue, setDialogue] = useState(shot?.dialogue ?? '');
  const [durationSec, setDurationSec] = useState(shot?.durationSec ?? 5);
  const [shotSize, setShotSize] = useState<ShotSize>(shot?.shotSize ?? '中景');
  const [cameraPrompt, setCameraPrompt] = useState(shot?.cameraPrompt ?? '');
  const [cameraTemplateId, setCameraTemplateId] = useState(shot?.cameraTemplateId ?? '');
  if (!shot) return null;

  const cameraOptions = [
    ...data.customCameraMoves,
    // 内置运镜由服务端合并进 customCameraMoves 列表一并展示
  ];

  return (
    <div className="mt-2 space-y-2 border-t border-[#242a36] pt-2">
      <div className="grid grid-cols-3 gap-2">
        <Field label="景别">
          <Select value={shotSize} onChange={(event) => setShotSize(event.target.value as ShotSize)}>
            {SHOT_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="时长（秒）">
          <Input
            type="number"
            min={3}
            max={12}
            value={durationSec}
            onChange={(event) => setDurationSec(Number(event.target.value))}
          />
        </Field>
        <Field label="运镜模板">
          <Select value={cameraTemplateId} onChange={(event) => setCameraTemplateId(event.target.value)}>
            <option value="">不使用</option>
            {cameraOptions.map((move) => (
              <option key={move.id} value={move.id}>
                {move.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="画面描述（中文，给人看）">
        <Textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} />
      </Field>
      <Field label="台词">
        <Input value={dialogue} onChange={(event) => setDialogue(event.target.value)} />
      </Field>
      <Field label="自定义运镜（英文，优先级高于模板）">
        <Input value={cameraPrompt} onChange={(event) => setCameraPrompt(event.target.value)} />
      </Field>
      <Field label="视频提示词（英文）">
        <Textarea rows={3} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
      </Field>
      <Button
        loading={busy}
        onClick={() =>
          run('保存镜头', () =>
            updateShotAction(shotId, {
              description,
              dialogue,
              durationSec,
              shotSize,
              cameraTemplateId: cameraTemplateId || null,
              cameraPrompt: cameraPrompt || null,
              prompt,
            }),
          )
        }
      >
        保存镜头
      </Button>
    </div>
  );
}
