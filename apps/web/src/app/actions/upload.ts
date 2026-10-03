'use server';

import { writeFileSync, mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { dataDir } from '@sakura/db';
import { createId } from '@sakura/core';
import type { MediaFile } from '@sakura/core';
import { createMedia } from '@sakura/db';

/**
 * 处理画布素材上传（图片 / 视频 / 音频）
 * 文件落盘后返回可访问 URL 与元数据
 */
/** 允许上传的扩展名白名单；svg / html 等可被浏览器同源执行的类型一律拒绝（存储型 XSS） */
const ALLOWED_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif',
  '.mp4', '.mov', '.webm', '.mkv',
  '.mp3', '.wav', '.m4a', '.aac', '.flac',
  '.srt', '.txt', '.json',
]);

const MAX_UPLOAD_BYTES = 512 * 1024 * 1024; // 512MB

export async function uploadCanvasMediaAction(
  projectId: string,
  file: File,
): Promise<{ ok: boolean; data?: MediaFile; error?: string }> {
  try {
    if (file.size > MAX_UPLOAD_BYTES) {
      return { ok: false, error: '文件超过 512MB 上限' };
    }

    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // 文件类型判定
    const mime = file.type || 'application/octet-stream';
    let kind: 'image' | 'video' | 'audio' = 'image';
    if (mime.startsWith('video/')) kind = 'video';
    else if (mime.startsWith('audio/')) kind = 'audio';

    // 文件保存
    const ext = extname(file.name).toLowerCase() || (kind === 'image' ? '.jpg' : kind === 'video' ? '.mp4' : '.mp3');
    if (!ALLOWED_EXTS.has(ext)) {
      return { ok: false, error: `不支持的文件类型：${ext || '未知'}` };
    }
    const filename = `${kind}_${createId(10)}${ext}`;
    const mediaDir = join(dataDir(), 'media', projectId);
    mkdirSync(mediaDir, { recursive: true });
    const filepath = join(mediaDir, filename);
    writeFileSync(filepath, bytes);

    // 数据库记录
    const relativePath = join('media', projectId, filename).replace(/\\\\/g, '/');
    const media = createMedia({
      projectId,
      kind,
      url: `/api/files/${relativePath}`,
      path: relativePath,
      mime,
      fileSize: bytes.byteLength,
      ownerType: 'upload',
    });

    return { ok: true, data: media };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[upload]', message);
    return { ok: false, error: message };
  }
}
