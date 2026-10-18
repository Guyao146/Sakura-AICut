import {
  canAccessOpenProject,
  hasOpenScope,
  openOwner,
  requireOpenApiKey,
} from '@/lib/server/open-api';
import { boundedJson, ecosystemError } from '@/lib/server/ecosystem';
import { openScreenplaySchema } from '@/lib/server/open-projects';
import { PeerError } from '@/lib/server/peer-http';
import { buildScreenplayDraft, screenplaySnapshotJson } from '@sakura/pipeline';
import {
  createScreenplayImport,
  createScreenplayVersion,
  findScreenplayImport,
  getProject,
  getScreenplay,
  takeEcosystemRateLimit,
  transaction,
  upsertScreenplay,
} from '@sakura/db';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };

/**
 * 把外部创作包的剧本草稿写入当前剧本：
 * 只写原文、梗概和镜头节拍，并落一版来源记录；人物卡、场景卡、道具卡与制作镜头一律不创建。
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const denied = await requireOpenApiKey(request, 'screenplay:import');
    if (denied) return denied;
    if (!takeEcosystemRateLimit('screenplay-import', 20)) throw new PeerError('导入请求过于频繁，请稍后重试', 429);
    const { id } = await context.params;
    const input = openScreenplaySchema.parse(await boundedJson(request));
    const requestId = request.headers.get('idempotency-key') ?? '';
    if (!requestId) throw new PeerError('剧本导入必须携带幂等标识', 400);
    if (!/^[\w:-]{1,160}$/.test(requestId)) throw new PeerError('幂等标识无效', 400);
    const owner = openOwner(request);
    const record = transaction(() => {
      // 读取正文期间授权可能已撤销或降权，与写入同事务再校验一次。
      if (!owner) throw new PeerError('授权已失效', 401);
      if (!hasOpenScope(request, 'screenplay:import')) throw new PeerError('授权范围不足', 403);
      const project = getProject(id);
      if (!project || !canAccessOpenProject(request, id)) throw new PeerError('项目不存在或不可访问', 404);
      const replay = findScreenplayImport(owner, requestId);
      if (replay) {
        if (replay.projectId !== id) throw new PeerError('幂等标识已用于其他项目', 409);
        return { ...replay, created: false };
      }
      if (getScreenplay(id)) throw new PeerError('项目已有剧本，不能导入草稿覆盖；请在制作端人工合并', 409);
      if (project.stage !== 'brief' && project.stage !== 'script') throw new PeerError('项目已进入制作后期，不再接受剧本草稿导入', 409);
      const screenplay = upsertScreenplay(id, buildScreenplayDraft(input));
      const version = createScreenplayVersion({
        projectId: id,
        title: '导入自 SakuraSeeking · 待人工审核',
        raw: screenplay.raw ?? '',
        dataJson: screenplaySnapshotJson(screenplay),
        source: 'manual',
      });
      const imported = createScreenplayImport({ grantId: owner, projectId: id, idempotencyKey: requestId, screenplayId: screenplay.id, version: version.version });
      return { ...imported, created: true };
    });
    return Response.json({ id, screenplayId: record.screenplayId, version: record.version, importedAt: record.importedAt,
      imported: true, reviewRequired: true, repeated: !record.created }, { status: record.created ? 201 : 200, headers });
  } catch (error) { return ecosystemError(error); }
}