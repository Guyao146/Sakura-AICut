import type { ExportPreset, Timeline, TimelineClip, Track } from '@sakura/core';
import { createId } from '@sakura/core';
import { getMedia, getProject, getTimeline, listShots, saveTimeline, updateTimelineRender } from '@sakura/db';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from '@sakura/db';
import { absolutePathOf, resolveMediaPath } from './storage';

/**
 * 第五步：时间线构建与 ffmpeg 渲染导出
 */

export interface BuildTimelineOptions {
  transition?: 'none' | 'fade' | 'dissolve';
  transitionDuration?: number;
  includeSubtitles?: boolean;
  /** 只使用指定镜头（默认使用已选片段） */
  shotIds?: string[];
}

/** 依据已生成片段自动铺排时间线 */
export function buildTimelineFromShots(projectId: string, options: BuildTimelineOptions = {}): Timeline {
  const project = getProject(projectId);
  if (!project) throw new Error(`项目不存在：${projectId}`);
  const shots = listShots(projectId).filter((shot) => (options.shotIds ? options.shotIds.includes(shot.id) : true));

  const videoClips: TimelineClip[] = [];
  const audioClips: TimelineClip[] = [];
  const subtitleClips: TimelineClip[] = [];
  const transitionDuration = options.transition && options.transition !== 'none' ? (options.transitionDuration ?? 0.4) : 0;
  let cursor = 0;

  for (const shot of shots) {
    const mediaId = shot.selectedMediaId ?? shot.clipMediaIds[0];
    if (!mediaId) continue;
    const media = getMedia(mediaId);
    if (!media) continue;

    const duration = media.durationSec && media.durationSec > 0 ? media.durationSec : shot.durationSec;
    videoClips.push({
      id: `clip_${createId(10)}`,
      shotId: shot.id,
      mediaId: media.id,
      start: Number(cursor.toFixed(3)),
      duration: Number(duration.toFixed(3)),
      trimIn: 0,
      speed: 1,
      volume: 1,
      muted: false,
      label: `#${shot.index} ${shot.shotSize}`,
      ...(transitionDuration > 0
        ? { transitionIn: { type: options.transition ?? 'fade', durationSec: transitionDuration } }
        : {}),
    });

    // 台词配音：与该镜头的视频片段首尾对齐
    if (shot.dubbingMediaId) {
      const dubbing = getMedia(shot.dubbingMediaId);
      if (dubbing) {
        audioClips.push({
          id: `aud_${createId(10)}`,
          shotId: shot.id,
          mediaId: dubbing.id,
          start: Number(cursor.toFixed(3)),
          duration: Number((dubbing.durationSec && dubbing.durationSec > 0 ? dubbing.durationSec : duration).toFixed(3)),
          trimIn: 0,
          speed: 1,
          volume: 1,
          label: `#${shot.index} 配音`,
        });
      }
    }

    if (options.includeSubtitles !== false && (shot.dialogue || shot.description)) {
      subtitleClips.push({
        id: `sub_${createId(10)}`,
        shotId: shot.id,
        mediaId: media.id,
        start: Number(cursor.toFixed(3)),
        duration: Number(duration.toFixed(3)),
        trimIn: 0,
        speed: 1,
        volume: 0,
        text: shot.dialogue || shot.description.slice(0, 40),
        label: `#${shot.index} 字幕`,
      });
    }

    cursor += duration;
  }

  if (videoClips.length === 0) throw new Error('没有可用的片段，请先在第四步生成镜头片段');

  const tracks: Track[] = [
    { id: 'track_video', type: 'video', name: '主视频轨', clips: videoClips },
  ];
  if (audioClips.length > 0) {
    tracks.push({ id: 'track_audio', type: 'audio', name: '配音轨', clips: audioClips });
  }
  if (subtitleClips.length > 0) {
    tracks.push({ id: 'track_subtitle', type: 'subtitle', name: '字幕轨', clips: subtitleClips });
  }

  const [width, height] = aspectToSize(project.brief.aspectRatio);
  return saveTimeline(projectId, {
    tracks,
    width,
    height,
    fps: 30,
    exportPreset: defaultPresetFor(project.brief.aspectRatio),
    bumpVersion: true,
  });
}

export function aspectToSize(aspectRatio: string): [number, number] {
  switch (aspectRatio) {
    case '9:16':
      return [1080, 1920];
    case '16:9':
      return [1920, 1080];
    case '21:9':
      return [2560, 1080];
    case '4:3':
      return [1440, 1080];
    case '3:4':
      return [1080, 1440];
    default:
      return [1080, 1080];
  }
}

