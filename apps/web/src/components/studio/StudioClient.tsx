'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { APP_VERSION, hasJobFailures, isActiveJob } from '@sakura/core';
import { Badge, Button, Progress } from '@/components/ui';
import { TaskCenter } from './TaskCenter';
import { WorkflowNav } from './WorkflowNav';
import { useStudioJobs } from './use-studio-jobs';
import { StepBriefPanel, StepScriptPanel } from './StudioPanels';
import { StepAssetsPanel } from './ProductionPanels';
import { StepShotsPanel } from './ShotPanels';
import { StepEditPanel } from './EditPanel';
import { AgentPanel } from './AgentPanel';
import { StudioCanvasBoard } from './StudioCanvas';
import { MediaLibraryPanel } from './MediaLibraryPanel';
import { UploadPanel } from './UploadPanel';
import { RedrawPanel, QaPanel, ReplicatePanel, ScriptVersionPanel, SmartPreviewPanel } from './FeaturePanels';
import type { StudioData } from './types';

/**
 * 工作台外壳：步骤导航 + 无限画布 + 右侧面板（当前步骤 / Agent）
 */

const STEP_ORDER = ['brief', 'script', 'assets', 'shots', 'edit'];

export default function StudioClient({ data }: { data: StudioData }) {
  const router = useRouter();
  const [stage, setStage] = useState<string>(STEP_ORDER.includes(data.project.stage) ? data.project.stage : 'brief');
  const [tab, setTab] = useState<'step' | 'agent' | 'canvas' | 'tasks'>('step');
  const [agentMode, setAgentMode] = useState<'plan' | 'action'>('plan');
  const [busy, setBusy] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const { jobs, error: jobsError, reload: loadJobs, acceptJob } = useStudioJobs(data.project.id, data.jobs);

  const run = useCallback(
    async (label: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
      setBusy(true);
      setMessage(null);
      try {
        const result = await fn();
        if (!result.ok) throw new Error(result.error ?? `${label}失败`);
        setMessage({ tone: 'ok', text: `${label}已提交` });
        router.refresh();
        void loadJobs();
      } catch (error) {
        setMessage({ tone: 'err', text: error instanceof Error ? error.message : `${label}失败` });
      } finally { setBusy(false); }
    },
    [router, loadJobs],
  );

  const activeJobs = jobs.filter(isActiveJob);
  const failedCount = jobs.filter(hasJobFailures).length;
  const openPanel = (next: typeof tab) => {
    setTab(next);
    setPanelCollapsed(false);
    // 窄屏面板位于画布下方，主动打开工具时将内容带入视野。
    window.requestAnimationFrame(() => {
      if (window.matchMedia('(max-width: 1023px)').matches) {
        document.getElementById('studio-panel')?.scrollIntoView({ block: 'start' });
      }
    });
  };

  // 只有资产生成 / 分镜片段两步需要无限画布；其余步骤显示独立页面
  const showCanvas = stage === 'assets' || stage === 'shots';

  return (
    <div className="studio-shell bg-ink-900">
      <header className="studio-header shrink-0 border-b border-ink-600">
        <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-3 sm:px-5">
          <div className="flex min-w-0 flex-1 basis-full items-center gap-3 sm:basis-auto">
            <Link href="/" className="shrink-0 rounded-lg border border-ink-600 px-2.5 py-2 text-xs text-slate-400 hover:text-slate-200">
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

          </div>
          <div className="flex flex-wrap items-center gap-1.5" aria-label="工作室工具">
            <Link
              href="/settings?tab=models"
              className="hidden rounded-lg border border-[#2b3240] px-2.5 py-1 text-[11px] text-slate-400 transition-colors hover:border-pink-400/40 hover:text-slate-200 xl:inline-block"
            >
              模型路由 →
            </Link>
            <Button
              size="sm"
              variant={tab === 'agent' ? 'primary' : 'default'}
              onClick={() => openPanel(tab === 'agent' && !panelCollapsed ? 'step' : 'agent')}
            >
              🤖 Agent
            </Button>
            <Button
              size="sm"
              variant={tab === 'canvas' ? 'primary' : 'default'}
              onClick={() => openPanel(tab === 'canvas' && !panelCollapsed ? 'step' : 'canvas')}
            >
              📚 素材
            </Button>
            <Button size="sm" variant={tab === 'tasks' ? 'primary' : 'default'} onClick={() => openPanel('tasks')}>
              任务{activeJobs.length ? ` (${activeJobs.length})` : failedCount ? ` · ${failedCount} 需关注` : ''}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { router.refresh(); void loadJobs(); }}>
              刷新
            </Button>
          </div>
        </div>
        <WorkflowNav progress={data.progress} stage={stage} onSelect={(next) => { setStage(next); setTab('step'); setPanelCollapsed(false); }} />
      </header>

      {(activeJobs.length > 0 || message || jobsError) && (
        <div className="shrink-0 space-y-1 border-b border-[#1c2129] bg-[#0e1116] px-3 py-2 sm:px-5">
          {activeJobs.length > 0 ? (
            <button type="button" onClick={() => openPanel('tasks')} className="flex w-full items-center gap-3 text-left" aria-label="查看进行中的任务">
              <Badge tone="blue">{activeJobs.length} 个任务进行中</Badge>
              <span className="min-w-0 flex-1"><Progress value={activeJobs[0].progress} /></span>
              <span className="hidden max-w-[240px] truncate text-[11px] text-slate-400 sm:inline">{activeJobs[0].stageLabel || '排队中'}</span>
              <span className="shrink-0 text-[11px] text-pink-300">任务中心 →</span>
            </button>
          ) : null}
          {message ? <p role="status" className={clsx('text-[11px]', message.tone === 'ok' ? 'text-emerald-300' : 'text-red-300')}>{message.text}</p> : null}
          {jobsError ? <p role="status" className="text-[11px] text-amber-300">{jobsError}，保留上次任务状态。</p> : null}
        </div>
      )}

      <div className="studio-workspace">
        {showCanvas ? (
          <div className="studio-canvas-area flex min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1">
              <StudioCanvasBoard data={{ ...data, jobs }} onJobAccepted={acceptJob} onOpenTasks={() => openPanel('tasks')} />
            </div>
          </div>
        ) : (
          <main className="studio-document min-w-0 flex-1 bg-[#0e1116] p-4 sm:p-6 lg:p-8">
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
                  <QaPanel
                    projectId={data.project.id}
                    running={activeJobs.some((job) => job.type === 'qa.review')}
                  />
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
              className="studio-panel-toggle border-ink-600 bg-ink-800 text-xs text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200"
              aria-expanded={false}
              title="展开面板"
            >
              <span>展开面板</span>
            </button>
          ) : (
            <aside id="studio-panel" aria-label="工作室面板" className="studio-side-panel border-ink-600 bg-ink-900">
              <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-ink-600 bg-ink-900 px-4 py-3">
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
                <h2 className="text-xs font-medium text-slate-300">{tab === 'tasks' ? '任务与记录' : tab === 'canvas' ? '素材库' : data.progress.find((item) => item.stage === stage)?.title ?? '当前步骤'}</h2>
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
            <div key={tab + stage} className="panel-enter p-4">
              {tab === 'tasks' ? (
                <TaskCenter projectId={data.project.id} jobs={jobs} syncError={jobsError} onRefresh={loadJobs} onAccepted={acceptJob} />
              ) : tab === 'canvas' ? (
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
                  <QaPanel
                    projectId={data.project.id}
                    running={activeJobs.some((job) => job.type === 'qa.review')}
                  />
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
