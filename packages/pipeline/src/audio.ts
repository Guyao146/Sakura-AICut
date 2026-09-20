import type { Language, MediaFile, Shot } from '@sakura/core';
import {
  createMedia,
  getCanvasItem,
  getShot,
  listShots,
  loadContent,
  updateCanvasItem,
  updateShot,
} from '@sakura/db';
import { runAudio } from './ai';
import { saveMedia } from './storage';

/**
 * 音频生成：台词配音（TTS）与画布语音合成
 *
 * 音色来源优先级：显式传入 > 出场角色的 voiceStyle > 供应商默认。
 */

/** 常用 OpenAI 兼容音色（alloy 系中性、nova 女声、onyx 男声） */
export const TTS_VOICES: Array<{ id: string; label: string; gender: 'male' | 'female' | 'neutral' }> = [
  { id: 'alloy', label: 'Alloy · 中性', gender: 'neutral' },
  { id: 'echo', label: 'Echo · 男声', gender: 'male' },
  { id: 'fable', label: 'Fable · 中性', gender: 'neutral' },
  { id: 'onyx', label: 'Onyx · 男声', gender: 'male' },
  { id: 'nova', label: 'Nova · 女声', gender: 'female' },
  { id: 'shimmer', label: 'Shimmer · 女声', gender: 'female' },
];

export interface DubbingOptions {
  /** 显式音色 ID */
  voice?: string;
  /** 合成语言（一键出海：20 种语言，透传给 TTS 模型） */
  language?: Language;
  /** 语速 0.25-4 */
  speed?: number;
  /** 音量 0-2 */
  volume?: number;
  /** 覆盖合成文本（默认用台词，其次旁白） */
  text?: string;
  /** 输出格式 */
  format?: 'mp3' | 'wav' | 'aac';
}

/** 查询镜头配音可用的音色：出场角色的 voiceStyle 优先 */
export function resolveDubbingVoice(
  shot: Shot,
  characters: Array<{ id: string; voiceStyle?: string | null }>,
): string | undefined {
  for (const characterId of shot.characterIds) {
    const character = characters.find((item) => item.id === characterId);
    if (character?.voiceStyle) return character.voiceStyle;
  }
  return undefined;
}

/** 取镜头要合成的文本：台词优先，其次旁白 */
export function shotDubbingText(shot: Shot): string {
  return (shot.dialogue || shot.narration || '').trim();
}

/** 音频格式 → MIME（mp3 的标准 MIME 是 audio/mpeg） */
function mimeForAudio(format: string | undefined): string {
  if (format === 'mp3') return 'audio/mpeg';
  if (format === 'aac') return 'audio/aac';
  if (format === 'flac') return 'audio/flac';
  if (format === 'opus') return 'audio/ogg';
  return 'audio/mpeg';
}

/**
 * 为镜头生成台词配音（TTS）
 * 生成的音频绑定到 shot.dubbingMediaId，构建时间线时自动对齐到该镜头片段。
 */
export async function generateShotDubbing(shotId: string, options: DubbingOptions = {}): Promise<MediaFile> {
  const shot = getShot(shotId);
  if (!shot) throw new Error(`镜头不存在：${shotId}`);

  const text = (options.text ?? shotDubbingText(shot)).trim();
  if (!text) throw new Error('该镜头没有台词或旁白，无法配音');

  const content = loadContent(shot.projectId);
  const characters = (content.screenplay?.characters ?? []).filter((item) =>
    shot.characterIds.includes(item.id),
  );
  const voice = options.voice ?? resolveDubbingVoice(shot, characters);

  const result = await runAudio({
    input: text,
    voice,
    language: options.language,
    speed: options.speed,
    volume: options.volume,
    format: options.format ?? 'mp3',
  });

  const source = result.url ?? result.b64;
  if (!source) throw new Error('语音模型未返回音频内容');

  const saved = await saveMedia(shot.projectId, 'audio', source, {
    mime: mimeForAudio(result.format),
  });
  const media = persistAudio(shot.projectId, 'shot', shot.id, saved, text, voice, result.model);
  updateShot(shotId, { dubbingMediaId: media.id });
  return media;
}

/** 批量配音：给所有有台词且尚未配音的镜头生成配音 */
export async function generateProjectDubbing(
  projectId: string,
  options: DubbingOptions = {},
): Promise<Array<{ shotId: string; ok: boolean; error?: string }>> {
  const shots = listShots(projectId);
  const results: Array<{ shotId: string; ok: boolean; error?: string }> = [];
  for (const shot of shots) {
    if (!shotDubbingText(shot)) continue;
    if (shot.dubbingMediaId) {
      results.push({ shotId: shot.id, ok: true });
      continue;
    }
    try {
      await generateShotDubbing(shot.id, options);
      results.push({ shotId: shot.id, ok: true });
    } catch (error) {
      results.push({
        shotId: shot.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

/** 清除镜头配音 */
export function clearShotDubbing(shotId: string): Shot {
  const shot = getShot(shotId);
  if (!shot) throw new Error(`镜头不存在：${shotId}`);
  return updateShot(shotId, { dubbingMediaId: null });
}

/**
 * 画布文字节点 → 语音：以节点文本为台词合成音频，节点升级为语音节点
 */
export async function generateCanvasItemAudio(
  canvasItemId: string,
  options: DubbingOptions = {},
): Promise<{ media: MediaFile }> {
  const item = getCanvasItem(canvasItemId);
  if (!item) throw new Error(`画布素材不存在：${canvasItemId}`);

  const text = item.text.trim();
  if (!text) throw new Error('节点文本为空，无法合成语音');

  const result = await runAudio({
    input: text,
    voice: options.voice,
    language: options.language,
    speed: options.speed,
    volume: options.volume,
    format: options.format ?? 'mp3',
  });

  const source = result.url ?? result.b64;
  if (!source) throw new Error('语音模型未返回音频内容');

  const saved = await saveMedia(item.projectId, 'audio', source, {
    mime: mimeForAudio(result.format),
  });
  const media = persistAudio(item.projectId, 'canvas', item.id, saved, text, options.voice, result.model);
  updateCanvasItem(item.id, { kind: 'audio', mediaId: media.id, url: media.url });
  return { media };
}

/** 批量画布语音合成 */
export async function generateCanvasItemsAudio(
  canvasItemIds: string[],
  options: DubbingOptions = {},
): Promise<Array<{ itemId: string; ok: boolean; error?: string }>> {
  const results: Array<{ itemId: string; ok: boolean; error?: string }> = [];
  for (const itemId of canvasItemIds) {
    try {
      await generateCanvasItemAudio(itemId, options);
      results.push({ itemId, ok: true });
    } catch (error) {
      results.push({
        itemId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

/** 落盘并创建音频媒体记录 */
function persistAudio(
  projectId: string,
  ownerType: 'shot' | 'canvas',
  ownerId: string,
  saved: { url: string; path: string; mime: string; fileSize: number },
  text: string,
  voice: string | undefined,
  model: string | undefined,
): MediaFile {
  return createMedia({
    projectId,
    kind: 'audio',
    url: saved.url,
    path: saved.path,
    mime: saved.mime,
    fileSize: saved.fileSize,
    prompt: text.slice(0, 500),
    model: model ?? null,
    ownerType,
    ownerId,
  });
}