export function defaultPresetFor(aspectRatio: string): ExportPreset {
  const [width, height] = aspectToSize(aspectRatio);
  return {
    width,
    height,
    fps: 30,
    videoBitrate: width >= 1920 ? '12M' : '8M',
    audioBitrate: '192k',
    codec: 'libx264',
    format: 'mp4',
  };
}

/* ============================ 渲染 ============================ */

export interface RenderOptions {
  includeSubtitles?: boolean;
  ffmpegPath?: string;
  onProgress?: (percent: number, message: string) => void;
}

export interface RenderResult {
  outputUrl: string;
  outputPath: string;
  durationSec: number;
  elapsedMs: number;
}

/** 写入 .srt 字幕文件 */
function writeSrt(projectId: string, cues: TimelineClip[]): string {
  const dir = join(dataDir(), 'media', projectId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, `subtitle_${Date.now()}.srt`);
  const lines: string[] = [];
  cues
    .slice()
    .sort((a, b) => a.start - b.start)
    .forEach((cue, index) => {
      lines.push(String(index + 1));
      lines.push(`${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.start + Math.max(0.5, cue.duration * 0.9))}`);
      lines.push(cue.text ?? '');
      lines.push('');
    });
  writeFileSync(path, lines.join('\n'), 'utf8');
  return path;
}

function formatSrtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const rest = ms % 1000;
  const pad = (value: number, size = 2) => String(value).padStart(size, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(rest, 3)}`;
}

/** 生成 ffmpeg 输入与滤镜图（裁剪 / 变速 / 统一尺寸 / 拼接 / 字幕） */
function buildFfmpegPlan(timeline: Timeline, options: { includeSubtitles: boolean }) {
  const videoTrack = timeline.tracks.find((track) => track.type === 'video');
  if (!videoTrack || videoTrack.clips.length === 0) throw new Error('时间线没有视频片段');

  const inputs: string[] = [];
  const filterParts: string[] = [];
  const usableClips: TimelineClip[] = [];

  videoTrack.clips.forEach((clip, position) => {
    const media = getMedia(clip.mediaId);
    const absolute = resolveMediaPath(media?.path);
    if (!absolute) return;
    inputs.push('-i', absolute);
    usableClips.push(clip);

    const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
    const scale = `scale=${timeline.width}:${timeline.height}:force_original_aspect_ratio=decrease,pad=${timeline.width}:${timeline.height}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
    const trim = `trim=start=${clip.trimIn}:duration=${clip.duration},setpts=PTS-STARTPTS`;
    const speedFilter = speed !== 1 ? `,setpts=${(1 / speed).toFixed(4)}*PTS` : '';
    filterParts.push(`[${position}:v]${trim},${scale}${speedFilter},fps=${timeline.fps}[v${position}]`);
  });

  if (usableClips.length === 0) throw new Error('时间线中的片段缺少本地文件，请重新生成或下载素材');

  const concatInputs = usableClips.map((_, position) => `[v${position}]`).join('');
  filterParts.push(`${concatInputs}concat=n=${usableClips.length}:v=1:a=0[vout]`);

  // 配音音频轨：逐片段延迟对齐后混音
  const audioTrack = timeline.tracks.find((track) => track.type === 'audio');
  const audioClips = (audioTrack?.clips ?? []).filter((clip) => !clip.muted && getMedia(clip.mediaId));
  const audioInputBase = usableClips.length; // 视频输入占满 0..n-1，音频输入接在后面
  const audioLabels: string[] = [];
  audioClips.forEach((clip, index) => {
    const media = getMedia(clip.mediaId);
    const absolute = resolveMediaPath(media?.path);
    if (!absolute) return;
    const inputIndex = audioInputBase + index;
    inputs.push('-i', absolute);
    audioLabels.push(`a${inputIndex}`);

    const volume = Math.max(0, Math.min(2, (clip.volume ?? 1) * (audioTrack?.volume ?? 1)));
    const startMs = Math.max(0, Math.round(clip.start * 1000));
    const parts = [
      `atrim=start=${clip.trimIn}:duration=${clip.duration}`,
      'asetpts=PTS-STARTPTS',
      ...(volume !== 1 ? [`volume=${volume.toFixed(3)}`] : []),
      ...(startMs > 0 ? [`adelay=${startMs}:all=1`] : []),
    ];
    filterParts.push(`[${inputIndex}:a]${parts.join(',')}[a${inputIndex}]`);
  });
  let audioLabel: string | null = null;
  if (audioLabels.length === 1) {
    audioLabel = `[${audioLabels[0]}]`;
  } else if (audioLabels.length > 1) {
    audioLabel = '[aout]';
    filterParts.push(`${audioLabels.map((label) => `[${label}]`).join('')}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0${audioLabel}`);
  }

  let hasSubtitles = false;
  if (options.includeSubtitles) {
    const subtitleTrack = timeline.tracks.find((track) => track.type === 'subtitle');
    const cues = (subtitleTrack?.clips ?? []).filter((clip) => (clip.text ?? '').trim().length > 0);
    if (cues.length > 0) {
      const subtitlePath = writeSrt(timeline.projectId, cues);
      filterParts.push(`[vout]subtitles='${subtitlePath.replace(/\\/g, '/').replace(/:/g, '\\:')}'[vsub]`);
      hasSubtitles = true;
    }
  }

  const duration = usableClips.reduce((sum, clip) => sum + clip.duration / (clip.speed || 1), 0);
  return {
    inputs,
    filterGraph: filterParts.join(';'),
    outputLabel: hasSubtitles ? '[vsub]' : '[vout]',
    audioLabel,
    duration: Number(duration.toFixed(3)),
  };
}

