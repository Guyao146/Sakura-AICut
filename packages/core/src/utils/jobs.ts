import type { Job } from '../types/job';

export interface CanvasJobResult {
  itemId: string;
  ok: boolean;
  error?: string;
}

export interface CanvasNodeJobState {
  jobId: string;
  status: Job['status'];
  progress: number;
  label: string;
  error?: string;
}

export function isActiveJob(job: Pick<Job, 'status'>): boolean {
  return job.status === 'pending' || job.status === 'queued' || job.status === 'running';
}

export function getCanvasJobItemIds(job: Pick<Job, 'type' | 'payload'>): string[] {
  if (job.type !== 'canvas.generate' || !job.payload || typeof job.payload !== 'object') return [];
  const ids = (job.payload as Record<string, unknown>).canvasItemIds;
  return Array.isArray(ids) ? [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))] : [];
}

export function getCanvasJobResults(job: Pick<Job, 'result'>): CanvasJobResult[] {
  const results = job.result?.results;
  if (!Array.isArray(results)) return [];
  return results.filter((entry): entry is CanvasJobResult => Boolean(
    entry && typeof entry === 'object' && typeof entry.itemId === 'string' && typeof entry.ok === 'boolean',
  ));
}

/** 批次任务可能成功结束，但其中个别节点失败；不能只看 job.status。 */
export function hasJobFailures(job: Pick<Job, 'status' | 'result'>): boolean {
  return job.status === 'failed' || job.result?.status === 'failed'
    || (typeof job.result?.failed === 'number' && job.result.failed > 0)
    || (Array.isArray(job.result?.failed) && job.result.failed.length > 0)
    || (Array.isArray(job.result?.results) && job.result.results.some((entry) => entry?.ok === false));
}

/** 仅重试失败/未完成项，绝不重复生成已经成功的节点。 */
export function getCanvasRetryIds(job: Job): string[] {
  if (isActiveJob(job)) return [];
  const results = new Map(getCanvasJobResults(job).map((entry) => [entry.itemId, entry]));
  return getCanvasJobItemIds(job).filter((id) => {
    const result = results.get(id);
    if (result?.ok) return false;
    return result?.ok === false || job.status === 'failed' || job.status === 'canceled';
  });
}

/** 以真实任务为准，既支持刷新恢复，也支持已有图片的再次生成。 */
export function getCanvasNodeJobStates(jobs: Job[], projectId: string): Map<string, CanvasNodeJobState> {
  const states = new Map<string, CanvasNodeJobState>();
  // 正在执行的任务优先，其次取创建时间较新的任务，不受心跳时间影响。
  const sorted = jobs.filter((job) => job.projectId === projectId).slice().sort((a, b) =>
    Number(isActiveJob(b)) - Number(isActiveJob(a)) || b.createdAt.localeCompare(a.createdAt),
  );
  for (const job of sorted) {
    const results = new Map(getCanvasJobResults(job).map((entry) => [entry.itemId, entry]));
    for (const id of getCanvasJobItemIds(job)) {
      if (states.has(id)) continue;
      const result = results.get(id);
      const active = isActiveJob(job);
      const current = job.result?.currentItemId;
      const status = result ? (result.ok ? 'succeeded' : 'failed')
        : active && job.status === 'running' && typeof current === 'string' && current !== id ? 'queued'
          : job.status;
      const error = typeof result?.error === 'string' ? result.error : job.error ?? undefined;
      const label = status === 'succeeded' ? '已完成' : status === 'failed' ? '生成失败'
        : status === 'canceled' ? '已取消' : status === 'running' ? '生成中'
          : job.error ? '等待自动重试' : '排队中';
      states.set(id, {
        jobId: job.id, status, label,
        progress: result?.ok ? 100 : Math.max(0, Math.min(100, Number.isFinite(job.progress) ? job.progress : 0)),
        ...(error ? { error } : {}),
      });
    }
  }
  return states;
}

/** 合并轮询快照；请求发出后提交/取消的任务不能被旧响应覆盖，也不能重复出现。 */
export function mergeJobSnapshot<T extends Job>(
  incoming: T[],
  accepted: Map<string, T>,
  acceptedAtStart: ReadonlyMap<string, T>,
): T[] {
  for (const job of incoming) {
    const local = accepted.get(job.id);
    if (local && local === acceptedAtStart.get(job.id) && job.updatedAt >= local.updatedAt) {
      accepted.delete(job.id);
    }
  }
  return [...accepted.values(), ...incoming.filter((job) => !accepted.has(job.id))];
}

/** 心跳不触发全页刷新；逐节点产物、Agent 步骤和任务结果变化才刷新。 */
export function jobRefreshKey(jobs: Job[]): string {
  return JSON.stringify(jobs.slice().sort((a, b) => a.id.localeCompare(b.id)).map((job) => [
    job.id, job.status, job.progress, job.stageLabel, job.result, job.error,
  ]));
}
