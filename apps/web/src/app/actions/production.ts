'use server';

import { revalidatePath } from 'next/cache';
import {
  createAsset,
  createCustomCameraMove,
  deleteAsset,
  deleteCustomCameraMove,
  deleteShot,
  getAsset,
  getProject,
  getShot,
  listAssets,
  listShots,
  saveTimeline,
  updateAsset,
  updateShot,
} from '@sakura/db';
import type { Asset, Shot, Timeline, Track } from '@sakura/core';
import {
  buildTimelineFromShots,
  generateShotFirstFrame,
  planAssetsFromScreenplay,
  planShotsFromScreenplay,
  refineAssetPrompt,
} from '@sakura/pipeline';
import {
  enqueueAssetImage,
  enqueueBatchAssetImages,
  enqueueBatchShotVideos,
  enqueueShotVideo,
  enqueueTimelineRender,
} from '@/lib/server/jobs';
import type { ActionResult } from './project';

/**
 * 第三 / 四 / 五步的生产动作（Server Actions）
 */

function toError(error: unknown): ActionResult<never> {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[action]', message);
  return { ok: false, error: message };
}

function refresh(projectId: string): void {
  revalidatePath(`/studio/${projectId}`);
}

/* ---------------------------- 第三步：资产 ---------------------------- */

export async function planAssetsAction(projectId: string, instructions?: string): Promise<ActionResult<Asset[]>> {
  try {
    const assets = planAssetsFromScreenplay(projectId, { instructions });
    refresh(projectId);
    return { ok: true, data: assets };
  } catch (error) {
    return toError(error);
  }
}

export async function createAssetAction(
  projectId: string,
  input: { type: Asset['type']; name: string; description?: string; prompt?: string; variants?: number },
): Promise<ActionResult<Asset>> {
  try {
    const asset = createAsset(projectId, {
      type: input.type,
      name: input.name,
      description: input.description ?? '',
      prompt: input.prompt ?? input.name,
      variants: input.variants ?? 1,
    });
    refresh(projectId);
    return { ok: true, data: asset };
  } catch (error) {
    return toError(error);
  }
}

export async function updateAssetAction(
  assetId: string,
  patch: {
    name?: string;
    description?: string;
    prompt?: string;
    negativePrompt?: string;
    variants?: number;
    locked?: boolean;
  },
): Promise<ActionResult<Asset>> {
  try {
    const asset = updateAsset(assetId, patch);
    refresh(asset.projectId);
    return { ok: true, data: asset };
  } catch (error) {
    return toError(error);
  }
}

export async function deleteAssetAction(assetId: string): Promise<ActionResult> {
  try {
    const asset = getAsset(assetId);
    if (!asset) throw new Error('资产不存在');
    deleteAsset(assetId);
    refresh(asset.projectId);
    return { ok: true };
  } catch (error) {
    return toError(error);
  }
}

export async function refineAssetPromptAction(assetId: string): Promise<ActionResult<Asset>> {
  try {
    const asset = await refineAssetPrompt(assetId);
    refresh(asset.projectId);
    return { ok: true, data: asset };
  } catch (error) {
    return toError(error);
  }
}

/** 生成资产图（入队，由 worker 执行） */
export async function generateAssetsAction(
  projectId: string,
  assetIds: string[],
  options: { regenerate?: boolean } = {},
): Promise<ActionResult<{ jobId: string; count: number }>> {
  try {
    const targets =
      assetIds.length > 0
        ? assetIds
        : listAssets(projectId)
            .filter((asset) => options.regenerate || asset.mediaIds.length === 0)
            .map((asset) => asset.id);
    if (targets.length === 0) throw new Error('没有需要生成的资产');

    const job =
      targets.length === 1
        ? enqueueAssetImage({ projectId, assetId: targets[0] as string, regenerate: options.regenerate })
        : enqueueBatchAssetImages(projectId, targets, options.regenerate ?? false);
    refresh(projectId);
    return { ok: true, data: { jobId: job.id, count: targets.length } };
  } catch (error) {
    return toError(error);
  }
}

/* ---------------------------- 第四步：分镜 ---------------------------- */

export async function planShotsAction(
  projectId: string,
  options: { maxShots?: number; cameraPreference?: string; replaceExisting?: boolean } = {},
): Promise<ActionResult<Shot[]>> {
  try {
    const shots = await planShotsFromScreenplay(projectId, options);
    refresh(projectId);
    return { ok: true, data: shots };
  } catch (error) {
    return toError(error);
  }
}

