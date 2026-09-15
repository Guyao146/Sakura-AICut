'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  ASPECT_RATIOS,
  GENRES,
  SHOT_SIZES,
  VISUAL_STYLES,
  type AspectRatio,
  type Shot,
  type ShotSize,
} from '@sakura/core';
import clsx from 'clsx';
import { Badge, Button, Card, Empty, Field, Input, Select, Textarea, STATUS_LABELS, statusTone } from '@/components/ui';
import {
  generateScreenplayAction,
  saveScreenplayTextAction,
  updateBriefAction,
} from '@/app/actions/project';
import {
  buildTimelineAction,
  generateAssetsAction,
  generateFirstFrameAction,
  generateShotsAction,
  planAssetsAction,
  planShotsAction,
  refineAssetPromptAction,
  renderTimelineAction,
  saveTimelineTracksAction,
  updateAssetAction,
  updateShotAction,
} from '@/app/actions/production';
import type { StudioData } from './types';
import { ScriptAssistant } from './ScriptAssistant';

/**
 * 五步流程的右侧面板
 */

interface PanelProps {
  data: StudioData;
  busy: boolean;
  run: (label: string, fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}

/* ============================ 第一步：项目设定 ============================ */

export function StepBriefPanel({ data, busy, run }: PanelProps) {
  const [brief, setBrief] = useState(data.project.brief);

  return (
    <div className="space-y-3">
      <Card title="项目设定" extra={<Badge tone="pink">第 1 步</Badge>}>
        <Field label="项目名称">
          <Input value={brief.name} onChange={(event) => setBrief({ ...brief, name: event.target.value })} />
        </Field>
        <Field label="一句话故事（logline）">
          <Input
            value={brief.logline}
            placeholder="例如：被裁员的外卖员继承集团，向昔日老板复仇"
            onChange={(event) => setBrief({ ...brief, logline: event.target.value })}
          />
        </Field>
        <Field label="题材类型（可多选）">
          <div className="flex flex-wrap gap-1.5">
            {GENRES.map((genre) => {
              const active = brief.genres.includes(genre);
              return (
                <button
                  key={genre}
                  type="button"
                  onClick={() =>
                    setBrief({
                      ...brief,
                      genres: active ? brief.genres.filter((item) => item !== genre) : [...brief.genres, genre],
                    })
                  }
                  className={clsx(
                    'rounded-md border px-2 py-1 text-[11px] transition-colors',
                    active
                      ? 'border-pink-400/50 bg-pink-500/15 text-pink-200'
                      : 'border-[#2b3240] text-slate-400 hover:text-slate-200',
                  )}
                >
                  {genre}
                </button>
              );
            })}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="视觉风格">
            <Select value={brief.style} onChange={(event) => setBrief({ ...brief, style: event.target.value })}>
              {VISUAL_STYLES.map((style) => (
                <option key={style} value={style}>
                  {style}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="画幅">
            <Select
              value={brief.aspectRatio}
              onChange={(event) => setBrief({ ...brief, aspectRatio: event.target.value as AspectRatio })}
            >
              {Object.entries(ASPECT_RATIOS).map(([value, item]) => (
                <option key={value} value={value}>
                  {item.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="目标总时长（秒）">
            <Input
              type="number"
              min={15}
              max={3600}
              value={brief.targetDurationSec}
              onChange={(event) => setBrief({ ...brief, targetDurationSec: Number(event.target.value) })}
            />
          </Field>
          <Field label="集数">
            <Input
              type="number"
              min={1}
              max={100}
              value={brief.episodeCount}
              onChange={(event) => setBrief({ ...brief, episodeCount: Number(event.target.value) })}
            />
          </Field>
        </div>
        <Field label="目标受众 / 平台" hint="影响 Agent 的口吻与节奏">
          <Input
            value={brief.audience ?? ''}
            placeholder="例如：抖音女频观众"
            onChange={(event) => setBrief({ ...brief, audience: event.target.value })}
          />
        </Field>
        <Field label="全局负向提示词">
          <Textarea
            rows={2}
            value={brief.negativePrompt ?? ''}
            onChange={(event) => setBrief({ ...brief, negativePrompt: event.target.value })}
          />
        </Field>
        <Field label="补充说明" hint="交给 Agent 的自由要求">
          <Textarea
            rows={3}
            value={brief.notes ?? ''}
            placeholder="例如：前 3 秒必须有打脸反转；不要出现血腥画面"
            onChange={(event) => setBrief({ ...brief, notes: event.target.value })}
          />
        </Field>
        <Button
          variant="primary"
          loading={busy}
          onClick={() => run('保存设定', () => updateBriefAction(data.project.id, brief))}
        >
          保存设定
        </Button>
      </Card>
    </div>
  );
}

/* ============================ 第二步：剧本 ============================ */

export function StepScriptPanel({ data, busy, run }: PanelProps) {
  const screenplay = data.screenplay;
  const [idea, setIdea] = useState('');
  const [keepCharacters, setKeepCharacters] = useState(true);
  const [raw, setRaw] = useState(screenplay?.raw ?? '');
  const [synopsis, setSynopsis] = useState(screenplay?.synopsis ?? '');
  const [tab, setTab] = useState<'beats' | 'characters' | 'locations' | 'assistant'>('beats');

  const tabs = { beats: '节拍', characters: '人物', locations: '场景/道具', assistant: 'AI 小助手' } as const;

  return (
    <div className="space-y-3">
      <Card
        title="剧本创作"
        extra={
          <div className="flex items-center gap-1.5">
            <Badge tone="blue">第 2 步</Badge>
            <Badge tone={screenplay ? 'green' : 'amber'}>{screenplay ? '已有剧本' : '待生成'}</Badge>
          </div>
        }
      >
        {!screenplay ? (
          <Empty text="还没有剧本。填写故事创意后点击「AI 生成剧本」，或用右侧 AI 小助手一边聊一边写。" />
        ) : (
          <div className="space-y-2">
            <div>
              <div className="text-[13px] font-medium text-slate-100">{screenplay.title}</div>
              <div className="mt-0.5 text-[11px] text-slate-500">logline：{screenplay.logline || '—'}</div>
            </div>
            <div className="flex gap-1.5">
              {(['beats', 'characters', 'locations', 'assistant'] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={clsx(
                    'rounded-md border px-2 py-1 text-[11px]',
                    tab === key ? 'border-pink-400/40 bg-pink-500/10 text-pink-200' : 'border-[#2b3240] text-slate-400',
                  )}
                >
                  {tabs[key]}
                </button>
              ))}
            </div>

            {tab === 'beats' && (
              <div className="max-h-[320px] space-y-1.5 overflow-y-auto pr-1">
                {screenplay.beats.map((beat) => (
                  <div key={beat.id} className="rounded-lg border border-[#242a36] bg-[#0e1116] p-2">
                    <div className="flex items-center justify-between text-[12px] text-slate-200">
                      <span>
                        {beat.index + 1}. {beat.title}
                      </span>
                      <Badge tone="default">{beat.durationSec}s</Badge>
                    </div>
                    <div className="mt-1 text-[11px] leading-relaxed text-slate-500">{beat.summary}</div>
                    <div className="mt-1 text-[10px] text-slate-600">情绪：{beat.mood || '—'}</div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'characters' && (
              <div className="max-h-[320px] space-y-1.5 overflow-y-auto pr-1">
                {screenplay.characters.map((character) => (
                  <div key={character.id} className="rounded-lg border border-[#242a36] bg-[#0e1116] p-2">
                    <div className="flex items-center justify-between text-[12px] text-slate-200">
                      <span>{character.name}</span>
                      <Badge tone={character.role === 'protagonist' ? 'pink' : 'default'}>{character.role}</Badge>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      {character.gender} · {character.age} · {character.personality}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-600">外貌：{character.appearance}</div>
                    <div className="text-[11px] text-slate-600">服装：{character.costume}</div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'locations' && (
              <div className="max-h-[320px] space-y-1.5 overflow-y-auto pr-1">
                {screenplay.locations.map((location) => (
                  <div key={location.id} className="rounded-lg border border-[#242a36] bg-[#0e1116] p-2 text-[11px]">
                    <div className="text-[12px] text-slate-200">🏠 {location.name}</div>
                    <div className="mt-0.5 text-slate-500">
                      {location.interior ? '内景' : '外景'} · {location.timeOfDay} · {location.atmosphere}
                    </div>
                    <div className="mt-0.5 text-slate-600">{location.description}</div>
                  </div>
                ))}
                {screenplay.props.map((prop) => (
                  <div key={prop.id} className="rounded-lg border border-[#242a36] bg-[#0e1116] p-2 text-[11px]">
                    <div className="text-[12px] text-slate-200">🎯 {prop.name}</div>
                    <div className="mt-0.5 text-slate-600">
                      {prop.description}（{prop.importance}）
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'assistant' && <ScriptAssistant projectId={data.project.id} initialMessages={data.chat} />}
          </div>
        )}
      </Card>

      <Card title="AI 生成剧本">
        <Field label="故事创意 / 要求" hint="留空则由 AI 依据项目设定自由创作">
          <Textarea
            rows={3}
            value={idea}
            placeholder="例如：外卖员林越被辞退当天，意外收到律师函，继承市值百亿的集团…"
            onChange={(event) => setIdea(event.target.value)}
          />
        </Field>
        <label className="mb-3 flex items-center gap-2 text-[12px] text-slate-400">
          <input
            type="checkbox"
            checked={keepCharacters}
            onChange={(event) => setKeepCharacters(event.target.checked)}
          />
          保留已有的人物设定（仅补全细节）
        </label>
        <Button
          variant="primary"
          loading={busy}
          onClick={() =>
            run('生成剧本', () =>
              generateScreenplayAction(data.project.id, {
                idea: idea || undefined,
                keepExistingCharacters: keepCharacters,
              }),
            )
          }
        >
          AI 生成剧本
        </Button>
      </Card>

      {screenplay && (
        <Card title="手动编辑梗概与原文">
          <Field label="故事梗概">
            <Textarea rows={4} value={synopsis} onChange={(event) => setSynopsis(event.target.value)} />
          </Field>
          <Field label="原始剧本文本" hint="便于日后检索与二次生成">
            <Textarea rows={5} value={raw} onChange={(event) => setRaw(event.target.value)} />
          </Field>
          <Button
            loading={busy}
            onClick={() => run('保存剧本', () => saveScreenplayTextAction(data.project.id, { synopsis, raw }))}
          >
            保存
          </Button>
        </Card>
      )}
    </div>
  );
}
