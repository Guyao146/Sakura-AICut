import { listJobEvents, listJobs } from '@sakura/db';
import { handler, ok, readJson } from '@/lib/server/http';
import { cancelJob } from '@sakura/db';

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
  const limit = Number(url.searchParams.get('limit') ?? 40);

  const jobs = listJobs({
    projectId,
    limit,
    ...(activeOnly ? { status: ['pending', 'queued', 'running'] as const } : {}),
  });

  return ok(
    jobs.map((job) => ({
      ...job,
      events: listJobEvents(job.id, 12),
    })),
  );
});

export const POST = handler<[Request]>(async (request) => {
  const body = await readJson<{ jobId?: string }>(request);
  if (!body.jobId) return ok({ canceled: false, message: '缺少 jobId' });
  const job = cancelJob(body.jobId);
  return ok({ canceled: Boolean(job && job.status === 'canceled'), job });
});
