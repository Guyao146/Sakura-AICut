'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ASPECT_RATIOS, GENRES, VISUAL_STYLES, VIBE_STYLES, VIBE_MAX_DURATION, type AspectRatio } from '@sakura/core';
import clsx from 'clsx';
import { Button, Card, Field, Input, Select, Textarea } from '@/components/ui';
import { createProjectAction } from '@/app/actions/project';
import { createVibeProjectAction } from '@/app/actions/vibe';

/**
 * 新建项目表单（第一步设定的快捷入口）
 * 支持两种模式：studio 五步流水线 / vibe 主题直出
 */

type Mode = 'studio' | 'vibe';

export function NewProjectForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('studio');
  const [name, setName] = useState('');
  const [logline, setLogline] = useState('');
  const [genres, setGenres] = useState<string[]>(['都市逆袭']);
  const [style, setStyle] = useState<string>('写实电影感');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16');
  const [duration, setDuration] = useState(90);
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    const failed = (message: string) => { setError(message); setBusy(false); };
    setBusy(true);
    setError(null);
    try {
      if (mode === 'vibe') {
        if (!topic.trim()) return failed('请填写创作主题');
        const result = await createVibeProjectAction({ name, topic, aspectRatio, style, targetDurationSec: duration });
        if (result.ok && result.data) router.push(`/studio/${result.data.id}`);
        else failed(result.error ?? '创建失败');
        return;
      }
      if (!name.trim()) return failed('请填写项目名称');
      const result = await createProjectAction({ name, logline, genres, style, aspectRatio, targetDurationSec: duration });
      if (result.ok && result.data) router.push(`/studio/${result.data.id}`);
      else failed(result.error ?? '创建失败');
    } catch (error) {
      failed(error instanceof Error ? error.message : '创建失败，请重试');
    }
  }

  return (
    <Card title={<span className="flex items-center gap-2"><span className="flex size-7 items-center justify-center rounded-lg bg-sakura-500/10 text-pink-300" aria-hidden="true">✦</span>开始新故事</span>} className="new-project-card rounded-2xl sm:p-5">
      <div className="mb-4 flex gap-1.5 rounded-lg border border-[#2b3240] bg-[#0e1117] p-1" role="tablist" aria-label="创作模式">
        {(['studio', 'vibe'] as const).map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={mode === item}
            onClick={() => { setMode(item); setStyle(item === 'vibe' ? VIBE_STYLES[0] : VISUAL_STYLES[0]); setDuration(item === 'vibe' ? 30 : 90); }}
            className={clsx(
              'flex-1 rounded-md px-2 py-1.5 text-[11px] transition-colors',
              mode === item ? 'bg-pink-500/15 text-pink-200' : 'text-slate-400 hover:text-slate-200',
            )}
          >
            {item === 'studio' ? '流水线工作室' : '⚡ Vibe 直出'}
          </button>
        ))}
      </div>
      {mode === 'vibe' ? (
        <p className="mb-4 text-xs leading-5 text-slate-400">
          输入主题，AI 依次生成脚本、动画代码，再渲染无声 MP4（含字幕）。需配置文本模型。
        </p>
      ) : (
        <p className="mb-5 text-xs leading-5 text-slate-400">给作品起个名字，建立你的创作空间。</p>
      )}
      <Field label="项目名称">
        <Input aria-label="项目名称" maxLength={120} value={name} placeholder={mode === 'vibe' ? '留空则用主题命名' : '例如：樱花复仇计划'} onChange={(event) => setName(event.target.value)} />
      </Field>
      {mode === 'vibe' ? (
        <Field label="创作主题" hint="想拍什么，交给 AI">
          <Textarea
            aria-label="创作主题"
            maxLength={500}
            value={topic}
            rows={3}
            placeholder="例如：赛博朋克城市里，一朵樱花在霓虹灯下绽放的 30 秒短片"
            onChange={(event) => setTopic(event.target.value)}
          />
        </Field>
      ) : (
        <Field label="一句话故事（可选）">
          <Input value={logline} onChange={(event) => setLogline(event.target.value)} />
        </Field>
      )}
      {mode === 'studio' ? (
        <Field label="题材类型">
          <div className="flex flex-wrap gap-1.5">
            {GENRES.slice(0, 10).map((genre) => {
              const active = genres.includes(genre);
              return (
                <button
                  key={genre}
                  type="button"
                  onClick={() => setGenres(active ? genres.filter((item) => item !== genre) : [...genres, genre])}
                  aria-pressed={active}
                  className={clsx(
                    'choice-chip rounded-md border px-2 py-1 text-[11px]',
                    active ? 'border-pink-400/50 bg-pink-500/15 text-pink-200' : 'border-[#2b3240] text-slate-400',
                  )}
                >
                  {genre}
                </button>
              );
            })}
          </div>
        </Field>
      ) : null}
      <Field label="视觉风格">
        <Select value={style} onChange={(event) => setStyle(event.target.value)}>
          {(mode === 'vibe' ? VIBE_STYLES : VISUAL_STYLES).map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="画幅">
          <Select aria-label="画幅比例" value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as AspectRatio)}>
            {Object.entries(ASPECT_RATIOS).map(([value, item]) => (
              <option key={value} value={value}>
                {item.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="目标时长（秒）">
          <Input
            aria-label="目标时长（秒）"
            type="number"
            min={mode === 'vibe' ? 3 : 15}
            max={mode === 'vibe' ? VIBE_MAX_DURATION : 3600}
            value={duration}
            onChange={(event) => setDuration(Number(event.target.value))}
          />
        </Field>
      </div>
      {error ? <div className="mb-2 text-[11px] text-red-300">{error}</div> : null}
      <Button variant="primary" className="mt-2 w-full" loading={busy} onClick={() => void create()}>
        {mode === 'vibe' ? '创建并生成视频' : '创建并进入工作台'}
      </Button>
    </Card>
  );
}
