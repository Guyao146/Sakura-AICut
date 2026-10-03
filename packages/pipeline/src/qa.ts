/**
 * 成片 QA 与自动修复
 * ------------------------------------------------------------------
 * 两道关卡：
 *   1. ffprobe 探针（免费、极快）：可解码性 / 时长 / 分辨率 / 帧率 / 纯黑屏
 *   2. 视觉模型评审（首中尾抽帧打分 + 问题清单）
 * 未配置图像理解路由时自动降级为「仅探针」；探针判定无法解码时直接判负，
 * 不再调用模型，省 token。
 * reviewProjectClips 做项目级增量扫描，已通过的历史报告默认跳过（refresh=true 强制重查）。
 * 判负的片段会被踢出镜头选中位（shot.selectedMediaId），无可替代片段时回退为「待重抽」。
 */

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { MediaFile, QaProbe, QaReport, QaReview, QaSummary, QaVerdict, Shot } from '@sakura/core';
import {
  createQaReport,
  getLatestQaReport,
  getMedia,
  getShot,
  getTimeline,
  listMedia,
  listModelRoutes,
  listQaReports,
  listShots,
  updateQaReport,
  updateShot,
} from '@sakura/db';

import { runText } from './ai';
import { resolveMediaPath } from './storage';

/** QA 报告的触发来源 */
export type QaSource = QaReport['source'];

/** 视觉评审通过分数（>= 视为可用） */
export const QA_PASS_SCORE = 60;
/** 警告分数（低于通过分但 >= 此值判 warn，再低判 fail） */
export const QA_WARN_SCORE = 45;

export interface QaProgressContext {
  /** 进度回调（0-100，stage 为当前阶段描述） */
  onProgress?: (percent: number, stage: string) => void;
  /** 业务日志（会写入 job_events） */
  log?: (message: string, level?: 'info' | 'warn' | 'error') => void;
  /** 取消信号 */
  isCanceled?: () => boolean;
}

export interface ProbeMediaOptions extends QaProgressContext {
  /** ffmpeg 可执行文件路径（同时用于探针与抽帧；缺省走 FFMPEG_PATH 环境变量或 PATH） */
  ffmpegPath?: string;
}

export interface ReviewMediaOptions extends ProbeMediaOptions {
  /** 是否启用视觉模型评审（缺省 true） */
  withVision?: boolean;
  /** 是否在判负时自动把片段踢出镜头选中位并标记重抽（缺省 true） */
  autoFlag?: boolean;
  /** 报告来源 */
  source?: QaSource;
}

export interface ReviewProjectOptions extends ReviewMediaOptions {
  /** 只检查这些 index 的镜头；缺省检查全部镜头片段 */
  shotIndexes?: number[];
  /** 是否重查已通过的历史报告（缺省 false：增量跳过） */
  refresh?: boolean;
}


/* -------------------------------- 探针关卡 -------------------------------- */

interface ProbeResult {
  ok: boolean;
  error?: string;
  probe: QaProbe;
}

function failedProbe(error?: string | null): QaProbe {
  return {
    ok: false,
    decodable: false,
    durationSec: null,
    width: null,
    height: null,
    fps: null,
    codec: null,
    hasAudio: null,
    blackScreen: null,
    error: error ?? null,
  };
}

function defaultFfmpegPath(options?: { ffmpegPath?: string }): string {
  return options?.ffmpegPath || process.env.FFMPEG_PATH || 'ffmpeg';
}

/** 由 ffmpeg 路径推出 ffprobe 路径（同目录同名替换） */
function ffprobePathFrom(ffmpegPath: string): string {
  return ffmpegPath.replace(/ffmpeg(\.exe)?$/i, (match) => match.replace(/ffmpeg/i, 'ffprobe'));
}

