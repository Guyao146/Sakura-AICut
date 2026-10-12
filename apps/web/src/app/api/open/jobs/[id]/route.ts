import { NextResponse } from 'next/server';
import { getJob } from '@sakura/db';
import { canAccessOpenProject, jobStatusLabel, requireOpenApiKey, staticOpenKey } from '@/lib/server/open-api';

/**
 * 开放 API：查询任务状态
 * GET /api/open/jobs/[id] → { jobId, status, error? }
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await requireOpenApiKey(request, 'jobs:status');
  if (denied) return denied;
  const { id } = await context.params;
  const job = getJob(id);
  if (!job || (!staticOpenKey(request) && (!job.projectId || !canAccessOpenProject(request, job.projectId)))) return NextResponse.json({ error: '任务不存在或不可访问' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  return NextResponse.json({
    jobId: job.id,
    status: jobStatusLabel(job.status),
    state: job.status,
    progress: job.progress,
    ...(job.error ? { error: '任务失败，请在制作端查看详情' } : {}),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
