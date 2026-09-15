import type { Job } from '@sakura/core';
import { getAppSettings, getAsset, getShot, listAssets, listShots } from '@sakura/db';
import {
  checkShotVideo,
  failShotVideo,
  finishShotVideo,
  generateAssetImage,
  generateShotFirstFrame,
  probeProvider,
  renderTimeline,
  runText,
  submitShotVideo,
} from '@sakura/pipeline';
import { runAgentPlan } from './agent-runner';

/**
 * 任务处理器：每种 JobType 对应一个执行函数
 */

export interface HandlerContext {
  job: Job;
  /** 上报进度与阶段说明 */
  progress: (percent: number, stage?: string) => void;
  log: (message: string, level?: 'info' | 'warn' | 'error') => void;
  /** 是否已被取消（用于长任务提前退出） */
  isCanceled: () => boolean;
}

type Handler = (ctx: HandlerContext) => Promise<Record<string, unknown>>;

/** 生成单个资产图 */
const handleImageGenerate: Handler = async ({ job, progress, log }) => {
  const { assetId, variants } = job.payload as { assetId: string; variants?: number };
  const asset = getAsset(assetId);
  if (!asset) throw new Error(`资产不存在：${assetId}`);
  progress(10, `正在生成「${asset.name}」`);
  log(`开始生成资产图：${asset.name}（${asset.type}）`);
  const files = await generateAssetImage(assetId, { variants });
  progress(100, '资产图生成完成');
  return { mediaIds: files.map((file) => file.id), count: files.length };
};

/** 批量生成资产图（并发受全局配置限制） */
const handleAssetPrepare: Handler = async ({ job, progress, log, isCanceled }) => {
  const { assetIds, regenerate } = job.payload as { assetIds?: string[]; regenerate?: boolean };
  const projectId = job.projectId as string;
  const targets =
    (assetIds ?? []).length > 0
      ? (assetIds ?? [])
          .map((id) => getAsset(id))
          .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset))
      : listAssets(projectId).filter((asset) => regenerate || asset.mediaIds.length === 0);

  if (targets.length === 0) return { total: 0, succeeded: 0, failed: 0, results: [] };

  const settings = getAppSettings();
  const concurrency = Math.max(1, Math.min(settings.generationConcurrency || 3, 6));
  const results: Array<{ assetId: string; ok: boolean; error?: string }> = [];
  const queue = [...targets];
  let done = 0;

  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (;;) {
      if (isCanceled()) return;
      const asset = queue.shift();
      if (!asset) return;
      try {
        await generateAssetImage(asset.id, {});
        results.push({ assetId: asset.id, ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ assetId: asset.id, ok: false, error: message });
        log(`资产「${asset.name}」生成失败：${message}`, 'warn');
      }
      done += 1;
      progress(Math.round((done / targets.length) * 100), `已完成 ${done}/${targets.length} 个资产`);
    }
  });

  await Promise.all(workers);
  const succeeded = results.filter((item) => item.ok).length;
  return { total: targets.length, succeeded, failed: results.length - succeeded, results };
};

