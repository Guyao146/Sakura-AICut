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
  reshootShotAction,
  saveTimelineTracksAction,
  selectShotClipAction,
  deleteShotClipAction,
  setShotFrameAction,
  clearShotFramesAction,
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

      {shot.clipMediaIds.length > 0 && (
        <ClipVersions
          shotId={shot.id}
          clipMediaIds={shot.clipMediaIds}
          selectedMediaId={shot.selectedMediaId}
          media={data.media}
          busy={busy}
          run={run}
        />
      )}

      {expanded && <ShotEditor data={data} shotId={shot.id} busy={busy} run={run} />}
    </div>
  );
}

/** 片段版本列表：多版本切换 / 重拍 / 删除（libTV 片段重拍） */
function ClipVersions({
  shotId,
  clipMediaIds,
  selectedMediaId,
  media,
  busy,
  run,
}: {
  shotId: string;
  clipMediaIds: string[];
  selectedMediaId?: string | null;
  media: StudioData['media'];
  busy: boolean;
  run: PanelProps['run'];
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5 border-t border-[#242a36] pt-2">
      {clipMediaIds.map((mediaId, index) => {
        const clip = media[mediaId];
        const selected = (selectedMediaId ?? clipMediaIds[0]) === mediaId;
        return (
          <div
            key={mediaId}
            className={`group relative h-12 w-16 overflow-hidden rounded border transition-colors ${
              selected ? 'border-pink-400/70' : 'border-[#2b3240] hover:border-slate-500'
            }`}
          >
            {clip ? (
              <video src={clip.url} muted className="size-full object-cover" />
            ) : (
              <div className="flex size-full items-center justify-center text-[9px] text-slate-600">丢失</div>
            )}
            <span className="absolute left-0.5 top-0.5 rounded bg-black/60 px-1 text-[9px] text-slate-300">v{index + 1}</span>
            {selected && <span className="absolute right-0.5 top-0.5 text-[9px] text-pink-300">★</span>}
            <div className="absolute inset-x-0 bottom-0 flex opacity-0 transition-opacity group-hover:opacity-100">
              {!selected && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run('切换片段', () => selectShotClipAction(shotId, mediaId))}
                  className="flex-1 bg-black/70 py-0.5 text-[9px] text-slate-200 hover:bg-black/80"
                >
                  选
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => run('删除版本', () => deleteShotClipAction(shotId, mediaId))}
                className="flex-1 bg-red-900/70 py-0.5 text-[9px] text-red-200 hover:bg-red-800/80"
              >
                删
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 镜头提示词 / 运镜 / 多参创作编辑 */
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
  // 片段重拍参数
  const [reshootPrompt, setReshootPrompt] = useState('');
  const [reshootDuration, setReshootDuration] = useState(shot?.durationSec ?? 5);
  const [referenceMediaIds, setReferenceMediaIds] = useState<string[]>([]);
  if (!shot) return null;

  const cameraOptions = [...data.customCameraMoves];

  // 可选作首/尾帧与参考图的图片（资产图 + 画布生成的图）
  const imageMedia = Object.values(data.media).filter((item) => item.kind === 'image');
  const firstFrame = shot.firstFrameMediaId ? data.media[shot.firstFrameMediaId] : null;
  const lastFrame = shot.lastFrameMediaId ? data.media[shot.lastFrameMediaId] : null;

  const toggleReference = (mediaId: string) => {
    setReferenceMediaIds((prev) => (prev.includes(mediaId) ? prev.filter((id) => id !== mediaId) : [...prev, mediaId]));
  };

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


      {/* 多参创作：首帧 / 尾帧 / 参考图 */}
      <div className="space-y-2 rounded-lg border border-[#2b3240] bg-[#0b0e13] p-2">
        <div className="text-[11px] font-medium text-slate-300">多参创作（首尾帧 + 参考图）</div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="首帧图">
            <div className="flex items-center gap-1">
              {firstFrame ? (
                <img src={firstFrame.url} alt="首帧" className="h-10 w-14 rounded object-cover" />
              ) : (
                <div className="flex h-10 w-14 items-center justify-center rounded bg-black/40 text-[9px] text-slate-600">
                  无
                </div>
              )}
              <Select
                value={shot.firstFrameMediaId ?? ''}
                onChange={(event) =>
                  event.target.value
                    ? run('设为首帧', () => setShotFrameAction(shotId, event.target.value, 'first'))
                    : run('清除首帧', () => clearShotFramesAction(shotId, 'first'))
                }
                className="flex-1"
              >
                <option value="">不指定</option>
                {imageMedia.map((item) => (
                  <option key={item.id} value={item.id}>
                    {(item.prompt || '图片').slice(0, 16)}
                  </option>
                ))}
              </Select>
            </div>
          </Field>
          <Field label="尾帧图">
            <div className="flex items-center gap-1">
              {lastFrame ? (
                <img src={lastFrame.url} alt="尾帧" className="h-10 w-14 rounded object-cover" />
              ) : (
                <div className="flex h-10 w-14 items-center justify-center rounded bg-black/40 text-[9px] text-slate-600">
                  无
                </div>
              )}
              <Select
                value={shot.lastFrameMediaId ?? ''}
                onChange={(event) =>
                  event.target.value
                    ? run('设为尾帧', () => setShotFrameAction(shotId, event.target.value, 'last'))
                    : run('清除尾帧', () => clearShotFramesAction(shotId, 'last'))
                }
                className="flex-1"
              >
                <option value="">不指定</option>
                {imageMedia.map((item) => (
                  <option key={item.id} value={item.id}>
                    {(item.prompt || '图片').slice(0, 16)}
                  </option>
                ))}
              </Select>
            </div>
          </Field>
        </div>
        <Field label="参考图（多选，提升角色/主体一致性）">
          <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
            {imageMedia.length === 0 ? (
              <span className="text-[10px] text-slate-600">暂无图片，先在第三步或画布生成</span>
            ) : (
              imageMedia.map((item) => {
                const picked = referenceMediaIds.includes(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggleReference(item.id)}
                    className={`h-10 w-10 overflow-hidden rounded border transition-colors ${
                      picked ? 'border-pink-400/70 ring-1 ring-pink-400/40' : 'border-[#2b3240] hover:border-slate-500'
                    }`}
                    title={item.prompt || '参考图'}
                  >
                    <img src={item.url} alt={item.prompt || '参考图'} className="size-full object-cover" />
                  </button>
                );
              })
            )}
          </div>
        </Field>
      </div>

      {/* 片段重拍 */}
      <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2">
        <div className="text-[11px] font-medium text-amber-200">片段重拍</div>
        <Field label="重拍提示词（留空则用上面的视频提示词）">
          <Textarea
            rows={2}
            value={reshootPrompt}
            placeholder="例如：把镜头改成远景，角色转身离开"
            onChange={(event) => setReshootPrompt(event.target.value)}
          />
        </Field>
        <div className="flex items-end gap-2">
          <Field label="重拍时长（秒）">
            <Input
              type="number"
              min={3}
              max={12}
              value={reshootDuration}
              onChange={(event) => setReshootDuration(Number(event.target.value))}
            />
          </Field>
          <Button
            variant="primary"
            loading={busy}
            onClick={() =>
              run('片段重拍', () =>
                reshootShotAction(shotId, {
                  prompt: reshootPrompt.trim() || undefined,
                  durationSec: reshootDuration,
                  referenceMediaIds: referenceMediaIds.length > 0 ? referenceMediaIds : undefined,
                }),
              )
            }
          >
            🎬 重拍这一段
          </Button>
        </div>
      </div>
    </div>
  );
}

