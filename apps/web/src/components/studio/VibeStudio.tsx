'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { isActiveJob, vibeMetaFor, VIBE_RENDER_STATUS_LABELS, type Job, type Project, type VibeProject } from '@sakura/core';
import { Badge, Button, Card, Field, Textarea } from '@/components/ui';
import {
  saveVibeCodeAction,
  saveVibeScriptAction,
  startVibeCodeAction,
  startVibeRenderAction,
  startVibeScriptAction,
} from '@/app/actions/vibe';
import { useStudioJobs } from './use-studio-jobs';
import { TaskCenter } from './TaskCenter';
import { VibePreview } from './VibePreview';

/**
 * Vibe 模式工作台：主题 → 视频脚本 → 动画代码 → 渲染 MP4
 */

export interface VibeStudioData {
  project: Project;
  jobs: Job[];
  vibe: VibeProject | null;
}

export function VibeStudio({ data }: { data: VibeStudioData }) {
  const router = useRouter();
  const projectId = data.project.id;
  const vibe: VibeProject | null = data.vibe;
  const [topic, setTopic] = useState(vibe?.topic ?? '');
  const [instructions, setInstructions] = useState('');
  const [codeDraft, setCodeDraft] = useState(vibe?.code ?? '');
  const [showCode, setShowCode] = useState(false);
  const [scriptDraft, setScriptDraft] = useState(JSON.stringify(vibe?.script ?? {}, null, 2));
  const [showScript, setShowScript] = useState(false);
  const [draftRevision, setDraftRevision] = useState(vibe?.revision ?? 0);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const { jobs, error: syncError, reload: loadJobs, acceptJob } = useStudioJobs(projectId, data.jobs);

  const vibeJobs = jobs.filter((job) => job.type.startsWith('vibe.'));
  const activeJob = vibeJobs.find(isActiveJob);
  const busy = submitting || Boolean(activeJob);
  const busyScript = activeJob?.type === 'vibe.generate';
  const busyCode = activeJob?.type === 'vibe.code';
  const busyRender = Boolean(activeJob && vibe?.renderStatus === 'rendering');
  const phaseLabel = activeJob?.stageLabel || '等待任务执行';

  useEffect(() => {
    if (!showCode) setCodeDraft(vibe?.code ?? '');
    if (!showScript) setScriptDraft(JSON.stringify(vibe?.script ?? {}, null, 2));
    if (!showCode && !showScript) setDraftRevision(vibe?.revision ?? 0);
  }, [vibe?.code, vibe?.script, vibe?.revision, showCode, showScript]);

  const run = useCallback(
    async (label: string, fn: () => Promise<{ ok: boolean; error?: string; data?: unknown }>) => {
      setMessage(null);
      setSubmitting(true);
      try {
        const result = await fn();
        if (!result.ok) throw new Error(result.error ?? `${label}失败`);
        const job = (result.data as { job?: Job } | undefined)?.job;
        if (job) acceptJob(job);
        else { setShowCode(false); setShowScript(false); }
        setMessage({ tone: 'ok', text: `${label}已提交` });
        router.refresh();
        void loadJobs();
      } catch (error) {
        setMessage({ tone: 'err', text: error instanceof Error ? error.message : `${label}失败` });
      } finally { setSubmitting(false); }
    },
    [router, loadJobs, acceptJob],
  );

  const submitTopic = () => {
    if (!topic.trim()) {
      setMessage({ tone: 'err', text: '请填写创作主题' });
      return;
    }
    void run('视频脚本生成', () => startVibeScriptAction(projectId, { topic, instructions }));
  };
  const submitCode = () => void run('动画代码生成', () => startVibeCodeAction(projectId, instructions || undefined));
  const submitRender = () => void run('渲染', () => startVibeRenderAction(projectId));
  const saveCode = () => void run('代码保存', () => saveVibeCodeAction(projectId, codeDraft, draftRevision));
  const saveScript = () => void run('脚本保存', async () => saveVibeScriptAction(projectId, JSON.parse(scriptDraft), draftRevision));
  let probeError: string | null = null;
  let expectedMeta = null;
  try { if (vibe?.script) expectedMeta = vibeMetaFor(data.project.brief, vibe.script); }
  catch { probeError = '已保存的脚本不符合当前帧协议，请编辑脚本或重新生成。'; }
  const generateAll = () => void run('一键生成', () => startVibeScriptAction(projectId, { topic, instructions, autoRender: true }));


  return (
    <div className="min-h-screen bg-ink-900 text-slate-200">
      <header className="border-b border-ink-600 px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/" className="shrink-0 rounded-lg border border-ink-600 px-2.5 py-1.5 text-xs text-slate-400 hover:text-slate-200">
              ← 项目
            </Link>
            <Badge tone="pink">⚡ Vibe</Badge>
            <div className="min-w-0">
              <div className="truncate text-[14px] font-medium text-slate-100">{data.project.brief.name}</div>
              <div className="truncate text-[11px] text-slate-500">
                {data.project.brief.style} · {data.project.brief.aspectRatio} · {data.project.brief.targetDurationSec}s
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" disabled={busy || showCode || showScript || !topic.trim()} onClick={generateAll}>一键生成视频</Button>
            <Button size="sm" loading={busyRender} disabled={!vibe?.code || busy || showCode || showScript} onClick={submitRender}>
              {busyRender ? '渲染中…' : '渲染已保存代码'}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1400px] grid-cols-1 gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className="min-w-0 space-y-5">
          {message ? (
            <div className={clsx('rounded-lg px-3 py-2 text-xs', message.tone === 'ok' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300')}>
              {message.text}
            </div>
          ) : null}

          <Card title="① 主题 → 视频脚本" extra={vibe?.script ? <Badge tone="pink">已生成 {vibe.script.shots.length} 场</Badge> : null}>
            <Field label="创作主题">
              <Textarea aria-label="创作主题" maxLength={500} rows={3} value={topic} placeholder="例如：赛博朋克城市里，一朵樱花在霓虹灯下绽放" onChange={(event) => setTopic(event.target.value)} />
            </Field>
            <Field label="补充要求（可选）">
              <input
                className="field"
                value={instructions}
                placeholder="例如：节奏快一点，结尾有反转"
                onChange={(event) => setInstructions(event.target.value)}
              />
            </Field>
            <Button variant="primary" loading={busyScript} disabled={busy || showCode || showScript || !topic.trim()} onClick={submitTopic}>
              {vibe?.script ? '重新生成脚本' : '生成视频脚本'}
            </Button>
            {busyScript ? <JobHint label="AI 正在拆解主题并撰写分镜脚本" /> : null}
          </Card>

          {vibe?.script ? (
            <Card title="② 视频脚本（场次）" extra={<span className="text-[11px] text-slate-500">合计 {vibeScriptDurationLabel(vibe)} 秒</span>}>
              <div className="mb-3 flex gap-2">
                <Button size="sm" disabled={busy || showCode} onClick={() => { setShowScript(!showScript); setDraftRevision(vibe.revision); }}>查看 / 编辑 JSON</Button>
                {showScript ? <Button size="sm" disabled={busy} onClick={saveScript}>保存脚本</Button> : null}
              </div>
              {showScript ? <Textarea aria-label="视频脚本 JSON" rows={15} value={scriptDraft} onChange={(event) => setScriptDraft(event.target.value)} className="mb-3 font-mono text-xs" /> : null}
              <ol className="space-y-2">
                {vibe.script.shots.map((shot) => (
                  <li key={shot.id} className="rounded-lg border border-[#242a36] bg-[#0e1117] p-3">
                    <div className="mb-1 flex items-center gap-2 text-[11px] text-slate-400">
                      <span className="rounded bg-pink-500/15 px-1.5 py-0.5 text-pink-300">场次 {shot.index}</span>
                      <span>{shot.durationSec}s</span>
                      {shot.cameraMotion ? <span>· {shot.cameraMotion}</span> : null}
                      {shot.mood ? <span className="text-slate-500">· {shot.mood}</span> : null}
                    </div>
                    <div className="text-[12px] leading-5 text-slate-200">{shot.visualDescription}</div>
                    {shot.narration ? <div className="mt-1 break-words text-[11px] text-slate-400">字幕：{shot.narration}</div> : null}
                  </li>
                ))}
              </ol>
              <div className="mt-3 flex items-center gap-2">
                <Button size="sm" variant="primary" loading={busyCode} disabled={busy || showCode || showScript} onClick={submitCode}>
                  {vibe?.code ? '重新生成动画代码' : '③ 生成动画代码'}
                </Button>
                {busyCode ? <JobHint label="AI 正在编写动画页面代码" /> : null}
              </div>
            </Card>
          ) : null}

          {vibe?.code ? (
            <Card
              title="③ 动画代码"
              extra={
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  <Button size="sm" variant="ghost" disabled={busy || showScript} onClick={() => { setShowCode((v) => !v); setCodeDraft(vibe.code ?? ''); setDraftRevision(vibe.revision); }}>
                    {showCode ? '收起代码' : '查看 / 编辑代码'}
                  </Button>
                  {showCode ? <Button size="sm" disabled={busy} onClick={saveCode}>保存修改</Button> : null}
                </div>
              }
            >
              {showCode ? (
                <Textarea aria-label="动画代码" rows={18} value={codeDraft} onChange={(event) => setCodeDraft(event.target.value)} className="font-mono text-[11px]" />
              ) : (
                <p className="text-xs leading-5 text-slate-400">
                  AI 已生成 {vibe.code.length} 字符的动画页面。代码遵循帧协议：渲染器按时间轴逐帧截屏合成 MP4。
                </p>
              )}
            </Card>
          ) : null}
        </section>

        <aside className="min-w-0 space-y-5">
          <Card title="预览" extra={vibe ? <Badge tone={vibe.renderStatus === 'succeeded' ? 'pink' : 'default'}>{VIBE_RENDER_STATUS_LABELS[vibe.renderStatus]}</Badge> : null}>
            {vibe?.code && expectedMeta ? (
              <VibePreview code={vibe.code} meta={expectedMeta} />
            ) : (
              <div className="flex aspect-[9/16] max-h-[420px] items-center justify-center rounded-lg border border-dashed border-[#2b3240] text-[11px] text-slate-600">
                生成动画代码后可预览
              </div>
            )}
            {activeJob ? (
              <div className="mt-3">
                <div className="mb-1.5 flex items-center justify-between text-[11px] text-slate-400">
                  <span>{phaseLabel}</span>
                  <span>{Math.round(activeJob.progress)}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[#242a36]">
                  <div className="h-full rounded-full bg-pink-500 transition-all" style={{ width: `${Math.max(2, Math.min(100, activeJob.progress))}%` }} />
                </div>
              </div>
            ) : null}
            {probeError ? <p role="alert" className="text-xs text-red-300">{probeError}</p> : null}
            {vibe?.renderError ? (
              <div className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-[11px] text-red-300">渲染失败：{vibe.renderError}</div>
            ) : null}
          </Card>

          <Card title="成片（无声动画与字幕）">
            {vibe?.outputUrl ? (
              <div>
                <video src={vibe.outputUrl} controls playsInline preload="metadata" className="w-full rounded-lg border border-[#242a36] bg-black" />
                <a href={vibe.outputUrl} download className="mt-2 inline-block text-[11px] text-pink-300 hover:underline">
                  下载 MP4
                </a>
              </div>
            ) : (
              <p className="text-[11px] leading-5 text-slate-500">尚未渲染。使用「一键生成视频」自动完成全部阶段，或检查脚本和代码后点击「渲染已保存代码」。</p>
            )}
            {vibe?.renderedAt ? <p className="mt-2 text-[10px] text-slate-600">最近渲染：{new Date(vibe.renderedAt).toLocaleString('zh-CN')}</p> : null}
          </Card>
          <TaskCenter projectId={projectId} jobs={vibeJobs} syncError={syncError} onRefresh={loadJobs} onAccepted={acceptJob} />
        </aside>
      </main>
    </div>
  );
}

function JobHint({ label }: { label: string }) {
  return <span className="ml-2 inline-flex items-center gap-1.5 text-[11px] text-slate-400"><span className="inline-block size-3 animate-spin rounded-full border border-white/60 border-t-transparent" />{label}</span>;
}

function vibeScriptDurationLabel(vibe: VibeProject): string {
  if (!vibe.script) return '0';
  return vibe.script.shots.reduce((sum, shot) => sum + (shot.durationSec > 0 ? shot.durationSec : 0), 0).toFixed(0);
}
