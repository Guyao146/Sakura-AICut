import { z } from 'zod';
import { cookies } from 'next/headers';
import { cancelPairing, createPairing, deleteGrant, getPeer, listActivePairings, listGrants, purgeExpiredPairings, revokeGrant, takeEcosystemRateLimit } from '@sakura/db';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';
import type { GrantView, PairingView, SharedTopicView } from '@/lib/ecosystem';
import { normalizePeerUrl, peerJson, PeerError } from './peer-http';

export async function requireEcosystemManager(): Promise<void> {
  if (!verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value)) throw new PeerError('未登录或会话已过期', 401);
}
export function ecosystemView(): { pairings: PairingView[]; grants: GrantView[] } {
  return { pairings: listActivePairings(), grants: listGrants(true) };
}
export function generateEcosystemPairing(input: unknown): PairingView {
  const data = z.object({ name: z.string().trim().min(1).max(80), peerBaseUrl: z.string().min(1).max(2048), allowRender: z.boolean().default(false) }).strict().parse(input);
  if (!takeEcosystemRateLimit('manage', 10)) throw new PeerError('生成配对码过于频繁', 429);
  purgeExpiredPairings();
  return createPairing(data.name, normalizePeerUrl(data.peerBaseUrl), data.allowRender);
}
export async function disconnectEcosystem(id: string): Promise<{ notified: boolean }> {
  const peer = getPeer(id, true);
  revokeGrant(id); // 先本地失效，通知失败不能回滚授权。
  if (!peer) return { notified: false };
  try {
    await peerJson(peer.baseUrl, '/api/ecosystem/revoke', { token: peer.token, body: {} });
    return { notified: true };
  } catch { return { notified: false }; }
}
export function removeEcosystem(id: string): void {
  if (listGrants().some((grant) => grant.id === id)) throw new PeerError('请先吊销授权，再删除记录', 400);
  deleteGrant(id);
}
export { cancelPairing };

const sourceUrl = z.string().max(2048).url().refine((value) => {
  const url = new URL(value);
  return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
});
const topicsSchema = z.object({ topics: z.array(z.object({
  key: z.string().max(500), keyword: z.string().max(40), title: z.string().max(120), reason: z.string().max(1200), sharedAt: z.string().datetime({ offset: true }),
  source: z.object({ id: z.string().max(100), title: z.string().max(80), platform: z.string().max(40).optional(), sourceName: z.string().max(80), sourceUrl, observedAt: z.string().datetime({ offset: true }), kind: z.literal('sourced') }),
})).max(100) });
export async function readPeerTopics(id: string): Promise<SharedTopicView[]> {
  const peer = getPeer(id);
  if (!peer) throw new PeerError('该授权不存在或已吊销', 401);
  const data = topicsSchema.parse(await peerJson(peer.baseUrl, '/api/ecosystem/topics', { token: peer.token }));
  return getPeer(id) ? data.topics : [];
}

export async function boundedJson(request: Request, max = 65_536): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new PeerError('缺少 JSON 请求体', 400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > max) throw new PeerError('请求体超过大小限制', 413);
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof PeerError) throw error;
    throw new PeerError('请求体不是有效 JSON', 400);
  } finally { reader.releaseLock(); }
}
export function ecosystemError(error: unknown): Response {
  return Response.json({ error: error instanceof PeerError ? error.message : error instanceof z.ZodError ? '参数或对端数据格式无效' : '生态服务暂时不可用' },
    { status: error instanceof PeerError ? (error.status >= 400 && error.status <= 599 ? error.status : 502) : error instanceof z.ZodError ? 400 : 503, headers: { 'Cache-Control': 'no-store' } });
}