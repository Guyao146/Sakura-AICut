import type { RedrawKeyframe, VideoRedraw } from '@sakura/core';
import { downloadToBuffer } from '@sakura/core/server';
import {
  createMedia,
  createVideoRedraw,
  getMedia,
  getVideoRedraw,
  listVideoRedraws,
  updateVideoRedraw,
} from '@sakura/db';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runImage, runText } from './ai';
import { absolutePathOf, resolveMediaPath, saveBufferToData, saveMedia } from './storage';

/**
 * 重制转绘 / 一键出海（差异化方向）
 *
 * 用户上传原片 → 指定「换角色 / 换画风 / 换画幅 / 换场景」→
 * 抽关键帧 → 视觉模型理解构图与运镜 → 按新设定逐帧重绘 → 生成新动态片段。
 *
 * 说明：抽帧依赖宿主环境的视频解码能力，这里提供「已有关键帧 URL」的入口，
 * 由 web 层上传或由 worker 的 ffmpeg 步骤填入。
 */

export interface CreateRedrawInput {
  projectId: string;
  sourceMediaId: string;
  characterPrompt?: string | null;
  stylePrompt?: string | null;
  aspectRatio?: string | null;
  scenePrompt?: string | null;
  extraPrompt?: string | null;
  segmentDurationSec?: number;
}

/** 创建一条重绘任务（pending），关键帧稍后填充 */
export function createRedraw(input: CreateRedrawInput): VideoRedraw {
  const media = getMedia(input.sourceMediaId);
  if (!media) throw new Error(`原片媒体不存在：${input.sourceMediaId}`);
  if (media.kind !== 'video' && media.kind !== 'image') {
    throw new Error('重绘的原片必须是视频或图片');
  }
  return createVideoRedraw({
    projectId: input.projectId,
    sourceMediaId: input.sourceMediaId,
    characterPrompt: input.characterPrompt ?? null,
    stylePrompt: input.stylePrompt ?? null,
    aspectRatio: input.aspectRatio ?? null,
    scenePrompt: input.scenePrompt ?? null,
    extraPrompt: input.extraPrompt ?? null,
    segmentDurationSec: input.segmentDurationSec ?? 5,
  });
}

export function listRedraws(projectId: string): VideoRedraw[] {
  return listVideoRedraws(projectId);
}

export function getRedraw(id: string): VideoRedraw | null {
  return getVideoRedraw(id);
}

/**
 * 用 ffmpeg 从原片抽关键帧（每 segmentDurationSec 秒一帧），落盘后登记。
 * 原片是本地文件时直接解码；否则先下载到临时文件。
 */
export async function extractKeyframes(redrawId: string): Promise<VideoRedraw> {
  const redraw = getVideoRedraw(redrawId);
  if (!redraw) throw new Error(`重绘任务不存在：${redrawId}`);

  const source = getMedia(redraw.sourceMediaId);
  if (!source) throw new Error(`原片媒体不存在：${redraw.sourceMediaId}`);

  const ffmpegPath = process.env.FFMPEG_PATH ?? 'ffmpeg';
  const segment = Math.max(1, redraw.segmentDurationSec ?? 5);
  const tmp = mkdtempSync(join(tmpdir(), 'redraw-'));
  let localInput = resolveMediaPath(source.path);

  try {
    if (!localInput) {
      // 远端原片：先下载到临时文件再抽帧
      if (!source.url) throw new Error('原片没有可访问的本地文件或远程地址');
      const downloaded = await downloadToBuffer(source.url);
      localInput = join(tmp, 'source_input');
      const buf = Buffer.from(downloaded.buffer.buffer, downloaded.buffer.byteOffset, downloaded.buffer.byteLength);
      writeFileSync(localInput, buf);
    }

    const pattern = join(tmp, 'f_%04d.png');
    await runFfmpegOnce(ffmpegPath, ['-i', localInput, '-vf', `fps=1/${segment}`, pattern]);

    const frames: Array<{ timeSec: number; url: string }> = [];
    const files = readdirSync(tmp)
      .filter((name) => /^f_\d{4}\.png$/.test(name))
      .sort();
    for (const file of files) {
      const index = Number(file.slice(2, 6)) - 1;
      const buffer = readFileSync(join(tmp, file));
      const saved = saveBufferToData(
        join('media', redraw.projectId, `redraw_frame_${redrawId.slice(0, 12)}_${String(index).padStart(3, '0')}.png`),
        new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
      );
      frames.push({ timeSec: index * segment, url: saved.url });
    }
    if (frames.length === 0) throw new Error('ffmpeg 未抽出任何关键帧，请检查原片是否为有效视频');

    return registerKeyframes(redrawId, frames);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** 执行一次 ffmpeg，非零退出时抛错 */
function runFfmpegOnce(ffmpegPath: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => reject(new Error(`ffmpeg 启动失败：${error.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg 抽帧失败（退出码 ${code}）：${stderr.split('\n').slice(-5).join(' ')}`));
    });
  });
}

/** 本地媒体文件存在性检查（供外部判断原片是否可直接解码） */
export function sourceIsLocal(redrawId: string): boolean {
  const redraw = getVideoRedraw(redrawId);
  if (!redraw) return false;
  const source = getMedia(redraw.sourceMediaId);
  return existsSync(absolutePathOf(source?.path ?? ''));
}

/**
 * 登记关键帧：把抽出的原帧 URL 列表写入重绘任务。
 */
