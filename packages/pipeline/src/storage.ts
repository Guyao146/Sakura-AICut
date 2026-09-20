import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, dirname, join } from 'node:path';
import { createId } from '@sakura/core';
import { downloadToBuffer } from '@sakura/core/server';
import { dataDir } from '@sakura/db';

/**
 * 媒体落盘：把供应商返回的临时链接 / base64 保存到本地数据目录，保证长期可访问
 */

export interface SavedFile {
  /** 可直接访问的 URL（本地为 /api/files/...） */
  url: string;
  /** 相对 data 目录的路径 */
  path: string;
  mime: string;
  fileSize: number;
}

const MIME_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/aac': '.aac',
};

export function mediaRoot(): string {
  const dir = join(dataDir(), 'media');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function extensionFor(mime: string, sourceUrl: string): string {
  const byMime = MIME_EXT[mime.split(';')[0]?.trim() ?? ''];
  if (byMime) return byMime;
  const fromUrl = extname(sourceUrl.split('?')[0] ?? '').toLowerCase();
  if (fromUrl && fromUrl.length <= 5) return fromUrl;
  return '.bin';
}

function parseDataUri(uri: string): { mime: string; buffer: Uint8Array } | null {
  const match = uri.match(/^data:([^;]+);base64,(.*)$/);
  if (!match) return null;
  return { mime: match[1] ?? 'application/octet-stream', buffer: Buffer.from(match[2] ?? '', 'base64') };
}

/**
 * 保存图片/视频到本地
 * @param source 远端 URL 或 data URI
 */
export async function saveMedia(
  projectId: string,
  kind: 'image' | 'video' | 'audio' | 'other',
  source: string,
  options: { mime?: string; filename?: string } = {},
): Promise<SavedFile> {
  const dir = join(mediaRoot(), projectId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const dataUri = parseDataUri(source);
  let buffer: Uint8Array;
  let mime = options.mime ?? 'application/octet-stream';

  if (dataUri) {
    buffer = dataUri.buffer;
    mime = options.mime ?? dataUri.mime;
  } else {
    const downloaded = await downloadToBuffer(source);
    buffer = downloaded.buffer;
    mime = options.mime ?? downloaded.contentType;
  }

  const filename = options.filename ?? `${kind}_${createId(10)}${extensionFor(mime, source)}`;
  const absolute = join(dir, filename);
  writeFileSync(absolute, buffer);

  // path / url 必须带 media 前缀，与 upload 动作及 /api/files 路由、resolveMediaPath 的解析口径一致
  const relative = join('media', projectId, filename).replace(/\\/g, '/');
  return { url: `/api/files/${relative}`, path: relative, mime, fileSize: buffer.byteLength };
}

/** 把外部文件写入数据目录（例如用户上传） */
export function saveBufferToData(relativePath: string, buffer: Uint8Array): SavedFile {
  const absolute = join(dataDir(), relativePath);
  const dir = dirname(absolute);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(absolute, buffer);
  return {
    url: `/api/files/${relativePath.replace(/\\/g, '/')}`,
    path: relativePath.replace(/\\/g, '/'),
    mime: 'application/octet-stream',
    fileSize: buffer.byteLength,
  };
}

/** 数据目录内的相对路径 → 绝对路径 */
export function absolutePathOf(relativePath: string): string {
  return join(dataDir(), relativePath);
}

/**
 * 读取本地媒体并转成 data URI
 * 用于把首帧图/参考图直接内联给供应商（避免其无法访问内网地址）
 */
export function readAsDataUri(relativePath: string, fallbackMime = 'image/png'): string | null {
  const absolute = absolutePathOf(relativePath);
  if (!existsSync(absolute)) return null;
  const ext = extname(absolute).toLowerCase();
  const mime = MIME_BY_EXT[ext] ?? fallbackMime;
  const base64 = readFileSync(absolute).toString('base64');
  return `data:${mime};base64,${base64}`;
}

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
};

/** 由媒体记录推断本地绝对路径；没有本地文件时返回 null */
export function resolveMediaPath(path: string | null | undefined): string | null {
  if (!path) return null;
  const absolute = absolutePathOf(path);
  return existsSync(absolute) ? absolute : null;
}