export async function updateShotAction(
  shotId: string,
  patch: Partial<
    Pick<
      Shot,
      | 'description'
      | 'dialogue'
      | 'narration'
      | 'durationSec'
      | 'shotSize'
      | 'cameraTemplateId'
      | 'cameraPrompt'
      | 'prompt'
      | 'negativePrompt'
      | 'selectedMediaId'
      | 'order'
    >
  >,
): Promise<ActionResult<Shot>> {
  try {
    const shot = updateShot(shotId, patch);
    refresh(shot.projectId);
    return { ok: true, data: shot };
  } catch (error) {
    return toError(error);
  }
}

export async function deleteShotAction(shotId: string): Promise<ActionResult> {
  try {
    const shot = getShot(shotId);
    if (!shot) throw new Error('镜头不存在');
    deleteShot(shotId);
    refresh(shot.projectId);
    return { ok: true };
  } catch (error) {
    return toError(error);
  }
}

/** 仅生成镜头首帧图（图生视频的输入） */
export async function generateFirstFrameAction(
  shotId: string,
): Promise<ActionResult<{ mediaId: string; url: string }>> {
  try {
    const media = await generateShotFirstFrame(shotId);
    const shot = getShot(shotId);
    if (shot) refresh(shot.projectId);
    return { ok: true, data: { mediaId: media.id, url: media.url } };
  } catch (error) {
    return toError(error);
  }
}

/** 生成镜头片段（入队，由 worker 执行） */
export async function generateShotsAction(
  projectId: string,
  shotIds: string[],
  options: { regenerate?: boolean; withFirstFrame?: boolean } = {},
): Promise<ActionResult<{ jobId: string; count: number }>> {
  try {
    const targets =
      shotIds.length > 0
        ? shotIds
        : listShots(projectId)
            .filter((shot) => options.regenerate || shot.clipMediaIds.length === 0)
            .map((shot) => shot.id);
    if (targets.length === 0) throw new Error('没有需要生成的镜头');

    const job =
      targets.length === 1
        ? enqueueShotVideo({
            projectId,
            shotId: targets[0] as string,
            regenerate: options.regenerate,
            withFirstFrame: options.withFirstFrame,
          })
        : enqueueBatchShotVideos(projectId, targets, options);
    refresh(projectId);
    return { ok: true, data: { jobId: job.id, count: targets.length } };
  } catch (error) {
    return toError(error);
  }
}

/* ---------------------------- 第五步：剪辑 ---------------------------- */

export async function buildTimelineAction(
  projectId: string,
  options: {
    transition?: 'none' | 'fade' | 'dissolve';
    transitionDuration?: number;
    includeSubtitles?: boolean;
  } = {},
): Promise<ActionResult<Timeline>> {
  try {
    const timeline = buildTimelineFromShots(projectId, options);
    refresh(projectId);
    return { ok: true, data: timeline };
  } catch (error) {
    return toError(error);
  }
}

/** 保存编辑器中的轨道数据（排序 / 裁剪 / 变速后） */
export async function saveTimelineTracksAction(projectId: string, tracks: Track[]): Promise<ActionResult<Timeline>> {
  try {
    const project = getProject(projectId);
    if (!project) throw new Error('项目不存在');
    const timeline = saveTimeline(projectId, { tracks });
    refresh(projectId);
    return { ok: true, data: timeline };
  } catch (error) {
    return toError(error);
  }
}

export async function renderTimelineAction(
  projectId: string,
  options: { includeSubtitles?: boolean; preset?: string } = {},
): Promise<ActionResult<{ jobId: string }>> {
  try {
    const job = enqueueTimelineRender(projectId, options);
    refresh(projectId);
    return { ok: true, data: { jobId: job.id } };
  } catch (error) {
    return toError(error);
  }
}

/* ---------------------------- 自定义运镜 ---------------------------- */

export async function createCameraMoveAction(
  projectId: string | null,
  input: { name: string; category: string; description: string; prompt: string; usage?: string },
): Promise<ActionResult<{ id: string }>> {
  try {
    const move = createCustomCameraMove({
      projectId,
      name: input.name,
      category: input.category as never,
      description: input.description,
      prompt: input.prompt,
      usage: input.usage,
      tags: ['自定义'],
    });
    if (projectId) refresh(projectId);
    revalidatePath('/settings');
    return { ok: true, data: { id: move.id } };
  } catch (error) {
    return toError(error);
  }
}

export async function deleteCameraMoveAction(projectId: string | null, id: string): Promise<ActionResult> {
  try {
    deleteCustomCameraMove(id);
    if (projectId) refresh(projectId);
    revalidatePath('/settings');
    return { ok: true };
  } catch (error) {
    return toError(error);
  }
}