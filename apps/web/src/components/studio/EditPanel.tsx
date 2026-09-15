'use client';

import { useState } from 'react';
import { formatDuration, type Track } from '@sakura/core';
import { Badge, Button, Card, Empty, Field, Input, Select } from '@/components/ui';
import { buildTimelineAction, renderTimelineAction, saveTimelineTracksAction } from '@/app/actions/production';
import type { StudioData } from './types';

/**
 * 第五步：在线剪辑（排序 / 时长 / 变速 / 转场 / 导出）
 */

interface PanelProps {
  data: StudioData;
  busy: boolean;
  run: (label: string, fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}

export function StepEditPanel({ data, busy, run }: PanelProps) {
  const timeline = data.timeline;
  const [transition, setTransition] = useState<'fade' | 'dissolve' | 'none'>('fade');
  const [includeSubtitles, setIncludeSubtitles] = useState(true);
  const [tracks, setTracks] = useState<Track[]>(timeline?.tracks ?? []);
  const [previewIndex, setPreviewIndex] = useState(0);

  const dirty = JSON.stringify(tracks) !== JSON.stringify(timeline?.tracks ?? []);
  const videoTrack = tracks.find((track) => track.type === 'video');
  const clips = videoTrack?.clips ?? [];
  const totalDuration = clips.reduce((sum, clip) => sum + clip.duration, 0);
  const previewClip = clips[previewIndex];
  const previewMedia = previewClip ? data.media[previewClip.mediaId] : null;

  function setClips(nextClips: typeof clips) {
    setTracks(tracks.map((track) => (track.type === 'video' ? { ...track, clips: nextClips } : track)));
  }

  function reorder(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= clips.length) return;
    const next = [...clips];
    const a = next[index];
    const b = next[target];
    if (!a || !b) return;
    next[index] = b;
    next[target] = a;
    let cursor = 0;
    setClips(
      next.map((clip) => {
        const updated = { ...clip, start: Number(cursor.toFixed(3)) };
        cursor += clip.duration;
        return updated;
      }),
    );
  }

  return (
    <div className="space-y-3">
      <Card
        title="在线剪辑"
        extra={
          <div className="flex items-center gap-1.5">
            <Badge tone="pink">第 5 步</Badge>
            <Badge tone={timeline ? 'green' : 'amber'}>{timeline ? `v${timeline.version}` : '未构建'}</Badge>
          </div>
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button
            loading={busy}
            onClick={() =>
              run('构建时间线', () =>
                buildTimelineAction(data.project.id, { transition, transitionDuration: 0.4, includeSubtitles }),
              )
            }
          >
            ① 按镜头生成时间线
          </Button>
          <Button
            loading={busy}
            disabled={clips.length === 0}
            onClick={() => run('保存时间线', () => saveTimelineTracksAction(data.project.id, tracks))}
          >
            ② 保存调整{dirty ? '（有改动）' : ''}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={clips.length === 0}
            onClick={() => run('渲染导出', () => renderTimelineAction(data.project.id, { includeSubtitles }))}
          >
            ③ 渲染导出 MP4
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label="默认转场">
            <Select value={transition} onChange={(event) => setTransition(event.target.value as 'fade')}>
              <option value="fade">淡入淡出</option>
              <option value="dissolve">叠化</option>
              <option value="none">硬切</option>
            </Select>
          </Field>
          <label className="mt-5 flex items-center gap-2 text-[12px] text-slate-400">
            <input
              type="checkbox"
              checked={includeSubtitles}
              onChange={(event) => setIncludeSubtitles(event.target.checked)}
            />
            生成台词字幕轨
          </label>
        </div>

        <div className="mt-2 text-[11px] text-slate-500">
          总时长 {formatDuration(totalDuration)} · {clips.length} 个片段
          {timeline?.renderOutputUrl ? (
            <>
              {' '}
              ·{' '}
              <a className="text-pink-300 underline" href={timeline.renderOutputUrl} target="_blank" rel="noreferrer">
                查看上次导出
              </a>
            </>
          ) : null}
        </div>

        {clips.length === 0 ? (
          <div className="mt-3">
            <Empty text="还没有片段。先在第四步生成镜头片段，再回到这里构建时间线。" />
          </div>
        ) : (
          <>
            <div className="mt-3 overflow-hidden rounded-lg border border-[#242a36] bg-black">
              {previewMedia ? (
                <video key={previewMedia.id} src={previewMedia.url} controls className="max-h-[280px] w-full" />
              ) : null}
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
              <span>
                预览 {previewIndex + 1}/{clips.length}
              </span>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setPreviewIndex(Math.max(0, previewIndex - 1))}>
                  上一个
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPreviewIndex(Math.min(clips.length - 1, previewIndex + 1))}
                >
                  下一个
                </Button>
              </div>
            </div>

            <ClipList clips={clips} onReorder={reorder} onUpdate={setClips} />
          </>
        )}
      </Card>
    </div>
  );
}

/** 片段列表：调整时长 / 变速 / 排序 / 移除 */
function ClipList({
  clips,
  onReorder,
  onUpdate,
}: {
  clips: Track['clips'];
  onReorder: (index: number, direction: -1 | 1) => void;
  onUpdate: (clips: Track['clips']) => void;
}) {
  return (
    <div className="mt-3 max-h-[320px] space-y-1.5 overflow-y-auto pr-1">
      {clips.map((clip, index) => (
        <div key={clip.id} className="rounded-lg border border-[#2b3240] bg-[#0e1116] p-2">
          <div className="flex items-center justify-between text-[11px] text-slate-300">
            <span>
              {index + 1}. {clip.label ?? '片段'}
            </span>
            <span className="text-slate-500">
              {formatDuration(clip.start)} → {formatDuration(clip.start + clip.duration)}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="w-20">
              <Input
                type="number"
                step="0.1"
                value={clip.duration}
                onChange={(event) =>
                  onUpdate(clips.map((item) => (item.id === clip.id ? { ...item, duration: Number(event.target.value) } : item)))
                }
              />
            </div>
            <Select
              value={String(clip.speed)}
              className="!w-20"
              onChange={(event) =>
                onUpdate(clips.map((item) => (item.id === clip.id ? { ...item, speed: Number(event.target.value) } : item)))
              }
            >
              <option value="0.5">0.5x</option>
              <option value="1">1x</option>
              <option value="1.5">1.5x</option>
              <option value="2">2x</option>
            </Select>
            <Button size="sm" variant="ghost" onClick={() => onReorder(index, -1)}>
              ↑
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onReorder(index, 1)}>
              ↓
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onUpdate(clips.filter((item) => item.id !== clip.id))}
            >
              移除
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
