import type { Job } from '@sakura/core';
import { createJob, updateAsset, updateShot } from '@sakura/db';

/**
 * Web 侧任务入队：把昂贵的生成动作丢给 worker 执行
 */

export function enqueueAssetImage(input: {
  projectId: string;
  assetId: string;
  regenerate?: boolean;
}): Job {
  updateAsset(input.assetId, { status: 'queued', error: null });
  return createJob({
    type: 'image.generate',
    projectId: input.projectId,
    payload: { assetId: input.assetId, regenerate: input.regenerate ?? false },
    targetType: 'asset',
    targetId: input.assetId,
    stageLabel: '排队等待生成资产图',
    priority: 5,
  });
}

export function enqueueShotVideo(input: {
  projectId: string;
  shotId: string;
  regenerate?: boolean;
  withFirstFrame?: boolean;
  /** 覆盖提示词（片段重拍） */
  prompt?: string;
  /** 覆盖时长 */
  durationSec?: number;
  /** 参考图媒体 ID */
  referenceMediaIds?: string[];
}): Job {
  updateShot(input.shotId, { status: 'queued', error: null });
  return createJob({
    type: 'video.generate',
    projectId: input.projectId,
    payload: {
      shotId: input.shotId,
      regenerate: input.regenerate ?? false,
      withFirstFrame: input.withFirstFrame ?? true,
      prompt: input.prompt,
      durationSec: input.durationSec,
      referenceMediaIds: input.referenceMediaIds,
    },
    targetType: 'shot',
    targetId: input.shotId,
    stageLabel: input.prompt ? '片段重拍中' : '排队等待生成镜头片段',
    priority: 5,
  });
}

export function enqueueBatchAssetImages(projectId: string, assetIds: string[], regenerate = false): Job {
  assetIds.forEach((id) => updateAsset(id, { status: 'queued', error: null }));
  return createJob({
    type: 'asset.prepare',
    projectId,
    payload: { assetIds, regenerate },
    targetType: 'project',
    targetId: projectId,
    stageLabel: `排队生成 ${assetIds.length} 个资产图`,
  });
}

export function enqueueBatchShotVideos(projectId: string, shotIds: string[], options: { regenerate?: boolean; withFirstFrame?: boolean } = {}): Job {
  shotIds.forEach((id) => updateShot(id, { status: 'queued', error: null }));
  return createJob({
    type: 'shot.batchGenerate',
    projectId,
    payload: { shotIds, regenerate: options.regenerate ?? false, withFirstFrame: options.withFirstFrame ?? true },
    targetType: 'project',
    targetId: projectId,
    stageLabel: `排队生成 ${shotIds.length} 个镜头片段`,
  });
}

export function enqueueTimelineRender(projectId: string, options: { includeSubtitles?: boolean; preset?: string } = {}): Job {
  return createJob({
    type: 'timeline.render',
    projectId,
    payload: { includeSubtitles: options.includeSubtitles ?? true, preset: options.preset ?? 'vertical-1080p' },
    targetType: 'timeline',
    targetId: projectId,
    stageLabel: '排队等待渲染导出',
  });
}

export function enqueueCanvasGenerate(input: {
  projectId: string;
  canvasItemIds: string[];
  aspectRatio?: string;
}): Job {
  return createJob({
    type: 'canvas.generate',
    projectId: input.projectId,
    payload: { canvasItemIds: input.canvasItemIds, aspectRatio: input.aspectRatio },
    targetType: 'project',
    targetId: input.projectId,
    stageLabel: `排队生成 ${input.canvasItemIds.length} 个画布素材`,
    priority: 5,
  });
}

export function enqueueAgentPlan(projectId: string, planId: string, autoApprove: boolean): Job {
  return createJob({
    type: 'agent.run',
    projectId,
    payload: { planId, autoApprove },
    targetType: 'agent',
    targetId: planId,
    stageLabel: 'Agent 正在规划',
    maxAttempts: 1,
  });
}