/** 媒体的可探测地址：本地文件优先，否则回落远程 URL */
function resolveProbeTarget(media: MediaFile): string | null {
  const local = resolveMediaPath(media.path);
  if (local) return local;
  if (media.url && /^https?:\/\//i.test(media.url)) return media.url;
  return null;
}

/** 判断整段画面是否接近纯黑（用于挡住「渲染失败只剩黑场」的废片） */
function looksLikeBlackScreen(
  frames: Array<{ data: Buffer; width: number; height: number }>,
  threshold = 0.985,
): boolean {
  if (frames.length === 0) return false;
  let darkPixels = 0;
  let totalPixels = 0;
  for (const frame of frames) {
    const { data, width, height } = frame;
    const pixelCount = width * height;
    // 每帧最多采样 4000 个像素，控制耗时
    const step = Math.max(1, Math.floor(pixelCount / 4000));
    let dark = 0;
    let sampled = 0;
    for (let i = 0; i < pixelCount; i += step) {
      const offset = i * 4;
      if (offset + 2 >= data.length) break;
      if (data[offset] < 24 && data[offset + 1] < 24 && data[offset + 2] < 24) dark++;
      sampled++;
    }
    darkPixels += dark;
    totalPixels += sampled;
  }
  return totalPixels > 0 && darkPixels / totalPixels >= threshold;
}

interface RawProbe {
  ok: boolean;
  error?: string;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  codec: string | null;
  hasAudio: boolean | null;
}

function probeRawVideo(target: string, ffprobePath: string): Promise<RawProbe> {
  return new Promise((resolve) => {
    const args = [
      '-v', 'error',
      '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,r_frame_rate',
      '-of', 'json',
      target,
    ];
    const child = spawn(ffprobePath, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', (error) => resolve({ ok: false, error: error.message, durationSec: null, width: null, height: null, fps: null, codec: null, hasAudio: null }));
    child.on('close', (code) => {
      if (code !== 0) {
        resolve({
          ok: false,
          error: stderr.trim() || `ffprobe 退出码 ${code}`,
          durationSec: null,
          width: null,
          height: null,
          fps: null,
          codec: null,
          hasAudio: null,
        });
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as {
          format?: { duration?: string };
          streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; r_frame_rate?: string }>;
        };
        const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
        const videoStream = streams.find((stream) => stream.codec_type === 'video' && typeof stream.width === 'number');
        let fps: number | null = null;
        if (videoStream?.r_frame_rate) {
          const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
          if (Number.isFinite(num) && den && Number.isFinite(den)) fps = num / den;
        }
        let durationSec: number | null = null;
        const durationRaw = parsed.format?.duration;
        if (typeof durationRaw === 'string') {
          const parsedDuration = Number.parseFloat(durationRaw);
          if (Number.isFinite(parsedDuration)) durationSec = parsedDuration;
        }
        resolve({
          ok: true,
          durationSec,
          width: videoStream?.width ?? null,
          height: videoStream?.height ?? null,
          fps,
          codec: videoStream?.codec_name ?? null,
          hasAudio: streams.some((stream) => stream.codec_type === 'audio'),
        });
      } catch (error) {
        resolve({
          ok: false,
          error: error instanceof Error ? error.message : '解析 ffprobe 输出失败',
          durationSec: null,
          width: null,
          height: null,
          fps: null,
          codec: null,
          hasAudio: null,
        });
      }
    });
  });
}


/** 抽取首/中/尾三帧为 RGBA 原始数据，供黑屏检测使用 */
async function sampleRawFrames(filePath: string, ffmpegPath: string): Promise<{ frames: Array<{ data: Buffer; width: number; height: number }>; error?: string }> {
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'sakura-qa-'));
  const width = 320;
  const positions = ['00:00:00.100', '50%', '99%'];
  const frames: Array<{ data: Buffer; width: number; height: number }> = [];
  try {
    for (let i = 0; i < positions.length; i++) {
      const outPath = path.join(tmpDir, `frame-${i}.rgba`);
      const args = [
        '-v', 'error',
        '-ss', positions[i],
        '-i', filePath,
        '-frames:v', '1',
        '-vf', `scale=${width}:-1`,
        '-f', 'rawvideo',
        '-pix_fmt', 'rgba',
        '-y',
        outPath,
      ];
      const success = await new Promise<boolean>((resolve) => {
        const child = spawn(ffmpegPath, args, { windowsHide: true });
        child.on('error', () => resolve(false));
        child.on('close', (code) => resolve(code === 0));
      });
      if (!success) continue;
      const data = await readFile(outPath);
      const height = Math.floor(data.length / 4 / width);
      if (height > 0) frames.push({ data, width, height });
    }
    return { frames };
  } catch (error) {
    return { frames, error: error instanceof Error ? error.message : '抽帧失败' };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

export async function probeMedia(target: string, options: ProbeMediaOptions = {}): Promise<ProbeResult> {
  const ffmpegPath = defaultFfmpegPath(options);
  const ffprobePath = ffprobePathFrom(ffmpegPath);
  if (!target) {
    options.log?.('QA 探针：媒体文件不存在', 'error');
    return { ok: false, error: '媒体文件不存在', probe: failedProbe('媒体文件不存在') };
  }

  const video = await probeRawVideo(target, ffprobePath);
  if (!video.ok) {
    options.log?.(`QA 探针：无法解码（${video.error}）`, 'error');
    return { ok: false, error: video.error, probe: failedProbe(video.error) };
  }

  // 远程 URL 不做黑屏抽帧（避免下载整段视频）
  const isLocal = !/^https?:\/\//i.test(target);
  let blackScreen: boolean | null = null;
  if (isLocal) {
    const { frames, error: frameError } = await sampleRawFrames(target, ffmpegPath);
    blackScreen = frames.length > 0 ? looksLikeBlackScreen(frames) : null;
    if (frameError) options.log?.(`QA 探针：黑屏抽帧部分失败（${frameError}）`, 'warn');
  }

  const probe: QaProbe = {
    ok: true,
    decodable: true,
    durationSec: video.durationSec,
    width: video.width,
    height: video.height,
    fps: video.fps,
    codec: video.codec,
    hasAudio: video.hasAudio,
    blackScreen,
    error: null,
  };
  options.log?.(
    `QA 探针通过：时长 ${probe.durationSec?.toFixed(1) ?? '未知'}s / ${probe.width}x${probe.height} / ${probe.fps?.toFixed(1) ?? '未知'}fps / 黑屏 ${blackScreen === null ? '未知' : blackScreen ? '是' : '否'}`,
  );
  return { ok: true, probe };
}


/* ------------------------------ 视觉评审关卡 ------------------------------ */

const QA_VISION_PROMPT = `你是一名严格的影视后期质检员。下面是某个视频片段按时间顺序抽取的关键帧。
请从画面一致性、主体清晰度、构图、光影、穿帮与瑕疵五个维度，评估这些画面是否达到商业短剧/电影成片标准。

请只输出一个 JSON 对象，不要输出任何额外文字或代码块标记：
{
  "score": 0-100 的整数可用度评分,
  "issues": ["按严重程度排序的问题清单，每条 20 字以内，只列最关键的 1-3 条"],
  "summary": "一句话总体评价，40 字以内"
}`;

/** 是否存在可用的图像理解路由（没有就降级为仅探针） */
export function hasVisionRoute(): boolean {
  return listModelRoutes().some((route) => route.capability === 'image');
}

function extractVisionResult(text: string): { score: number; issues: string[]; summary: string | null } | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { score?: unknown; issues?: unknown; summary?: unknown };
    const score = typeof parsed.score === 'number' ? Math.round(parsed.score) : null;
    if (score === null || !Number.isFinite(score)) return null;
    const issues = Array.isArray(parsed.issues)
      ? parsed.issues.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 3)
      : [];
    const summary = typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary.trim() : null;
    return { score: Math.max(0, Math.min(100, score)), issues, summary };
  } catch {
    return null;
  }
}

