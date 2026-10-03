import type { CanvasAiInput, CanvasAiSnapshot, Job } from '@sakura/core';
import { ASPECT_RATIOS, getCanvasNodeJobStates, isActiveJob } from '@sakura/core';
import { createJob, getCanvasItem, getProject, listJobs, transaction, updateAsset, updateCanvasItem, updateShot } from '@sakura/db';
import { assertCanvasAiSnapshot, routeFor } from '@sakura/pipeline';

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

export function enqueueQaReview(
  projectId: string,
  options: { shotIndexes?: number[]; withVision?: boolean; autoFlag?: boolean; refresh?: boolean } = {},
): Job {
  return createJob({
    type: 'qa.review',
    projectId,
    payload: {
      shotIndexes: options.shotIndexes,
      withVision: options.withVision ?? true,
      autoFlag: options.autoFlag ?? true,
      refresh: options.refresh ?? false,
    },
    targetType: 'project',
    targetId: projectId,
    stageLabel: options.refresh ? '排队重新 QA 检查全部片段' : '排队 QA 检查已生成片段',
    priority: 8,
  });
}

export function enqueueCanvasGenerate(input: {
  projectId: string;
  canvasItemIds: string[];
  aspectRatio?: string;
}): Job {
  const project = getProject(input.projectId);
  if (!project) throw new Error('项目不存在');
  if (!Array.isArray(input.canvasItemIds) || input.canvasItemIds.some((id) => typeof id !== 'string')) {
    throw new Error('节点参数不正确');
  }
  const ids = [...new Set(input.canvasItemIds)];
  if (ids.length === 0 || ids.length > 200) throw new Error('请选择 1–200 个节点');
  const aspectRatio = input.aspectRatio ?? project.brief.aspectRatio;
  if (!Object.hasOwn(ASPECT_RATIOS, aspectRatio)) throw new Error('不支持的画幅比例');
  // 只检查配置，不请求模型；缺少模型时在入队前反馈，避免无意义的排队。
  const route = routeFor('image');
  if (!route.adapter.image) throw new Error('当前图片路由不支持生图，请更换模型');

  return transaction(() => {
    const active = getCanvasNodeJobStates(listJobs({
      projectId: input.projectId, status: ['pending', 'queued', 'running'], limit: -1,
    }), input.projectId);
    for (const id of ids) {
      const item = getCanvasItem(id);
      if (!item || item.projectId !== input.projectId) throw new Error('选中的节点不存在或不属于当前项目');
      if (item.kind !== 'text' && item.kind !== 'image') throw new Error('仅文字和图片节点支持图片生成');
      if (!item.text.trim()) throw new Error('请先填写节点提示词');
      const state = active.get(id);
      if (state && isActiveJob(state)) throw new Error('部分节点已在排队或生成，请勿重复提交');
    }
    return createJob({
      type: 'canvas.generate', projectId: input.projectId,
      payload: { canvasItemIds: ids, aspectRatio },
      targetType: 'project', targetId: input.projectId,
      stageLabel: `排队生成 ${ids.length} 个画布素材`, priority: 5,
    });
  });
}

/** 单节点 AI 操作复用画布队列，使状态、取消和重试与已有生图入口一致。 */
export function enqueueCanvasAi(
  projectId: string,
  itemId: string,
  input: CanvasAiInput,
  retrySnapshot?: CanvasAiSnapshot,
): Job {
  if (!input || !['optimize', 'generate'].includes(input.operation)) throw new Error('不支持的 AI 操作');
  for (const value of [input.instruction, input.sourceText, input.voice]) {
    if (value !== undefined && (typeof value !== 'string' || value.length > 20000)) throw new Error('输入须为不超过 20000 字的文字');
  }
  if (input.durationSec !== undefined && (!Number.isFinite(input.durationSec) || input.durationSec < 1 || input.durationSec > 120)) {
    throw new Error('视频时长须为 1–120 秒，实际支持范围取决于模型');
  }
  return transaction(() => {
    const project = getProject(projectId);
    const item = getCanvasItem(itemId);
    if (!project) throw new Error('项目不存在');
    if (!item || item.projectId !== projectId) throw new Error('节点不存在或不属于当前项目');
    const active = getCanvasNodeJobStates(listJobs({ projectId, status: ['pending', 'queued', 'running'], limit: -1 }), projectId);
    if (active.has(itemId)) throw new Error('节点已在排队或生成，请勿重复提交');
    if (retrySnapshot) assertCanvasAiSnapshot(retrySnapshot, item);
    const sourceText = input.sourceText ?? item.text;
    const instruction = input.instruction?.trim() ?? '';
    if (!sourceText.trim() && !instruction) throw new Error('请输入要求或节点文字');
    const aspectRatio = input.aspectRatio ?? project.brief.aspectRatio;
    if (!Object.hasOwn(ASPECT_RATIOS, aspectRatio)) throw new Error('不支持的画幅比例');
    const capability = input.operation === 'optimize' ? 'text' : item.kind;
    const route = routeFor(capability);
    if (capability === 'image' && !route.adapter.image) throw new Error('当前路由不支持图片生成');
    if (capability === 'audio' && !route.adapter.audio) throw new Error('当前路由不支持语音合成');
    if (capability === 'video' && (!route.adapter.submitVideo || !route.adapter.queryVideo)) throw new Error('当前路由不支持视频生成与查询');
    // 保存编辑框草稿与入队同一事务；校验失败不改动节点。
    if (!retrySnapshot && sourceText !== item.text) updateCanvasItem(itemId, { text: sourceText });
    const ai: CanvasAiSnapshot = retrySnapshot ?? {
      operation: input.operation, sourceText, instruction, aspectRatio,
      durationSec: input.durationSec, voice: input.voice?.trim(),
      itemId, kind: item.kind, role: item.role ?? 'plain', refId: item.refId ?? null,
      expectedText: sourceText, expectedMediaId: item.mediaId ?? null, expectedUrl: item.url ?? null,
    };
    return createJob({ type: 'canvas.generate', projectId, payload: { canvasItemIds: [itemId], ai },
      targetType: 'project', targetId: projectId, priority: 5, maxAttempts: 1,
      stageLabel: input.operation === 'optimize' ? '排队 AI 优化节点文字' : '排队 AI 生成节点内容' });
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
