import type { MediaFile, Shot } from '@sakura/core';
import { buildShotImagePrompt, buildShotVideoPrompt, findCameraMove } from '@sakura/core';
import {
  appendAssetMedia,
  createMedia,
  getAsset,
  getMedia,
  getProject,
  getShot,
  loadContent,
  updateAsset,
  updateShot,
} from '@sakura/db';
import { queryVideoTask, runImage, submitVideo } from './ai';
import { readAsDataUri, saveMedia } from './storage';

/**
 * 媒体生成：资产图 / 分镜首帧 / 镜头视频片段
 */

/** 生成某个资产的参考图（可能返回多张） */
export async function generateAssetImage(
  assetId: string,
  options: { regenerate?: boolean; variants?: number } = {},
): Promise<MediaFile[]> {
  const asset = getAsset(assetId);
  if (!asset) throw new Error(`资产不存在：${assetId}`);
  const project = getProject(asset.projectId);
  if (!project) throw new Error('项目不存在');

  updateAsset(assetId, { status: 'running', error: null });

  try {
    const count = Math.max(1, Math.min(options.variants ?? asset.variants ?? 1, 4));
    const result = await runImage({
      prompt: asset.prompt || asset.name,
      negativePrompt: asset.negativePrompt ?? project.brief.negativePrompt,
      aspectRatio: asset.type === 'character' ? '1:1' : project.brief.aspectRatio,
      count,
      seed: asset.seed ?? project.brief.seed,
    });

    if (result.images.length === 0) throw new Error('图片模型未返回任何图片');

    const created: MediaFile[] = [];
    for (const image of result.images) {
      const source = image.url ?? image.b64;
      if (!source) continue;
      const saved = await saveMedia(asset.projectId, 'image', source, {
        filename: image.url ? undefined : `${asset.name.replace(/\s+/g, '_')}.png`,
      });
      const media = createMedia({
        projectId: asset.projectId,
        kind: 'image',
        url: saved.url,
        path: saved.path,
        mime: saved.mime,
        fileSize: saved.fileSize,
        width: image.width ?? null,
        height: image.height ?? null,
        prompt: asset.prompt,
        negativePrompt: asset.negativePrompt,
        model: result.model ?? null,
        providerId: result.providerId,
        seed: image.seed ?? asset.seed ?? null,
        ownerType: 'asset',
        ownerId: assetId,
      });
      appendAssetMedia(assetId, media.id);
      created.push(media);
    }

    updateAsset(assetId, { status: 'succeeded', error: null });
    return created;
  } catch (error) {
    updateAsset(assetId, { status: 'failed', error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/** 为镜头生成首帧图（图生视频用，显著提升一致性） */
export async function generateShotFirstFrame(shotId: string): Promise<MediaFile> {
  const shot = getShot(shotId);
  if (!shot) throw new Error(`镜头不存在：${shotId}`);
  const content = loadContent(shot.projectId);
  const characters = (content.screenplay?.characters ?? []).filter((c) => shot.characterIds.includes(c.id));
  const location = content.screenplay?.locations.find((l) => l.id === shot.locationId) ?? null;

  const prompt = buildShotImagePrompt({
    shot,
    characters,
    location,
    style: content.project.brief.style,
    aspectRatio: content.project.brief.aspectRatio,
  });

  // 把人物资产图内联给图片模型，尽量保持角色一致性
  const referenceImages: string[] = [];
  for (const character of characters) {
    const asset = content.assets.find((a) => a.type === 'character' && a.name === character.name);
    const mediaId = asset?.mediaIds[0];
    if (!mediaId) continue;
    const media = getMedia(mediaId);
    if (!media?.path) continue;
    const dataUri = readAsDataUri(media.path);
    if (dataUri) referenceImages.push(dataUri);
  }

  const result = await runImage({
    prompt,
    negativePrompt: content.project.brief.negativePrompt,
    aspectRatio: content.project.brief.aspectRatio,
    count: 1,
    referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
  });
  const image = result.images[0];
  if (!image) throw new Error('首帧图生成失败：模型未返回图片');
  const source = image.url ?? image.b64;
  if (!source) throw new Error('首帧图生成失败：结果为空');

  const saved = await saveMedia(shot.projectId, 'image', source);
  const media = createMedia({
    projectId: shot.projectId,
    kind: 'image',
    url: saved.url,
    path: saved.path,
    mime: saved.mime,
    fileSize: saved.fileSize,
    prompt,
    model: result.model ?? null,
    providerId: result.providerId,
    ownerType: 'shot',
    ownerId: shotId,
  });
  updateShot(shotId, { firstFrameMediaId: media.id });
  return media;
}

/* ============================ 镜头视频片段 ============================ */

/** 组装镜头视频请求（运镜模板 + 人物/场景 + 首尾帧） */
export function buildShotVideoRequest(shotId: string, options: { withFirstFrame?: boolean } = {}) {
  const shot = getShot(shotId);
  if (!shot) throw new Error(`镜头不存在：${shotId}`);
  const content = loadContent(shot.projectId);
  const characters = (content.screenplay?.characters ?? []).filter((c) => shot.characterIds.includes(c.id));
  const location = content.screenplay?.locations.find((l) => l.id === shot.locationId) ?? null;

  const camera = shot.cameraTemplateId ? findCameraMove(shot.cameraTemplateId) : undefined;
  const cameraPrompt = shot.cameraPrompt || camera?.prompt || 'static camera, cinematic framing';
  const firstFrameMedia = shot.firstFrameMediaId ? getMedia(shot.firstFrameMediaId) : null;

  const prompt = buildShotVideoPrompt({
    shot,
    cameraPrompt,
    characters,
    location,
    style: content.project.brief.style,
    aspectRatio: content.project.brief.aspectRatio,
    hasFirstFrame: Boolean(firstFrameMedia?.path),
  });

  const firstFrameImage =
    options.withFirstFrame !== false && firstFrameMedia?.path ? readAsDataUri(firstFrameMedia.path) ?? undefined : undefined;

  return {
    shot,
    prompt,
    firstFrameImage,
    request: {
      prompt,
      negativePrompt: shot.negativePrompt ?? content.project.brief.negativePrompt,
      durationSec: shot.durationSec,
      aspectRatio: content.project.brief.aspectRatio,
      firstFrameImage,
      seed: content.project.brief.seed,
    },
  };
}

/** 提交镜头视频任务，返回供应商任务句柄 */
export async function submitShotVideo(
  shotId: string,
  options: { withFirstFrame?: boolean } = {},
): Promise<{ providerId: string; providerName: string; taskId: string }> {
  const { request } = buildShotVideoRequest(shotId, options);
  updateShot(shotId, { status: 'running', error: null });
  try {
    const result = await submitVideo(request);
    updateShot(shotId, { status: 'running', error: null });
    return { providerId: result.providerId, providerName: result.providerName, taskId: result.handle.taskId };
  } catch (error) {
    updateShot(shotId, { status: 'failed', error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/** 查询一次任务状态 */
export async function checkShotVideo(providerId: string, taskId: string) {
  return queryVideoTask(providerId, taskId);
}

/** 任务完成后落盘并绑定到镜头 */
export async function finishShotVideo(shotId: string, videoUrl: string, meta: { providerId: string; taskId: string; durationSec?: number }): Promise<MediaFile> {
  const shot = getShot(shotId);
  if (!shot) throw new Error(`镜头不存在：${shotId}`);
  const saved = await saveMedia(shot.projectId, 'video', videoUrl);
  const media = createMedia({
    projectId: shot.projectId,
    kind: 'video',
    url: saved.url,
    path: saved.path,
    mime: saved.mime,
    fileSize: saved.fileSize,
    durationSec: meta.durationSec ?? shot.durationSec,
    prompt: shot.prompt,
    providerId: meta.providerId,
    ownerType: 'shot',
    ownerId: shotId,
  });
  const clipMediaIds = [...shot.clipMediaIds, media.id];
  updateShot(shotId, {
    clipMediaIds,
    status: 'succeeded',
    // 第一个可用的片段自动选中，方便第五步直接进时间线
    selectedMediaId: shot.selectedMediaId ?? media.id,
    error: null,
  });
  return media;
}

/** 标记镜头生成失败 */
export function failShotVideo(shotId: string, error: string): void {
  updateShot(shotId, { status: 'failed', error });
}

/** 重置镜头状态（取消任务时用） */
export function resetShotStatus(shotId: string, status: Shot['status'] = 'pending'): void {
  updateShot(shotId, { status, error: null });
}
