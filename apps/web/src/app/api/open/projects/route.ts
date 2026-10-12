import { createProject, findEcosystemProject, getProject, linkEcosystemProject, listProjects, transaction } from '@sakura/db';
import { canAccessOpenProject, hasOpenScope, openOwner, requireOpenApiKey } from '@/lib/server/open-api';
import { boundedJson, ecosystemError } from '@/lib/server/ecosystem';
import { openProjectSchema } from '@/lib/server/open-projects';
import { PeerError } from '@/lib/server/peer-http';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
export async function GET(request: Request) {
  const denied = await requireOpenApiKey(request, 'projects:read');
  if (denied) return denied;
  const limit = Math.min(100, Math.max(1, Number(new URL(request.url).searchParams.get('limit')) || 100));
  return Response.json({ projects: listProjects().filter((project) => canAccessOpenProject(request, project.id)).slice(0, limit)
    .map((project) => ({ id: project.id, name: project.brief.name, updatedAt: project.updatedAt })) }, { headers });
}
export async function POST(request: Request) {
  try {
    const denied = await requireOpenApiKey(request, 'projects:create');
    if (denied) return denied;
    const input = openProjectSchema.parse(await boundedJson(request));
    const requestId = request.headers.get('idempotency-key') ?? undefined;
    if (requestId && !/^[\w:-]{1,160}$/.test(requestId)) throw new PeerError('幂等标识无效', 400);
    const owner = openOwner(request);
    const project = transaction(() => {
      // 读取正文期间授权可能已撤销；与创建在同一写事务中再次校验。
      if (!owner || !hasOpenScope(request, 'projects:create')) throw new PeerError('授权已失效', 401);
      const existingId = requestId ? findEcosystemProject(owner, requestId) : null;
      if (existingId) return getProject(existingId)!;
      const created = createProject({ name: input.name, ...input.brief });
      linkEcosystemProject(created.id, owner, requestId);
      return created;
    });
    return Response.json({ id: project.id, name: project.brief.name, imported: false, reviewRequired: true }, { status: 201, headers });
  } catch (error) { return ecosystemError(error); }
}