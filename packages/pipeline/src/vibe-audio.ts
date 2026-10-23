import { rmSync } from 'node:fs';
import { extname } from 'node:path';
import { createId, vibeDubbingSchema, type MediaFile } from '@sakura/core';
import { downloadToBuffer } from '@sakura/core/server';
import { createMedia, getProject } from '@sakura/db';
import { routeFor, runAudio } from './ai';
import { absolutePathOf, saveBufferToData } from './storage';
import { assertVibeIdle, requireVibeProject } from './vibe-jobs';

export const VIBE_MUSIC_MAX_BYTES = 32 * 1024 * 1024;
const AUDIO_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.aac': 'audio/aac', '.flac': 'audio/flac', '.ogg': 'audio/ogg',
};

export async function uploadVibeMusic(projectId: string, file: File): Promise<MediaFile> {
  assertVibeIdle(projectId);
  const ext = extname(file.name).toLowerCase();
  const mime = AUDIO_TYPES[ext];
  if (!mime) throw new Error('请上传 MP3、WAV、M4A、AAC、FLAC 或 OGG 音频');
  if (!file.size || file.size > VIBE_MUSIC_MAX_BYTES) throw new Error('音乐文件不能为空或超过 32 MiB');
  const buffer = new Uint8Array(await file.arrayBuffer());
  assertVibeIdle(projectId);
  const path = `media/${projectId}/music_${createId(16)}${ext}`;
  const saved = saveBufferToData(path, buffer);
  try {
    return createMedia({ ...saved, mime, projectId, kind: 'audio', ownerType: 'upload', prompt: file.name.slice(0, 200) });
  } catch (error) { rmSync(absolutePathOf(path), { force: true }); throw error; }
}

export async function vibeVoiceOptions(projectId: string) {
  requireVibeProject(projectId);
  const route = routeFor('audio');
  if (!route.adapter.audio) throw new Error('当前语音模型不支持配音，请在设置中更换');
  return {
    model: route.model.id,
    voices: route.adapter.listVoices ? await route.adapter.listVoices(route.ctx) : [],
    supportsVoiceList: Boolean(route.adapter.listVoices),
    minSpeed: route.adapter.audioSpeedRange?.min ?? 0.25,
    maxSpeed: route.adapter.audioSpeedRange?.max ?? 4,
  };
}

export async function previewVibeVoice(projectId: string, value: unknown, text: string): Promise<string> {
  requireVibeProject(projectId);
  const settings = vibeDubbingSchema.parse(value);
  if (typeof text !== 'string' || !text.trim() || text.length > 120) throw new Error('试听文本需为 1–120 字');
  const audio = await runAudio({ input: text.trim(), voice: settings.voice || undefined, speed: settings.speed,
    volume: settings.volume, pitch: settings.pitch, language: getProject(projectId)!.brief.language, format: 'mp3' });
  const source = audio.b64 || audio.url;
  if (!source) throw new Error('试听未返回音频');
  if (source.startsWith('data:audio/')) {
    if (source.length > 12 * 1024 * 1024) throw new Error('试听音频超过大小限制');
    return source;
  }
  const result = await downloadToBuffer(source, { timeoutMs: 120_000 });
  if (result.buffer.byteLength > 8 * 1024 * 1024) throw new Error('试听音频超过大小限制');
  return `data:audio/${audio.format || 'mp3'};base64,${Buffer.from(result.buffer).toString('base64')}`;
}