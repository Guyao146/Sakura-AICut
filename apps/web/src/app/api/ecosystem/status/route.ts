import { findActiveGrant } from '@sakura/db';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  const grant = findActiveGrant(request.headers.get('x-api-key') ?? '');
  return Response.json(grant ? { active: true, grantId: grant.id, scope: grant.scope } : { error: '授权已失效' },
    { status: grant ? 200 : 401, headers: { 'Cache-Control': 'no-store' } });
}