/** 抽取首/中/尾关键帧为 data URI，供支持图像理解的模型评审 */
async function extractFrameDataUrls(target: string, ffmpegPath: string): Promise<string[] | null> {
  if (/^https?:\/\//i.test(target)) return null;
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'sakura-qa-frames-'));
  const positions = ['00:00:00.200', '50%', '99%'];
  const dataUrls: string[] = [];
  try {
    for (let i = 0; i < positions.length; i++) {
      const outPath = path.join(tmpDir, `frame-${i}.jpg`);
      const args = [
        '-v', 'error',
        '-ss', positions[i],
        '-i', target,
        '-frames:v', '1',
        '-vf', 'scale=640:-1',
        '-q:v', '4',
        '-y',
        outPath,
      ];
      const success = await new Promise<boolean>((resolve) => {
        const child = spawn(ffmpegPath, args, { windowsHide: true });
        child.on('error', () => resolve(false));
        child.on('close', (code) => resolve(code === 0));
      });
      if (!success) continue;
      const buffer = await readFile(outPath);
      dataUrls.push(`data:image/jpeg;base64,${buffer.toString('base64')}`);
    }
    return dataUrls.length > 0 ? dataUrls : null;
  } catch {
    return null;
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

export async function reviewFramesWithVision(frames: string[], context: QaProgressContext): Promise<QaReview | null> {
  if (!hasVisionRoute()) {
    context.log?.('QA 评审：未配置图像理解路由，跳过视觉模型评审（仅探针模式）', 'warn');
    return null;
  }
  if (frames.length === 0) return null;

  const result = await runText({
    messages: [{ role: 'user', content: QA_VISION_PROMPT, images: frames }],
    json: true,
    temperature: 0.3,
  });

  const parsed = extractVisionResult(result.text);
  if (!parsed) {
    context.log?.('QA 评审：模型输出无法解析，忽略本次评分', 'warn');
    return null;
  }
  context.log?.(`QA 评审完成：评分 ${parsed.score}${parsed.issues.length > 0 ? `；问题：${parsed.issues.join('；')}` : '；未发现问题'}`);
  return {
    score: parsed.score,
    passed: parsed.score >= QA_PASS_SCORE,
    issues: parsed.issues,
    summary: parsed.summary,
    model: result.model ?? null,
  };
}


/* ------------------------------ 评级与修复 ------------------------------ */

interface ProbeExpectations {
  expectDurationSec?: number | null;
  expectWidth?: number | null;
  expectHeight?: number | null;
}

/** 由探针结果派生硬性问题（不调模型也能发现的废片特征） */
function issuesFromProbe(probe: QaProbe, expectations: ProbeExpectations): string[] {
  const issues: string[] = [];
  if (!probe.ok || probe.decodable === false) {
    issues.push(probe.error ? `无法解码：${probe.error}` : '视频无法解码，疑似渲染失败');
    return issues;
  }
  if (probe.blackScreen) issues.push('画面全黑，疑似空帧或渲染失败');
  const durationSec = probe.durationSec ?? null;
  const fps = probe.fps ?? null;
  if (durationSec !== null && expectations.expectDurationSec && expectations.expectDurationSec > 0) {
    if (durationSec < 0.4) {
      issues.push(`时长仅 ${durationSec.toFixed(2)}s，过短`);
    } else {
      const delta = (durationSec - expectations.expectDurationSec) / expectations.expectDurationSec;
      if (Math.abs(delta) > 0.35) {
        issues.push(`时长 ${durationSec.toFixed(1)}s 与预期 ${expectations.expectDurationSec.toFixed(1)}s 偏差过大`);
      }
    }
  }
  if (probe.width && probe.height && expectations.expectWidth && expectations.expectHeight) {
    const actualRatio = probe.width / probe.height;
    const expectedRatio = expectations.expectWidth / expectations.expectHeight;
    if (Math.abs(actualRatio - expectedRatio) / expectedRatio > 0.12) {
      issues.push(`画幅 ${probe.width}x${probe.height} 与目标 ${expectations.expectWidth}x${expectations.expectHeight} 不符`);
    }
  }
  if (fps !== null && fps < 8) issues.push(`帧率 ${fps.toFixed(1)}fps 过低，画面卡顿`);
  return issues;
}

function verdictFromScore(score: number): QaVerdict {
  if (score >= QA_PASS_SCORE) return 'pass';
  if (score >= QA_WARN_SCORE) return 'warn';
  return 'fail';
}

/** 综合探针与评审给出最终评级 */
function computeVerdict(probe: QaProbe, review: QaReview | null): QaVerdict {
  // 探针硬故障：无法解码 / 纯黑屏 → 直接判负，不再考虑模型评分
  if (!probe.ok || probe.decodable === false || probe.blackScreen) return 'fail';
  if (review) return verdictFromScore(review.score);
  return 'pass';
}

/**
 * 把 QA 结论应用到镜头：
 * 判负片段如果正是镜头当前选中的片段（selectedMediaId），则把它踢出选中位，
 * 优先换成同镜头的其它片段；没有可替代片段时把镜头标记为失败（待重抽）。
 */
export function applyQaVerdict(
  report: QaReport,
  options: { autoFlag?: boolean } = {},
): { changed: boolean; shotId: string | null } {
  if (!(options.autoFlag ?? true)) return { changed: false, shotId: report.shotId ?? null };
  if (report.verdict !== 'fail' || !report.shotId) return { changed: false, shotId: report.shotId ?? null };

  const shot = getShot(report.shotId);
  if (!shot) return { changed: false, shotId: null };
  if (shot.selectedMediaId !== report.mediaId) return { changed: false, shotId: shot.id };

  const alternatives = (shot.clipMediaIds ?? []).filter((id) => id !== report.mediaId);
  const nextSelected = alternatives[0] ?? null;
  const reason = report.issues.slice(0, 2).join('；') || '画面不达标';
  updateShot(shot.id, {
    selectedMediaId: nextSelected,
    status: nextSelected ? 'succeeded' : 'failed',
    error: nextSelected ? null : `QA 未通过：${reason}`,
  });
  return { changed: true, shotId: shot.id };
}

function saveReport(
  media: MediaFile,
  shot: Shot | null,
  data: { verdict: QaVerdict; probe: QaProbe; review: QaReview | null; issues: string[] },
  source?: QaSource,
): QaReport {
  const patch = {
    status: 'succeeded' as const,
    verdict: data.verdict,
    probe: data.probe,
    review: data.review,
    issues: data.issues,
  };
  const latest = getLatestQaReport(media.id);
  if (latest) return updateQaReport(latest.id, patch);
  const created = createQaReport({
    projectId: media.projectId,
    mediaId: media.id,
    shotId: shot?.id ?? null,
    source: source ?? 'manual',
  });
  return updateQaReport(created.id, patch);
}


export async function reviewMedia(
  input: { mediaId: string; shotId?: string; source?: QaSource },
  options: ReviewMediaOptions = {},
): Promise<QaReport> {
  const media = getMedia(input.mediaId);
  if (!media) throw new Error('媒体不存在');
  if (media.kind !== 'video') throw new Error('QA 只支持视频媒体');

  const target = resolveProbeTarget(media);
  const shot = input.shotId ? (getShot(input.shotId) ?? null) : null;
  const timeline = getTimeline(media.projectId);
  const expectations: ProbeExpectations = {
    expectDurationSec: shot?.durationSec ?? media.durationSec ?? null,
    expectWidth: timeline?.width ?? null,
    expectHeight: timeline?.height ?? null,
  };

  options.onProgress?.(20, '执行 ffprobe 探针');
  // 文件丢失也记成判负报告，而不是抛异常：单条片段故障不应打断整次扫描
  const probeResult = await probeMedia(target ?? '', options);

  // 探针硬故障：无法解码 → 直接判负，不再调用模型省钱
  if (!probeResult.ok) {
    const report = saveReport(
      media,
      shot,
      {
        verdict: 'fail',
        probe: probeResult.probe,
        review: null,
        issues: [probeResult.error ? `无法解码：${probeResult.error}` : '视频无法解码'],
      },
      input.source ?? options.source,
    );
    applyQaVerdict(report, { autoFlag: options.autoFlag });
    return report;
  }

  if (options.isCanceled?.()) throw new Error('QA 任务已取消');

  const issues = issuesFromProbe(probeResult.probe, expectations);
  let review: QaReview | null = null;
  if (target && options.withVision !== false) {
    options.onProgress?.(50, '抽取关键帧');
    const frames = await extractFrameDataUrls(target, defaultFfmpegPath(options));
    if (frames === null) {
      options.log?.('QA 评审：关键帧抽取失败，仅按探针结论评级', 'warn');
    } else {
      options.onProgress?.(70, '视觉模型评审');
      review = await reviewFramesWithVision(frames, options);
    }
  }

  const verdict = computeVerdict(probeResult.probe, review);
  const report = saveReport(
    media,
    shot,
    {
      verdict,
      probe: probeResult.probe,
      review,
      issues: review ? [...issues, ...review.issues] : issues,
    },
    input.source ?? options.source,
  );
  applyQaVerdict(report, { autoFlag: options.autoFlag });
  options.onProgress?.(100, verdict === 'pass' ? '通过' : verdict === 'warn' ? '通过但有隐患' : '未通过，已标记重抽');
  return report;
}

/* ------------------------------ 项目级扫描 ------------------------------ */

function summarizeReports(reports: QaReport[], shots: Shot[], skipped: number): QaSummary {
  let passed = 0;
  let warned = 0;
  let failed = 0;
  const indexById = new Map(shots.map((shot) => [shot.id, shot.index]));
  const reshootIndexes: number[] = [];
  for (const report of reports) {
    if (report.verdict === 'pass') passed++;
    else if (report.verdict === 'warn') warned++;
    else {
      failed++;
      if (report.shotId) {
        const index = indexById.get(report.shotId);
        if (index !== undefined && !reshootIndexes.includes(index)) reshootIndexes.push(index);
      }
    }
  }
  reshootIndexes.sort((a, b) => a - b);
  return {
    // reports 已包含跳过复用的历史报告，total 直接取其长度
    total: reports.length,
    passed,
    warned,
    failed,
    skipped,
    reshootIndexes,
    reports,
  };
}

export function getProjectQaSummary(projectId: string): QaSummary {
  const reports = listQaReports({ projectId, limit: 500 });
  return summarizeReports(reports, listShots(projectId), 0);
}

/**
 * 项目级 QA 扫描：逐个检查镜头片段（默认只查尚未通过的，增量省钱）
 */
export async function reviewProjectClips(projectId: string, options: ReviewProjectOptions = {}): Promise<QaSummary> {
  const shots = listShots(projectId);
  const selected = options.shotIndexes
    ? shots.filter((shot) => options.shotIndexes!.includes(shot.index))
    : shots;

  const videoMedia = listMedia(projectId, { kind: 'video' });
  const mediaById = new Map(videoMedia.map((media) => [media.id, media]));
  const targets: Array<{ media: MediaFile; shot: Shot | null }> = [];
  for (const shot of selected) {
    for (const mediaId of shot.clipMediaIds ?? []) {
      const media = mediaById.get(mediaId);
      if (media) targets.push({ media, shot });
    }
  }

  const reports: QaReport[] = [];
  let skipped = 0;
  for (let i = 0; i < targets.length; i++) {
    const { media, shot } = targets[i];
    if (options.isCanceled?.()) throw new Error('QA 任务已取消');

    // 增量扫描：已通过的片段默认跳过，refresh=true 才重查
    if (!options.refresh) {
      const latest = getLatestQaReport(media.id);
      if (latest && latest.status === 'succeeded' && latest.verdict === 'pass') {
        skipped++;
        reports.push(latest);
        options.log?.(`QA 跳过镜头 ${shot?.index ?? '?'} 已通过的历史报告`);
        continue;
      }
    }

    options.onProgress?.(Math.round((i / targets.length) * 100), `检查镜头 ${shot?.index ?? '?'} 的片段`);
    options.log?.(`QA 检查镜头 ${shot?.index ?? '?'} 的片段（${i + 1}/${targets.length}）`);
    const report = await reviewMedia(
      { mediaId: media.id, shotId: shot?.id, source: options.source ?? 'auto' },
      options,
    );
    reports.push(report);
  }

  options.onProgress?.(100, 'QA 扫描完成');
  return summarizeReports(reports, shots, skipped);
}
