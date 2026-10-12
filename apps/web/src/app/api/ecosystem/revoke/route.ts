import { findActiveGrant, revokeGrant } from '@sakura/db';
export const dynamic = 'force-dynamic';
export function POST(request: Request) {
  const grant = findActiveGrant(request.headers.get('x-api-key') ?? '');
  if (!grant) return Response.json({ error: '授权已失效' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  revokeGrant(grant.id);
  return Response.json({ revoked: true }, { headers: { 'Cache-Control': 'no-store' } });
}