import { NextResponse } from 'next/server';
import { getProject } from '@sakura/db';
import { enqueueTimelineRender } from '@/lib/server/jobs';
import { jobStatusLabel, requireOpenApiKey } from '@/lib/server/open-api';

/**
 * 开放 API：提交时间线渲染导出任务
 * 与 Server Action 共用 enqueueTimelineRender；includeSubtitles / preset
 * 缺省时沿用其默认值（true / vertical-1080p）。
 * POST /api/open/jobs {projectId, includeSubtitles?, preset?} → { jobId, status }
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const denied = requireOpenApiKey(request);
  if (denied) return denied;
  let body: { projectId?: unknown; includeSubtitles?: unknown; preset?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // 空 / 非 JSON 请求体按缺少参数处理
  }
  const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : '';
  if (!projectId) return NextResponse.json({ error: 'projectId 为必填非空字符串' }, { status: 400 });
  if (!getProject(projectId)) return NextResponse.json({ error: `项目不存在：${projectId}` }, { status: 404 });
  const options: { includeSubtitles?: boolean; preset?: string } = {};
  if (typeof body.includeSubtitles === 'boolean') options.includeSubtitles = body.includeSubtitles;
  if (typeof body.preset === 'string' && body.preset.trim()) options.preset = body.preset.trim();
  const job = enqueueTimelineRender(projectId, options);
  return NextResponse.json({ jobId: job.id, status: jobStatusLabel(job.status) }, { status: 201 });
}
