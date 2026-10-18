import { NextResponse } from 'next/server';
import type { TaskStatus } from '@sakura/core';
import { safeCompare } from '@sakura/core/server';
import { ecosystemDigest, findActiveGrant, getPeer, ownsEcosystemProject, revokeGrant } from '@sakura/db';
import { peerJson, PeerError } from './peer-http';
import { z } from 'zod';

/**
 * 开放 API（/api/open/*）共用工具：X-API-Key 鉴权与任务状态可读映射。
 * 独立于会话体系：凭 AICUT_OPEN_API_KEYS（逗号分隔多 key）鉴权，
 * 静态 Key 与配对 Key 独立生效；未提供有效凭证时一律 401。
 * 除了静态密钥，还接受生态授权（配对码握手）颁发的动态凭证，
 * 两者命中其一即放行，动态凭证可随时在设置页吊销。
 */

export type OpenScope = 'projects:read' | 'projects:create' | 'jobs:submit' | 'jobs:status' | 'screenplay:import';
export function staticOpenKey(request: Request): boolean {
  const provided = request.headers.get('x-api-key')?.trim() ?? '';
  return Boolean(provided) && (process.env.AICUT_OPEN_API_KEYS ?? '').split(',').map((key) => key.trim()).filter(Boolean).some((key) => safeCompare(key, provided));
}
export function openOwner(request: Request): string {
  const key = request.headers.get('x-api-key')?.trim() ?? '';
  return staticOpenKey(request) ? `static:${ecosystemDigest(key)}` : findActiveGrant(key)?.id ?? '';
}
export function canAccessOpenProject(request: Request, projectId: string): boolean {
  return staticOpenKey(request) || ownsEcosystemProject(projectId, openOwner(request));
}
export function hasOpenScope(request: Request, scope: OpenScope): boolean {
  return staticOpenKey(request) || Boolean(findActiveGrant(request.headers.get('x-api-key')?.trim() ?? '')?.scope.split(' ').includes(scope));
}
export async function requireOpenApiKey(request: Request, scope: OpenScope): Promise<NextResponse | null> {
  if (staticOpenKey(request)) return null;
  const key = request.headers.get('x-api-key')?.trim() ?? '';
  const grant = findActiveGrant(key);
  const deny = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
  if (!grant) return deny('无效或已撤销的 API Key', 401);
  if (!grant.scope.split(' ').includes(scope)) return deny('授权范围不足', 403);
  const peer = getPeer(grant.id);
  if (!peer) return deny('对端凭证不可用，请重新配对', 401);
  try {
    const status = z.object({ active: z.literal(true), grantId: z.string() }).parse(await peerJson(peer.baseUrl, '/api/ecosystem/status', { token: peer.token }));
    if (status.grantId !== grant.id || !findActiveGrant(key)) return deny('授权已撤销', 401);
  } catch (error) {
    if (error instanceof PeerError && error.status === 401) { revokeGrant(grant.id); return deny('对端授权已撤销', 401); }
    return deny('无法验证对端授权，请确认双方服务在线', 503);
  }
  return null;
}

const JOB_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: '排队',
  queued: '排队',
  running: '运行中',
  succeeded: '成功',
  failed: '失败',
  canceled: '已取消',
};

export function jobStatusLabel(status: TaskStatus): string {
  return JOB_STATUS_LABELS[status];
}
