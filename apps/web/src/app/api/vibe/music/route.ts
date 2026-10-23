import { cookies } from 'next/headers';
import { uploadVibeMusic, VIBE_MUSIC_MAX_BYTES } from '@sakura/pipeline';
import { redactUrl } from '@sakura/core/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';
import { fail, ok } from '@/lib/server/http';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value)) return fail('未登录或会话已过期', 401);
  const origin = request.headers.get('origin');
  const host = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || request.headers.get('host');
  try {
    if (!origin || (new URL(origin).host !== host && origin !== new URL(request.url).origin
      && origin !== process.env.APP_URL?.replace(/\/$/, ''))) return fail('请求来源无效', 403);
  } catch { return fail('请求来源无效', 403); }
  const reader = request.body?.getReader();
  if (!reader) return fail('缺少音乐文件');
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > VIBE_MUSIC_MAX_BYTES + 64 * 1024) {
        await reader.cancel();
        return fail('音乐文件超过 32 MiB', 413);
      }
      chunks.push(value);
    }
    const body = await new Request(request.url, { method: 'POST', headers: {
      'content-type': request.headers.get('content-type') || '',
    }, body: Buffer.concat(chunks) }).formData();
    const file = body.get('file');
    const projectId = body.get('projectId');
    if (!(file instanceof File) || typeof projectId !== 'string') return fail('缺少项目或音乐文件');
    return ok(await uploadVibeMusic(projectId, file));
  } catch (error) {
    return fail(redactUrl(error instanceof Error ? error.message : String(error)));
  } finally { reader.releaseLock(); }
}