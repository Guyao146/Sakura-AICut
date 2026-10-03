'use client';

import clsx from 'clsx';
import { JOB_TYPE_LABELS, getCanvasJobResults, hasJobFailures, isActiveJob, type Job } from '@sakura/core';
import { Badge, Button, Progress, STATUS_LABELS, statusTone } from '@/components/ui';
import type { StudioJob } from './use-studio-jobs';

export function TaskEntry({ job, busyId, retryCount, onAction }: {
  job: StudioJob; busyId: string | null; retryCount: number;
  onAction: (job: Job, kind: 'cancel' | 'retry') => Promise<void>;
}) {
  const results = getCanvasJobResults(job);
  const failed = hasJobFailures(job);
  const label = isActiveJob(job) ? (job.status === 'running' ? '执行中' : '排队中')
    : failed ? '需关注' : STATUS_LABELS[job.status];
  return (
    <article className={clsx('rounded-xl border bg-[#12151c] p-3', job.status === 'running' ? 'agent-step-running border-sky-500/30' : failed ? 'border-red-400/25' : 'border-[#242a36]')}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-slate-200">{JOB_TYPE_LABELS[job.type] ?? job.type}</h3>
        <Badge tone={failed ? 'red' : statusTone(job.status)}>{label}</Badge>
      </div>
      <p className="mb-2 break-words text-[11px] text-slate-400">{job.stageLabel || label}</p>
      {isActiveJob(job) ? <div className="mb-2 flex items-center gap-2"><Progress value={job.progress} /><span className="text-[10px] text-slate-500">{Math.round(job.progress)}%</span></div> : null}
      {results.length > 0 ? <p className="mb-2 text-[11px] text-slate-400">成功 {results.filter((entry) => entry.ok).length} · 失败 {results.filter((entry) => !entry.ok).length}</p> : null}
      {job.error ? <p className="mb-2 break-words text-[11px] text-red-300">{job.error}</p> : null}
      <details className="text-[11px] text-slate-500">
        <summary className="cursor-pointer py-1 hover:text-slate-200">执行详情</summary>
        <div className="mt-2 space-y-1.5 break-words">
          {results.filter((entry) => !entry.ok).map((entry) => <p key={entry.itemId} className="text-red-300">{entry.itemId}：{entry.error || '生成失败'}</p>)}
          {(job.events ?? []).map((event) => <p key={event.id} className={event.level === 'error' ? 'text-red-300' : ''}>{event.message}</p>)}
          <p>任务 {job.id}</p><p>创建于 {job.createdAt.replace('T', ' ').slice(0, 19)} UTC</p>
        </div>
      </details>
      <div className="mt-2 flex justify-end gap-2">
        {isActiveJob(job) ? <Button size="sm" variant="ghost" loading={busyId === job.id} disabled={busyId !== null} onClick={() => void onAction(job, 'cancel')}>取消任务</Button> : null}
        {retryCount ? <Button size="sm" loading={busyId === job.id} disabled={busyId !== null} onClick={() => void onAction(job, 'retry')}>重试未完成 ({retryCount})</Button> : null}
      </div>
    </article>
  );
}