/** 生成单个镜头片段：提交异步任务并轮询到结束 */
const handleVideoGenerate: Handler = async ({ job, progress, log }) => {
  const { shotId, withFirstFrame } = job.payload as { shotId: string; withFirstFrame?: boolean };
  const shot = getShot(shotId);
  if (!shot) throw new Error(`镜头不存在：${shotId}`);

  if (withFirstFrame !== false && !shot.firstFrameMediaId) {
    progress(5, '正在生成首帧图');
    log(`镜头 #${shot.index}：先生成首帧图以保持角色一致性`);
    await generateShotFirstFrame(shotId);
  }

  progress(20, '正在提交视频任务');
  const { providerId, providerName, taskId } = await submitShotVideo(shotId, { withFirstFrame });
  log(`已提交到「${providerName}」，任务 ID：${taskId}`);

  const timeoutMs = Number(process.env.ASYNC_TASK_TIMEOUT ?? 1800) * 1000;
  const startedAt = Date.now();
  let lastPercent = 25;

  for (;;) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('视频任务超时（可通过 ASYNC_TASK_TIMEOUT 调大）');
    const state = await checkShotVideo(providerId, taskId);

    if (state.status === 'succeeded' && state.videoUrl) {
      const media = await finishShotVideo(shotId, state.videoUrl, {
        providerId,
        taskId,
        durationSec: state.durationSec,
      });
      progress(100, '片段生成完成');
      log(`镜头 #${shot.index} 生成完成`);
      return { mediaId: media.id, url: media.url };
    }

    if (state.status === 'failed' || state.status === 'canceled') {
      const message = state.error ?? `供应商返回状态：${state.rawStatus ?? state.status}`;
      failShotVideo(shotId, message);
      throw new Error(message);
    }

    // 供应商进度不透明时按时间线性推进，避免界面长时间无反馈
    lastPercent = Math.min(
      95,
      Math.max(lastPercent, 25 + Math.round(((Date.now() - startedAt) / timeoutMs) * 70)),
    );
    progress(lastPercent, `渲染中（${state.rawStatus ?? state.status}）`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
};

/** 批量生成镜头片段（串行提交，避免触发供应商并发限制） */
const handleShotBatch: Handler = async (ctx) => {
  const { job, progress, log, isCanceled } = ctx;
  const { shotIds, regenerate, withFirstFrame } = job.payload as {
    shotIds?: string[];
    regenerate?: boolean;
    withFirstFrame?: boolean;
  };
  const projectId = job.projectId as string;
  const targets =
    (shotIds ?? []).length > 0
      ? (shotIds ?? [])
          .map((id) => getShot(id))
          .filter((shot): shot is NonNullable<typeof shot> => Boolean(shot))
      : listShots(projectId).filter((shot) => regenerate || shot.clipMediaIds.length === 0);

  if (targets.length === 0) return { total: 0, succeeded: 0, failed: 0, results: [] };

  const results: Array<{ shotId: string; ok: boolean; error?: string }> = [];
  let done = 0;

  for (const shot of targets) {
    if (isCanceled()) break;
    try {
      await handleVideoGenerate({
        job: { ...job, payload: { shotId: shot.id, withFirstFrame } },
        progress: (percent, stage) =>
          progress(Math.round(((done + percent / 100) / targets.length) * 100), stage ?? `镜头 #${shot.index}`),
        log,
        isCanceled,
      });
      results.push({ shotId: shot.id, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ shotId: shot.id, ok: false, error: message });
      log(`镜头 #${shot.index} 失败：${message}`, 'warn');
      failShotVideo(shot.id, message);
    }
    done += 1;
    progress(Math.round((done / targets.length) * 100), `已完成 ${done}/${targets.length} 个镜头`);
  }

  const succeeded = results.filter((item) => item.ok).length;
  return { total: targets.length, succeeded, failed: results.length - succeeded, results };
};

/** 时间线渲染导出 */
const handleTimelineRender: Handler = async ({ job, progress, log }) => {
  const projectId = job.projectId as string;
  const { includeSubtitles } = job.payload as { includeSubtitles?: boolean };
  progress(5, '正在渲染');
  const result = await renderTimeline(projectId, {
    includeSubtitles: includeSubtitles !== false,
    onProgress: (percent, message) => progress(Math.max(5, percent), message),
  });
  log(`渲染完成，用时 ${(result.elapsedMs / 1000).toFixed(1)} 秒`);
  return { outputUrl: result.outputUrl, durationSec: result.durationSec };
};

/** Agent 计划执行 */
const handleAgentRun: Handler = async (ctx) => {
  const { planId, autoApprove } = ctx.job.payload as { planId: string; autoApprove?: boolean };
  return runAgentPlan(planId, { ...ctx, autoApprove: autoApprove ?? false });
};

/** 通用文本生成（Agent 与外部调用都可能用到） */
const handleTextGenerate: Handler = async ({ job, log }) => {
  const payload = job.payload as {
    system?: string;
    prompt?: string;
    messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    json?: boolean;
  };
  const messages =
    payload.messages ??
    [
      ...(payload.system ? [{ role: 'system' as const, content: payload.system }] : []),
      { role: 'user' as const, content: payload.prompt ?? '' },
    ];
  const result = await runText({ messages, json: payload.json });
  log(`文本生成完成（模型：${result.model ?? '未返回'}）`);
  return { text: result.text, usage: result.usage ?? null };
};

/** 供应商连通性检测 */
const handleProviderProbe: Handler = async ({ job }) => {
  const { providerId } = job.payload as { providerId: string };
  return { ...(await probeProvider(providerId)) };
};

export const HANDLERS: Record<string, Handler> = {
  'image.generate': handleImageGenerate,
  'asset.prepare': handleAssetPrepare,
  'video.generate': handleVideoGenerate,
  'shot.batchGenerate': handleShotBatch,
  'timeline.render': handleTimelineRender,
  'agent.run': handleAgentRun,
  'text.generate': handleTextGenerate,
  'provider.probe': handleProviderProbe,
};
