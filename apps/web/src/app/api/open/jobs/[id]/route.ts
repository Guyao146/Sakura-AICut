import { NextResponse } from 'next/server';
import { getJob } from '@sakura/db';
import { jobStatusLabel, requireOpenApiKey } from '@/lib/server/open-api';

/**
 * 开放 API：查询任务状态
 * GET /api/open/jobs/[id] → { jobId, status, error? }
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = requireOpenApiKey(request);
  if (denied) return denied;
  const { id } = await context.params;
  const job = getJob(id);
  if (!job) return NextResponse.json({ error: `任务不存在：${id}` }, { status: 404 });
  return NextResponse.json({
    jobId: job.id,
    status: jobStatusLabel(job.status),
    ...(job.error ? { error: job.error } : {}),
  });
}
