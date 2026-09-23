'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import type { Job } from '@sakura/core';
import { Badge, Button, Progress } from '@/components/ui';
import { APP_VERSION } from '@sakura/core';
import { StepBriefPanel, StepScriptPanel } from './StudioPanels';
import { StepAssetsPanel } from './ProductionPanels';
import { StepShotsPanel } from './ShotPanels';
import { StepEditPanel } from './EditPanel';
import { AgentPanel } from './AgentPanel';
import { StudioCanvasBoard } from './StudioCanvas';
import { MediaLibraryPanel } from './MediaLibraryPanel';
import { UploadPanel } from './UploadPanel';
import { RedrawPanel, ReplicatePanel, ScriptVersionPanel, SmartPreviewPanel } from './FeaturePanels';
import type { StudioData } from './types';

/**
 * 工作台外壳：步骤导航 + 无限画布 + 右侧面板（当前步骤 / Agent）
 */

const STEP_ORDER = ['brief', 'script', 'assets', 'shots', 'edit'];

export default function StudioClient({ data }: { data: StudioData }) {
  const router = useRouter();
  const [stage, setStage] = useState<string>(STEP_ORDER.includes(data.project.stage) ? data.project.stage : 'brief');
  const [tab, setTab] = useState<'step' | 'agent' | 'canvas'>('step');
  const [agentMode, setAgentMode] = useState<'plan' | 'action'>('plan');
  const [busy, setBusy] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const lastActiveCount = useRef(0);

  const loadJobs = useCallback(async () => {
    try {
      const res = await fetch(`/api/jobs?projectId=${data.project.id}&limit=20`, { cache: 'no-store' });
      const payload = (await res.json()) as { ok: boolean; data?: Job[] };
      const list = payload.data ?? [];
      setJobs(list);
      const active = list.filter((job) => job.status === 'running' || job.status === 'pending').length;
      // 任务从运行态归零时刷新服务端数据，把产物显示出来
      if (lastActiveCount.current > 0 && active < lastActiveCount.current) router.refresh();
      lastActiveCount.current = active;
    } catch {
      /* 忽略轮询错误 */
    }
  }, [data.project.id, router]);

  useEffect(() => {
    void loadJobs();
    const timer = setInterval(() => void loadJobs(), 3000);
    return () => clearInterval(timer);
  }, [loadJobs]);

  const run = useCallback(
    async (label: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
      setBusy(true);
      setMessage(null);
      const result = await fn();
      if (result.ok) {
        setMessage({ tone: 'ok', text: `${label}已提交` });
        router.refresh();
        void loadJobs();
      } else {
        setMessage({ tone: 'err', text: result.error ?? `${label}失败` });
      }
      setBusy(false);
    },
    [router, loadJobs],
  );

  const activeJobs = jobs.filter((job) => job.status === 'running' || job.status === 'pending');
  const recentFailed = jobs.filter((job) => job.status === 'failed').slice(0, 2);

  // 只有资产生成 / 分镜片段两步需要无限画布；其余步骤显示独立页面
  const showCanvas = stage === 'assets' || stage === 'shots';

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-[#1c2129] px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" className="text-[12px] text-slate-400 hover:text-slate-200">
            ← 项目
          </Link>
          <Badge tone="pink">
            v{APP_VERSION}
          </Badge>
          <div className="min-w-0">
            <div className="truncate text-[14px] font-medium text-slate-100">{data.project.brief.name}</div>
            <div className="truncate text-[11px] text-slate-500">
              {data.project.brief.genres.join('/')} · {data.project.brief.style} · {data.project.brief.aspectRatio} ·{' '}
              {data.project.brief.targetDurationSec}s
            </div>
          </div>

          {/* 五步流程：项目设定 / 剧本创作 / 资产生成 / 分镜片段 / 在线剪辑 */}
          <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-[#242a36] bg-[#0e1116] p-0.5">
            {data.progress.map((item, idx) => (
              <button
                key={item.stage}
                type="button"
                onClick={() => {
                  setStage(item.stage);
                  setTab('step');
                }}
                className={clsx(
                  'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] transition-all duration-200',
                  stage === item.stage && tab === 'step'
                    ? 'bg-pink-500/15 text-pink-200 shadow-[inset_0_0_0_1px_rgba(244,114,182,0.35)]'
                    : item.percent >= 100
                      ? 'text-emerald-300/80 hover:bg-emerald-500/10'
                      : 'text-slate-400 hover:bg-white/5 hover:text-slate-200',
                )}
                title={`${item.title} · ${item.stats} · ${item.percent}%`}
              >
                <span
                  className={clsx(
                    'flex size-4 items-center justify-center rounded-full text-[9px] transition-colors',
                    item.percent >= 100
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : stage === item.stage && tab === 'step'
                        ? 'bg-pink-500/30 text-pink-200'
                        : 'bg-white/10 text-slate-400',
                  )}
                >
                  {item.percent >= 100 ? '✓' : idx + 1}
                </span>
                <span className="hidden xl:inline">{item.title}</span>
                <span className="text-[9px] opacity-60">{item.percent}%</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/settings?tab=models"
            className="hidden rounded-lg border border-[#2b3240] px-2.5 py-1 text-[11px] text-slate-400 transition-colors hover:border-pink-400/40 hover:text-slate-200 xl:inline-block"
          >
            模型路由 →
          </Link>
          <Button
            size="sm"
            variant={tab === 'agent' ? 'primary' : 'default'}
            onClick={() => setTab(tab === 'agent' ? 'step' : 'agent')}
          >
            🤖 Agent
          </Button>
          <Button
            size="sm"
            variant={tab === 'canvas' ? 'primary' : 'default'}
            onClick={() => setTab(tab === 'canvas' ? 'step' : 'canvas')}
          >
            📚 素材
          </Button>
          <Button size="sm" variant="ghost" onClick={() => router.refresh()}>
            刷新
          </Button>
        </div>
      </header>

      {(activeJobs.length > 0 || message || recentFailed.length > 0) && (
        <div className="space-y-1 border-b border-[#1c2129] bg-[#0e1116] px-5 py-2">
          {activeJobs.map((job) => (
            <div key={job.id} className="flex animate-fade-in items-center gap-3">
              <Badge tone="blue">
                <span className="inline-flex items-center gap-1.5">
                  <span className="agent-badge-running inline-block size-1.5 rounded-full bg-sky-300" />
                  {job.type}
                </span>
              </Badge>
              <div className="flex-1">
                <Progress value={job.progress} />
              </div>
              <span className="w-[200px] truncate text-[11px] text-slate-400">{job.stageLabel ?? '执行中'}</span>
              <span className="text-[11px] text-slate-500">{Math.round(job.progress)}%</span>
            </div>
          ))}
          {message ? (
            <div className={clsx('text-[11px]', message.tone === 'ok' ? 'text-emerald-300' : 'text-red-300')}>
              {message.text}
            </div>
          ) : null}
          {recentFailed.map((job) => (
            <div key={job.id} className="text-[11px] text-red-300">
              {job.type} 失败：{job.error?.slice(0, 160)}
            </div>
          ))}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {showCanvas ? (
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1">
              <StudioCanvasBoard data={data} />
            </div>
          </div>
        ) : (
          <main className="min-w-0 flex-1 overflow-y-auto bg-[#0e1116] p-6">
            <div key={stage} className="mx-auto max-w-3xl animate-fade-in-up">
              {stage === 'brief' ? (
                <StepBriefPanel data={data} busy={busy} run={run} />
              ) : stage === 'script' ? (
                <div className="space-y-4">
                  <StepScriptPanel data={data} busy={busy} run={run} />
                  <ScriptVersionPanel
                    projectId={data.project.id}
                    versions={data.screenplayVersions}
                    currentRaw={data.screenplay?.raw ?? ''}
                  />
                </div>
              ) : (
                <div className="space-y-4">
                  <StepEditPanel data={data} busy={busy} run={run} />
                  <ReplicatePanel projectId={data.project.id} />
                  <RedrawPanel projectId={data.project.id} />
                </div>
              )}
            </div>
          </main>
        )}

        {showCanvas || tab !== 'step' ? (
          panelCollapsed ? (
            <button
              type="button"
              onClick={() => setPanelCollapsed(false)}
              className="flex w-9 shrink-0 items-center justify-center border-l border-[#1c2129] bg-[#0b0d12] text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-200"
              title="展开面板"
            >
              <span className="text-lg">«</span>
            </button>
          ) : (
            <aside className="w-[460px] shrink-0 overflow-y-auto border-l border-[#1c2129] bg-[#0b0d12] p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                {tab === 'agent' ? (
                <div className="flex rounded-lg border border-[#242a36] bg-[#0e1116] p-0.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setAgentMode('plan')}
                    className={clsx(
                      'rounded-md px-2.5 py-1 transition-all',
                      agentMode === 'plan' ? 'bg-sky-500/15 text-sky-300' : 'text-slate-500 hover:text-slate-300',
                    )}
                  >
                    🧭 计划
                  </button>
                  <button
                    type="button"
                    onClick={() => setAgentMode('action')}
                    className={clsx(
                      'rounded-md px-2.5 py-1 transition-all',
                      agentMode === 'action' ? 'bg-amber-500/15 text-amber-300' : 'text-slate-500 hover:text-slate-300',
                    )}
                  >
                    ⚡ 行动
                  </button>
                </div>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={() => setPanelCollapsed(true)}
                className="rounded-md px-2 py-0.5 text-[11px] text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-200"
                title="折叠面板"
              >
                收起 »
              </button>
            </div>
            <div key={tab + stage} className="animate-fade-in">
              {tab === 'canvas' ? (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-xs font-medium text-slate-300 mb-2">上传素材</h3>
                    <UploadPanel projectId={data.project.id} />
                  </div>
                  <div>
                    <h3 className="text-xs font-medium text-slate-300 mb-2">项目素材</h3>
                    <MediaLibraryPanel projectId={data.project.id} media={data.media} canvasItemCount={data.canvasItems.length} />
                  </div>
                </div>
              ) : tab === 'agent' ? (
                <AgentPanel
                  projectId={data.project.id}
                  plan={data.plan}
                  turns={data.planTurns}
                  mode={agentMode}
                  running={activeJobs.some((job) => job.type === 'agent.run')}
                  onRefresh={() => void loadJobs()}
                />
              ) : stage === 'brief' ? (
                <StepBriefPanel data={data} busy={busy} run={run} />
              ) : stage === 'script' ? (
                <div className="space-y-4">
                  <StepScriptPanel data={data} busy={busy} run={run} />
                  <ScriptVersionPanel
                    projectId={data.project.id}
                    versions={data.screenplayVersions}
                    currentRaw={data.screenplay?.raw ?? ''}
                  />
                </div>
              ) : stage === 'assets' ? (
                <StepAssetsPanel data={data} busy={busy} run={run} />
              ) : stage === 'shots' ? (
                <div className="space-y-4">
                  <StepShotsPanel data={data} busy={busy} run={run} />
                  <SmartPreviewPanel projectId={data.project.id} />
                </div>
              ) : (
                <div className="space-y-4">
                  <StepEditPanel data={data} busy={busy} run={run} />
                  <ReplicatePanel projectId={data.project.id} />
                  <RedrawPanel projectId={data.project.id} />
                </div>
              )}
            </div>
          </aside>
          )) : null}
      </div>
    </div>
  );
}
