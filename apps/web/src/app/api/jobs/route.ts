import type { Job } from '@sakura/core';
import { cancelAgentPlan, cancelJob, getAsset, getJobsByIds, getJob, getShot, listJobEventsForJobs, listJobs, updateAsset, updateShot } from '@sakura/db';
import { handler, ok, fail, readJson } from '@/lib/server/http';

/**
 * 任务轮询接口
 * GET  /api/jobs?projectId=xxx&activeOnly=1   → 任务列表（含最近事件）
 * POST /api/jobs                              → 取消任务 { jobId }
 */

export const dynamic = 'force-dynamic';

export const GET = handler<[Request]>(async (request) => {
  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId') ?? undefined;
  const activeOnly = url.searchParams.get('activeOnly') === '1';
  const requestedLimit = Number(url.searchParams.get('limit') ?? 40);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(100, Math.floor(requestedLimit))) : 40;
  const recent = listJobs({
    projectId, limit,
    ...(activeOnly ? { status: ['pending', 'queued', 'running'] as const } : {}),
  });
  // 历史列表分页不能把仍在执行的老任务挤掉；跟踪本次刚结束的任务也不受 limit 影响。
  const active = url.searchParams.get('includeActive') === '1'
    ? listJobs({ projectId, status: ['pending', 'queued', 'running'], limit: -1 }) : [];
  const trackedIds = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean).slice(0, 100);
  const tracked = getJobsByIds(trackedIds).filter((job) => !projectId || job.projectId === projectId);
  const jobs = [...new Map([...recent, ...active, ...tracked].map((job) => [job.id, job])).values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // 一次性取齐所有任务的最近事件，避免逐任务 N+1 查询
  const events = listJobEventsForJobs(jobs.map((job) => job.id), 12);

  return ok(
    jobs.map((job) => ({
      ...job,
      events: events[job.id] ?? [],
    })),
  );
});

export const POST = handler<[Request]>(async (request) => {
  const body = await readJson<{ jobId?: string; projectId?: string }>(request);
  if (!body || typeof body.jobId !== 'string' || !body.jobId) return fail('缺少 jobId', 400);
  const existing = getJob(body.jobId);
  if (!existing || (body.projectId && existing.projectId !== body.projectId)) return fail('任务不存在', 404);
  const job = cancelJob(existing.id);
  if (job?.status === 'canceled') {
    if (job.type === 'agent.run' && job.targetId) {
      cancelAgentPlan(job.targetId, job.id);
    } else {
      releaseQueuedTargets(job);
    }
  }
  return ok({ canceled: job?.status === 'canceled', job });
});

/**
 * 取消入队型任务（资产生图 / 镜头片段）时，把「已排队但从未开始」的目标实体回收。
 * 否则它们会永远卡在「排队中」，而批量任务里它们也永远不会被执行。
 * 正在跑的那一个不回收：已经发出去的模型请求可能仍会完成并计费，保留它的真实终态。
 */
function releaseQueuedTargets(job: Job): number {
  const projectId = job.projectId;
  if (!projectId) return 0;
  if (job.type !== 'asset.prepare' && job.type !== 'image.generate'
    && job.type !== 'shot.batchGenerate' && job.type !== 'video.generate') return 0;

  const targets: { id: string; kind: 'asset' | 'shot' }[] = jobTargetIds(job).map((id) => ({
    id,
    kind: job.type === 'video.generate' || job.type === 'shot.batchGenerate' ? 'shot' : 'asset',
  }));

  // 同项目里还有别的任务正在排队这些目标，说明用户已经重新提交，不要误回收
  const stillQueued = new Set<string>();
  for (const other of listJobs({ projectId, status: ['pending', 'queued', 'running'], limit: -1 })) {
    if (other.id === job.id) continue;
    for (const id of jobTargetIds(other)) if (targets.some((target) => target.id === id)) stillQueued.add(id);
  }

  let released = 0;
  for (const target of targets) {
    if (stillQueued.has(target.id)) continue;
    if (target.kind === 'asset') {
      const asset = getAsset(target.id);
      if (!asset || asset.status !== 'queued') continue;
      updateAsset(target.id, { status: asset.mediaIds.length > 0 ? 'succeeded' : 'pending', error: null });
    } else {
      const shot = getShot(target.id);
      if (!shot || shot.status !== 'queued') continue;
      updateShot(target.id, { status: shot.clipMediaIds.length > 0 ? 'succeeded' : 'pending', error: null });
    }
    released += 1;
  }
  return released;
}

/** 取出某个入队型任务真正会处理的目标实体 id（资产或镜头） */
function jobTargetIds(job: Job): string[] {
  const payload = (job.payload ?? {}) as Record<string, unknown>;
  if (typeof payload.assetId === 'string') return [payload.assetId];
  if (Array.isArray(payload.assetIds)) return payload.assetIds.filter((id): id is string => typeof id === 'string');
  if (typeof payload.shotId === 'string') return [payload.shotId];
  if (Array.isArray(payload.shotIds)) return payload.shotIds.filter((id): id is string => typeof id === 'string');
  return [];
}
