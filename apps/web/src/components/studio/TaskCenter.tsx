'use client';

import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { getCanvasRetryIds, getCanvasNodeJobStates, hasJobFailures, isActiveJob, type Job } from '@sakura/core';
import { Button, Empty } from '@/components/ui';
import { retryCanvasJobAction } from '@/app/actions/canvas';
import type { StudioJob } from './use-studio-jobs';
import { TaskEntry } from './TaskEntry';

export function TaskCenter({ projectId, jobs, syncError, onRefresh, onAccepted }: {
  projectId: string; jobs: StudioJob[]; syncError: string | null;
  onRefresh: () => Promise<void>; onAccepted: (job: Job) => void;
}) {
  const [filter, setFilter] = useState<'all' | 'active' | 'failed'>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const latestNodes = useMemo(() => getCanvasNodeJobStates(jobs, projectId), [jobs, projectId]);
  const active = jobs.filter(isActiveJob);
  const failed = jobs.filter(hasJobFailures);
  const list = (filter === 'active' ? active : filter === 'failed' ? failed : jobs).slice()
    .sort((a, b) => Number(isActiveJob(b)) - Number(isActiveJob(a)) || b.createdAt.localeCompare(a.createdAt));

  async function act(job: Job, kind: 'cancel' | 'retry') {
    if (busyId) return;
    setBusyId(job.id);
    setMessage(null);
    try {
      if (kind === 'retry') {
        const result = await retryCanvasJobAction(projectId, job.id);
        if (!result.ok || !result.data) throw new Error(result.error ?? '重试失败');
        onAccepted(result.data.job);
        setMessage(`已提交 ${result.data.count} 个未完成节点，成功节点不会重复生成。`);
      } else {
        const response = await fetch('/api/jobs', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId, jobId: job.id }),
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.error ?? '取消失败');
        if (payload.data?.job) onAccepted(payload.data.job);
        setMessage(payload.data?.canceled ? '已取消后续执行。已发出的模型请求可能仍会完成并计费。' : '任务已经结束。');
      }
      await onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败，请重试');
    } finally { setBusyId(null); }
  }

  return (
    <section className="space-y-3" aria-label="任务中心">
      <div className="flex items-start justify-between gap-2">
        <div><h2 className="text-sm font-medium text-slate-100">任务中心</h2><p className="mt-1 text-[11px] text-slate-500">查看执行进度、失败原因与生成记录</p></div>
        <Button size="sm" variant="ghost" onClick={() => void onRefresh()}>同步</Button>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        {[[active.length, '进行中'], [jobs.filter((job) => job.status === 'succeeded' && !hasJobFailures(job)).length, '已完成'], [failed.length, '需关注']].map(([count, label]) => (
          <div key={label} className="rounded-xl border border-[#242a36] bg-[#12151c] py-3"><div className="mb-1 text-lg text-slate-100">{count}</div><span className="text-slate-500">{label}</span></div>
        ))}
      </div>
      <div className="flex gap-1 rounded-lg bg-[#12151c] p-1" aria-label="任务筛选">
        {([['all', '最近任务'], ['active', '进行中'], ['failed', '需关注']] as const).map(([key, label]) => (
          <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)} className={clsx('flex-1 rounded-md px-2 py-1.5 text-xs', filter === key ? 'bg-pink-500/15 text-pink-200' : 'text-slate-400 hover:bg-white/5')}>{label}</button>
        ))}
      </div>
      {syncError ? <p role="status" className="text-xs text-amber-300">{syncError}，当前保留上次状态。</p> : null}
      {message ? <p role="status" className="rounded-lg border border-sky-400/20 bg-sky-400/5 p-2 text-xs text-sky-200">{message}</p> : null}
      {list.length === 0 ? <Empty text="这里还没有任务。提交生成后可在此跟踪，不必停留在画布。" /> : null}
      <div className="space-y-2">
        {list.map((job) => <TaskEntry key={job.id} job={job} busyId={busyId} onAction={act}
          retryCount={getCanvasRetryIds(job).filter((id) => latestNodes.get(id)?.jobId === job.id).length} />)}
      </div>
      <p className="text-[10px] leading-relaxed text-slate-600">最近 40 条记录及全部进行中任务。重试会重新调用模型并计费；取消不能保证撤回供应商已接收的请求。</p>
    </section>
  );
}