export function registerKeyframes(
  redrawId: string,
  frames: Array<{ timeSec: number; url: string }>,
): VideoRedraw {
  const redraw = getVideoRedraw(redrawId);
  if (!redraw) throw new Error(`重绘任务不存在：${redrawId}`);

  const keyframes: RedrawKeyframe[] = frames.map((frame) => ({
    timeSec: frame.timeSec,
    sourceMediaId: '',
    url: frame.url,
  }));
  return updateVideoRedraw(redrawId, { keyframes });
}

const KEYFRAME_ANALYSIS_PROMPT = `你是影视分镜分析师。分析这张视频关键帧，用一段英文描述：
构图（主体位置与比例）、景别、人物动作与表情、光影与色调、场景细节、镜头运动趋势。
只输出描述，不要输出其他内容。`;

/** 合并用户所有重绘维度，拼成统一的重绘提示词 */
export function buildRedrawPrompt(redraw: VideoRedraw): string {
  const parts = [
    redraw.characterPrompt ? `主角替换为：${redraw.characterPrompt}` : '',
    redraw.stylePrompt ? `画风：${redraw.stylePrompt}` : '',
    redraw.scenePrompt ? `场景替换为：${redraw.scenePrompt}` : '',
    redraw.extraPrompt ? `额外要求：${redraw.extraPrompt}` : '',
  ].filter(Boolean);
  return parts.join('. ');
}

/**
 * 分析并重绘所有关键帧（逐帧）。
 * 已提供帧 URL 时直接用；否则需要外部先调 registerKeyframes。
 */
export async function processRedrawKeyframes(
  redrawId: string,
  options: { skipAnalysis?: boolean } = {},
): Promise<VideoRedraw> {
  const redraw = getVideoRedraw(redrawId);
  if (!redraw) throw new Error(`重绘任务不存在：${redrawId}`);
  if (redraw.keyframes.length === 0) throw new Error('还没有关键帧，请先抽帧');

  updateVideoRedraw(redrawId, { status: 'running', error: null });

  try {
    const rewrite = buildRedrawPrompt(redraw);
    const updatedFrames: RedrawKeyframe[] = [];

    for (const frame of redraw.keyframes) {
      // 已重绘过的帧直接跳过（支持中断后「继续重绘」）
      if (frame.targetMediaId) {
        updatedFrames.push(frame);
        continue;
      }

      // 1. 原帧落盘为媒体（若尚未落盘）
      let sourceMediaId = frame.sourceMediaId;
      if (!sourceMediaId) {
        const saved = await saveMedia(redraw.projectId, 'image', frame.url ?? '', {
          filename: `redraw_src_${redrawId.slice(0, 10)}_${frame.timeSec}.png`,
        });
        const media = createMedia({
          projectId: redraw.projectId,
          kind: 'image',
          url: saved.url,
          path: saved.path,
          mime: saved.mime,
          fileSize: saved.fileSize,
          width: null,
          height: null,
          prompt: '重绘原帧',
          model: null,
          providerId: null,
          seed: null,
          ownerType: 'canvas',
          ownerId: redrawId,
        });
        sourceMediaId = media.id;
      }

      // 2. 视觉模型理解原帧（可跳过以省 token）
      let analysis = frame.analysis;
      if (!analysis && !options.skipAnalysis) {
        const sourceMedia = getMedia(sourceMediaId);
        const imageUrl = sourceMedia?.url;
        if (imageUrl) {
          try {
            const result = await runText({
              messages: [
                { role: 'system', content: KEYFRAME_ANALYSIS_PROMPT },
                { role: 'user', content: '分析这张关键帧。', images: [imageUrl] },
              ],
              temperature: 0.3,
              maxTokens: 500,
            });
            analysis = result.text.trim();
          } catch {
            analysis = undefined;
          }
        }
      }

      // 3. 按新设定重绘这一帧
      const imageResult = await runImage({
        prompt: `${rewrite}. Keep the original composition: ${analysis ?? ''}`.trim(),
        aspectRatio: redraw.aspectRatio ?? '16:9',
        count: 1,
      });
      if (imageResult.images.length === 0) throw new Error('图片模型未返回任何图片');

      const image = imageResult.images[0]!;
      const source = image.url ?? image.b64;
      if (!source) throw new Error('图片模型返回的内容为空');

      const saved = await saveMedia(redraw.projectId, 'image', source, {
        filename: source.startsWith('http')
          ? undefined
          : `redraw_out_${redrawId.slice(0, 10)}_${frame.timeSec}.png`,
      });
      const targetMedia = createMedia({
        projectId: redraw.projectId,
        kind: 'image',
        url: saved.url,
        path: saved.path,
        mime: saved.mime,
        fileSize: saved.fileSize,
        width: image.width ?? null,
        height: image.height ?? null,
        prompt: `${rewrite}. ${analysis ?? ''}`,
        model: imageResult.model ?? null,
        providerId: imageResult.providerId,
        seed: image.seed ?? null,
        ownerType: 'canvas',
        ownerId: redrawId,
      });

      updatedFrames.push({
        ...frame,
        sourceMediaId,
        analysis,
        targetMediaId: targetMedia.id,
      });
      // 逐帧落库，可随时中断恢复
      updateVideoRedraw(redrawId, { keyframes: updatedFrames });
    }

    return updateVideoRedraw(redrawId, { status: 'succeeded', error: null });
  } catch (error) {
    return updateVideoRedraw(redrawId, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

