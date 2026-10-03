import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { extname, join, normalize, sep } from 'node:path';
import { dataDir } from '@sakura/db';

/**
 * 本地媒体文件服务：/api/files/media/<项目>/<文件>
 * 支持 Range 请求（视频拖动进度条必需）
 *
 * 安全边界：只允许读取 <dataDir>/media 下的文件。数据目录里还有 SQLite 库
 * （含供应商 API Key 等加密凭证）与密钥文件，绝不能通过本路由外泄。
 */

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  // 不提供 image/svg+xml：SVG 可内嵌脚本并被浏览器同源执行，构成存储型 XSS。
  // 上传侧也已拒绝 .svg；磁盘上若有历史 svg，统一按二进制流返回。
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

const MEDIA_ROOT = join(dataDir(), 'media');

/** 把 URL 段解析成 media 目录内的绝对路径；越界或穿越返回 null */
function resolveMediaPath(segments: string[]): string | null {
  const relative = normalize(segments.join('/')).replace(/\\/g, '/');
  if (relative.includes('..') || relative.startsWith('/')) return null;
  const absolute = join(MEDIA_ROOT, relative);
  const boundary = MEDIA_ROOT.endsWith(sep) ? MEDIA_ROOT : MEDIA_ROOT + sep;
  if (absolute !== MEDIA_ROOT && !absolute.startsWith(boundary)) return null;
  return absolute;
}

function streamFile(
  absolute: string,
  start: number,
  end: number,
  size: number,
  contentType: string,
  status = 200,
): Response {
  const body = Readable.toWeb(createReadStream(absolute, { start, end })) as ReadableStream<Uint8Array>;
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Content-Length': String(end - start + 1),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=31536000, immutable',
  };
  if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  return new Response(body, { status, headers });
}

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const absolute = resolveMediaPath(path);
  if (!absolute) return new Response('禁止访问该路径', { status: 403 });

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
      if (Number.isFinite(start) && start >= 0 && start < size) {
        const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
        return streamFile(absolute, start, end, size, contentType, 206);
      }
    }
  }

  return streamFile(absolute, 0, size - 1, size, contentType);
}
