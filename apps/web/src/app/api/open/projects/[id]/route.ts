import { getProject, listJobs } from '@sakura/db';
import { canAccessOpenProject, hasOpenScope, jobStatusLabel, requireOpenApiKey } from '@/lib/server/open-api';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await requireOpenApiKey(request, 'projects:read');
  if (denied) return denied;
  const { id } = await context.params;
  const project = getProject(id);
  if (!project || !canAccessOpenProject(request, id)) return Response.json({ error: '项目不存在或不可访问' }, { status: 404 });
  // 项目读取权限不隐式包含任务状态权限。
  const jobsAllowed = hasOpenScope(request, 'jobs:status');
  return Response.json({ id, name: project.brief.name, stage: project.stage, status: project.status, updatedAt: project.updatedAt,
    reviewRequired: true, jobs: jobsAllowed ? listJobs({ projectId: id, limit: 20 }).map((job) => ({ jobId: job.id, status: jobStatusLabel(job.status), state: job.status, progress: job.progress, updatedAt: job.updatedAt })) : [],
  }, { headers: { 'Cache-Control': 'no-store' } });
}