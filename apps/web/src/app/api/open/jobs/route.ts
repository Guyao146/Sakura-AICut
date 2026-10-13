import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getProject, transaction } from '@sakura/db';
import { enqueueTimelineRender } from '@/lib/server/jobs';
import { canAccessOpenProject, hasOpenScope, jobStatusLabel, requireOpenApiKey } from '@/lib/server/open-api';
import { boundedJson, ecosystemError } from '@/lib/server/ecosystem';
import { PeerError } from '@/lib/server/peer-http';

/**
 * 开放 API：提交时间线渲染导出任务
 * 与 Server Action 共用 enqueueTimelineRender；includeSubtitles / preset
 * 缺省时沿用其默认值（true / vertical-1080p）。
 * POST /api/open/jobs {projectId, includeSubtitles?, preset?} → { jobId, status }
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const denied = await requireOpenApiKey(request, 'jobs:submit');
    if (denied) return denied;
    const input = z.object({ projectId: z.string().trim().min(1).max(200), includeSubtitles: z.boolean().optional(), preset: z.string().trim().min(1).max(100).optional() })
      .strict().parse(await boundedJson(request, 4096));
    const job = transaction(() => {
      if (!hasOpenScope(request, 'jobs:submit')) throw new PeerError('授权已失效', 401);
      if (!getProject(input.projectId) || !canAccessOpenProject(request, input.projectId)) throw new PeerError('项目不存在或不可访问', 404);
      return enqueueTimelineRender(input.projectId, { includeSubtitles: input.includeSubtitles, preset: input.preset });
    });
    return NextResponse.json({ jobId: job.id, status: jobStatusLabel(job.status) }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return ecosystemError(error); }
}
