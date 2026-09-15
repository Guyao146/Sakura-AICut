'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ASPECT_RATIOS, GENRES, VISUAL_STYLES, type AspectRatio } from '@sakura/core';
import clsx from 'clsx';
import { Button, Card, Field, Input, Select } from '@/components/ui';
import { createProjectAction } from '@/app/actions/project';

/**
 * 新建项目表单（第一步设定的快捷入口）
 */

export function NewProjectForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [logline, setLogline] = useState('');
  const [genres, setGenres] = useState<string[]>(['都市逆袭']);
  const [style, setStyle] = useState<string>('写实电影感');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16');
  const [duration, setDuration] = useState(90);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!name.trim()) {
      setError('请填写项目名称');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await createProjectAction({
      name,
      logline,
      genres,
      style,
      aspectRatio,
      targetDurationSec: duration,
    });
    if (result.ok && result.data) {
      router.push(`/studio/${result.data.id}`);
    } else {
      setError(result.error ?? '创建失败');
      setBusy(false);
    }
  }

  return (
    <Card title="新建项目">
      <Field label="项目名称">
        <Input value={name} placeholder="例如：樱花复仇计划" onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field label="一句话故事（可选）">
        <Input value={logline} onChange={(event) => setLogline(event.target.value)} />
      </Field>
      <Field label="题材类型">
        <div className="flex flex-wrap gap-1.5">
          {GENRES.slice(0, 10).map((genre) => {
            const active = genres.includes(genre);
            return (
              <button
                key={genre}
                type="button"
                onClick={() => setGenres(active ? genres.filter((item) => item !== genre) : [...genres, genre])}
                className={clsx(
                  'rounded-md border px-2 py-1 text-[11px]',
                  active ? 'border-pink-400/50 bg-pink-500/15 text-pink-200' : 'border-[#2b3240] text-slate-400',
                )}
              >
                {genre}
              </button>
            );
          })}
        </div>
      </Field>
      <Field label="视觉风格">
        <Select value={style} onChange={(event) => setStyle(event.target.value)}>
          {VISUAL_STYLES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="画幅">
          <Select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as AspectRatio)}>
            {Object.entries(ASPECT_RATIOS).map(([value, item]) => (
              <option key={value} value={value}>
                {item.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="目标时长（秒）">
          <Input
            type="number"
            min={15}
            max={3600}
            value={duration}
            onChange={(event) => setDuration(Number(event.target.value))}
          />
        </Field>
      </div>
      {error ? <div className="mb-2 text-[11px] text-red-300">{error}</div> : null}
      <Button variant="primary" loading={busy} onClick={() => void create()}>
        创建并进入工作台
      </Button>
    </Card>
  );
}