/** 执行 ffmpeg 并把 stderr 解析成进度 */
function runFfmpeg(
  ffmpegPath: string,
  args: string[],
  totalDurationSec: number,
  onProgress?: (percent: number, message: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      if (stderr.length > 20000) stderr = stderr.slice(-10000);
      const match = /time=(\d+):(\d+):(\d+\.\d+)/.exec(text);
      if (match && totalDurationSec > 0) {
        const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
        const percent = Math.round((seconds / totalDurationSec) * 100);
        onProgress?.(percent, `已渲染 ${seconds.toFixed(1)} / ${totalDurationSec.toFixed(1)} 秒`);
      }
    });

    child.on('error', (error) => reject(new Error(`ffmpeg 启动失败：${error.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg 渲染失败（退出码 ${code}）：${stderr.split('\n').slice(-6).join(' ')}`));
    });
  });
}

/** 执行 ffmpeg 渲染当前时间线 */
export async function renderTimeline(projectId: string, options: RenderOptions = {}): Promise<RenderResult> {
  const project = getProject(projectId);
  if (!project) throw new Error(`项目不存在：${projectId}`);
  const timeline = getTimeline(projectId);
  if (!timeline) throw new Error('尚未构建时间线，请先在第五步点击「按镜头生成时间线」');

  const preset = timeline.exportPreset ?? defaultPresetFor(project.brief.aspectRatio);
  const plan = buildFfmpegPlan(timeline, { includeSubtitles: options.includeSubtitles ?? true });

  const outDir = join(dataDir(), 'exports');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const safeName = project.brief.name.replace(/[^\w\u4e00-\u9fa5-]+/g, '_') || 'export';
  const filename = `${safeName}_${Date.now()}.mp4`;
  const outputPath = join(outDir, filename);

  const args = [
    '-y',
    ...plan.inputs,
    '-filter_complex',
    plan.filterGraph,
    '-map',
    plan.outputLabel,
    ...(plan.audioLabel ? ['-map', plan.audioLabel, '-c:a', 'aac', '-b:a', preset.audioBitrate] : []),
    '-c:v',
    preset.codec,
    '-b:v',
    preset.videoBitrate,
    '-r',
    String(preset.fps),
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    outputPath,
  ];

  const ffmpegPath = options.ffmpegPath ?? process.env.FFMPEG_PATH ?? 'ffmpeg';
  const startedAt = Date.now();
  updateTimelineRender(projectId, { status: 'running', progress: 1, outputUrl: null });

  await runFfmpeg(ffmpegPath, args, plan.duration, (percent) => {
    updateTimelineRender(projectId, { progress: Math.max(1, Math.min(99, percent)) });
    options.onProgress?.(percent, '渲染中');
  });

  const outputUrl = `/api/files/${join('exports', filename).replace(/\\/g, '/')}`;
  updateTimelineRender(projectId, {
    status: 'succeeded',
    progress: 100,
    outputUrl,
    renderedAt: new Date().toISOString(),
  });

  return {
    outputUrl,
    outputPath,
    durationSec: plan.duration,
    elapsedMs: Date.now() - startedAt,
  };
}
