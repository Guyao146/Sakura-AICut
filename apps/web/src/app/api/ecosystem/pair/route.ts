import { z } from 'zod';
import { consumePairing, takeEcosystemRateLimit } from '@sakura/db';
import { boundedJson, ecosystemError } from '@/lib/server/ecosystem';
import { normalizePeerUrl, PeerError } from '@/lib/server/peer-http';

export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    if (!takeEcosystemRateLimit('pair', 12)) return Response.json({ error: '配对操作过于频繁，请稍后重试' }, { status: 429, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' } });
    const input = z.object({ code: z.string().trim().toUpperCase().regex(/^[23456789A-HJ-NP-Z]{6}$/),
      clientName: z.string().trim().min(1).max(80), kind: z.string().trim().min(1).max(40).default('external'),
      peerBaseUrl: z.string().max(2048), peerToken: z.string().regex(/^[\w-]{32,256}$/),
    }).strict().parse(await boundedJson(request, 4096));
    const peerBaseUrl = normalizePeerUrl(input.peerBaseUrl);
    let grant;
    try { grant = consumePairing({ ...input, peerBaseUrl }); }
    catch { throw new PeerError('配对码无效、已使用、已过期，或名称/地址不匹配', 400); }
    return Response.json({ grantId: grant.id, name: grant.name, apiKey: grant.apiKey, scope: grant.scope,
      capabilities: grant.scope.split(' '), reverseScope: 'topics:read', imported: false, reviewRequired: true,
    }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return ecosystemError(error); }
}