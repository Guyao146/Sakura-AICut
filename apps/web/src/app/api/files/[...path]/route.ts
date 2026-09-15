import { readFile, stat } from 'node:fs/promises';
import { extname, normalize, join } from 'node:path';
import { dataDir } from '@sakura/db';

/**
 * 本地媒体文件服务：/api/files/<相对路径>
 * 支持 Range 请求（视频拖动进度条必需）
 */

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.srt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const root = dataDir();
  const relative = normalize(path.join('/')).replace(/\\/g, '/');
  const absolute = join(root, relative);

  if (!absolute.startsWith(root)) {
    return new Response('禁止访问该路径', { status: 403 });
  }

  let size = 0;
  try {
    const info = await stat(absolute);
    if (!info.isFile()) return new Response('文件不存在', { status: 404 });
    size = info.size;
  } catch {
    return new Response('文件不存在', { status: 404 });
  }

  const contentType = MIME[extname(absolute).toLowerCase()] ?? 'application/octet-stream';
  const range = request.headers.get('range');

  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      if (Number.isFinite(start) && start <= end) {
        const chunk = new Uint8Array(await readFile(absolute)).slice(start, end + 1);
        return new Response(chunk, {
          status: 206,
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(chunk.byteLength),
            'Content-Range': `bytes ${start}-${end}/${size}`,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        });
      }
    }
  }

  const buffer = new Uint8Array(await readFile(absolute));
  return new Response(buffer, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(buffer.byteLength),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
