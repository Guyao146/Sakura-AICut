'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import type { Job } from '@sakura/core';
import { Badge, Button, Progress } from '@/components/ui';
import { StepBriefPanel, StepScriptPanel } from './StudioPanels';
import { StepAssetsPanel } from './ProductionPanels';
import { StepShotsPanel } from './ShotPanels';
import { StepEditPanel } from './EditPanel';
import { AgentPanel } from './AgentPanel';
import { StudioCanvasBoard } from './StudioCanvas';
import type { StudioData } from './types';

/**
 * 工作台外壳：步骤导航 + 无限画布 + 右侧面板（当前步骤 / Agent）
 */

const STEP_ORDER = ['brief', 'script', 'assets', 'shots', 'edit'];

export default function StudioClient({ data }: { data: StudioData }) {
  const router = useRouter();
  const [stage, setStage] = useState<string>(STEP_ORDER.includes(data.project.stage) ? data.project.stage : 'brief');
  const [tab, setTab] = useState<'step' | 'agent'>('step');
  const [busy, setBusy] = useState(false);
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

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-[#1c2129] px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" className="text-[12px] text-slate-400 hover:text-slate-200">
            ← 项目
          </Link>
          <div className="min-w-0">
            <div className="truncate text-[14px] font-medium text-slate-100">{data.project.brief.name}</div>
            <div className="truncate text-[11px] text-slate-500">
              {data.project.brief.genres.join('/')} · {data.project.brief.style} · {data.project.brief.aspectRatio} ·{' '}
              {data.project.brief.targetDurationSec}s
            </div>
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
          <Button size="sm" variant="ghost" onClick={() => router.refresh()}>
            刷新
          </Button>
        </div>
      </header>

      {(activeJobs.length > 0 || message || recentFailed.length > 0) && (
        <div className="space-y-1 border-b border-[#1c2129] bg-[#0e1116] px-5 py-2">
          {activeJobs.map((job) => (
            <div key={job.id} className="flex items-center gap-3">
              <Badge tone="blue">{job.type}</Badge>
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
        <nav className="w-[190px] shrink-0 border-r border-[#1c2129] bg-[#0e1116] p-2">
          {data.progress.map((item) => (
            <button
              key={item.stage}
              type="button"
              onClick={() => {
                setStage(item.stage);
                setTab('step');
              }}
              className={clsx(
                'mb-1 w-full rounded-lg border px-3 py-2 text-left transition-colors',
                stage === item.stage && tab === 'step'
                  ? 'border-pink-400/40 bg-pink-500/10'
                  : 'border-transparent hover:bg-white/5',
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-slate-200">
                  {item.index}. {item.title}
                </span>
                <span className="text-[10px] text-slate-500">{item.percent}%</span>
              </div>
              <div className="mt-1">
                <Progress value={item.percent} />
              </div>
              <div className="mt-1 truncate text-[10px] text-slate-500">{item.stats}</div>
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1">
          <StudioCanvasBoard data={data} />
        </div>

        <aside className="w-[460px] shrink-0 overflow-y-auto border-l border-[#1c2129] bg-[#0b0d12] p-3">
          {tab === 'agent' ? (
            <AgentPanel
              projectId={data.project.id}
              plan={data.plan}
              turns={data.planTurns}
              running={activeJobs.some((job) => job.type === 'agent.run')}
              onRefresh={() => void loadJobs()}
            />
          ) : stage === 'brief' ? (
            <StepBriefPanel data={data} busy={busy} run={run} />
          ) : stage === 'script' ? (
            <StepScriptPanel data={data} busy={busy} run={run} />
          ) : stage === 'assets' ? (
            <StepAssetsPanel data={data} busy={busy} run={run} />
          ) : stage === 'shots' ? (
            <StepShotsPanel data={data} busy={busy} run={run} />
          ) : (
            <StepEditPanel data={data} busy={busy} run={run} />
          )}
        </aside>
      </div>
    </div>
  );
}
