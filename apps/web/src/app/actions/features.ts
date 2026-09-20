'use server';

import { revalidatePath } from 'next/cache';
import type { ReplicateAnalysis, ScreenplayVersion, ShotPreviewPlan, VideoRedraw } from '@sakura/core';
import type { ActionResult } from './project';

/**
 * 流程层功能 Server Actions：
 * ⑦ 智能预演 / ⑧ 剧本版本 / ⑩ 爆款复刻 / 重制转绘
 */

function toError(error: unknown): ActionResult<never> {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[action]', message);
  return { ok: false, error: message };
}

function refresh(projectId: string): void {
  revalidatePath(`/studio/${projectId}`);
}

/* ------------------------------ ⑦ 智能预演 ------------------------------ */

/** 规划预演（纯计算，不调模型）：返回一致性提示词与逐镜头首帧提示词 */
export async function planShotPreviewAction(
  projectId: string,
  shotIds?: string[],
): Promise<ActionResult<ShotPreviewPlan>> {
  try {
    const { planShotPreview } = await import('@sakura/pipeline');
    const plan = planShotPreview(projectId, shotIds);
    return { ok: true, data: plan };
  } catch (error) {
    return toError(error);
  }
}

/** 执行预演：批量生成首帧图（调模型，耗时） */
export async function runShotPreviewAction(
  projectId: string,
  shotIds?: string[],
): Promise<ActionResult<Array<{ shotId: string; ok: boolean; url?: string; error?: string }>>> {
  try {
    const { planShotPreview, runShotPreview } = await import('@sakura/pipeline');
    const { getProject } = await import('@sakura/db');
    const plan = planShotPreview(projectId, shotIds);
    const project = getProject(projectId);
    const results = await runShotPreview(plan, {
      projectId,
      aspectRatio: project?.brief.aspectRatio,
      negativePrompt: project?.brief.negativePrompt,
      seed: project?.brief.seed,
    });
    refresh(projectId);
    return { ok: true, data: results };
  } catch (error) {
    return toError(error);
  }
}

/* ------------------------------ ⑧ 剧本版本 ------------------------------ */

export async function listScreenplayVersionsAction(
  projectId: string,
): Promise<ActionResult<ScreenplayVersion[]>> {
  try {
    const { listVersions } = await import('@sakura/pipeline');
    return { ok: true, data: listVersions(projectId) };
  } catch (error) {
    return toError(error);
  }
}

export async function saveScreenplayVersionAction(
  projectId: string,
  raw: string,
  title?: string,
): Promise<ActionResult<ScreenplayVersion>> {
  try {
    const { saveScreenplayVersion } = await import('@sakura/pipeline');
    const version = saveScreenplayVersion({ projectId, raw, title, source: 'ai' });
    refresh(projectId);
    return { ok: true, data: version };
  } catch (error) {
    return toError(error);
  }
}

export async function rollbackScreenplayVersionAction(
  versionId: string,
): Promise<ActionResult<ScreenplayVersion>> {
  try {
    const { rollbackToVersion } = await import('@sakura/pipeline');
    const version = rollbackToVersion(versionId);
    refresh(version.projectId);
    return { ok: true, data: version };
  } catch (error) {
    return toError(error);
  }
}

/* ------------------------------ ⑩ 爆款复刻 ------------------------------ */

export async function analyzeReferenceAction(
  reference: string,
  options: { keepStyle?: boolean } = {},
): Promise<ActionResult<ReplicateAnalysis>> {
  try {
    const { analyzeReference } = await import('@sakura/pipeline');
    const analysis = await analyzeReference(reference, options);
    return { ok: true, data: analysis };
  } catch (error) {
    return toError(error);
  }
}

/* ------------------------------ 重制转绘 / 一键出海 ------------------------------ */

export async function listRedrawsAction(projectId: string): Promise<ActionResult<VideoRedraw[]>> {
  try {
    const { listRedraws } = await import('@sakura/pipeline');
    return { ok: true, data: listRedraws(projectId) };
  } catch (error) {
    return toError(error);
  }
}

export async function createRedrawAction(input: {
  projectId: string;
  sourceMediaId: string;
  characterPrompt?: string | null;
  stylePrompt?: string | null;
  aspectRatio?: string | null;
  scenePrompt?: string | null;
  extraPrompt?: string | null;
  segmentDurationSec?: number;
}): Promise<ActionResult<VideoRedraw>> {
  try {
    const { createRedraw } = await import('@sakura/pipeline');
    const redraw = createRedraw(input);
    refresh(input.projectId);
    return { ok: true, data: redraw };
  } catch (error) {
    return toError(error);
  }
}

/** 抽取关键帧（ffmpeg，快）：从原片按每段时长抽帧并登记 */
export async function extractKeyframesAction(
  redrawId: string,
): Promise<ActionResult<VideoRedraw>> {
  try {
    const { extractKeyframes, getRedraw } = await import('@sakura/pipeline');
    const redraw = await extractKeyframes(redrawId);
    refresh(redraw.projectId);
    return { ok: true, data: getRedraw(redrawId) ?? redraw };
  } catch (error) {
    return toError(error);
  }
}

/** 登记关键帧后执行重绘（调模型，耗时） */
export async function processRedrawAction(
  redrawId: string,
  keyframes?: Array<{ timeSec: number; url: string }>,
): Promise<ActionResult<VideoRedraw>> {
  try {
    const { getRedraw, registerKeyframes, processRedrawKeyframes } = await import('@sakura/pipeline');
    if (keyframes && keyframes.length > 0) {
      registerKeyframes(redrawId, keyframes);
    }
    const redraw = await processRedrawKeyframes(redrawId);
    refresh(redraw.projectId);
    return { ok: true, data: getRedraw(redrawId) ?? redraw };
  } catch (error) {
    return toError(error);
  }
}
