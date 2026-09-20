import type { MediaFile, Shot, ShotPreviewPlan } from '@sakura/core';
import { getShot, listShots, loadContent, updateShot } from '@sakura/db';
import { createMedia } from '@sakura/db';
import { runImage } from './ai';
import { saveMedia } from './storage';

/**
 * 智能预演（⑦，对齐小云雀智能预演）
 *
 * 思路：为一组连续镜头统一规划「关键分镜图（首帧）」，
 * 把角色外观、场景氛围锁定成统一提示词前缀，逐镜头生成首帧图片。
 * 视频生成时以首帧为锚，多镜头间的人物动作与空间逻辑更一致，抽卡率显著下降。
 */

/** 从剧本人物卡派生一致性锁定提示词 */
function buildConsistencyPrompt(
  characters: Array<{ id: string; appearance?: string; costume?: string; prompt?: string }>,
): string {
  return characters
    .map((character) => character.prompt || [character.appearance, character.costume].filter(Boolean).join(', '))
    .filter(Boolean)
    .join('. ');
}

interface PreviewContext {
  /** 项目 ID */
  projectId: string;
  /** 画面比例 */
  aspectRatio?: string;
  /** 负面提示词 */
  negativePrompt?: string;
  /** 种子（锁定同一组镜头的随机性） */
  seed?: number;
}

/**
 * 规划预演：选定镜头、生成统一一致性提示词与逐镜头首帧提示词。
 * 不调用任何模型，纯计算，可在「预览计划」面板展示。
 */
export function planShotPreview(projectId: string, shotIds?: string[]): ShotPreviewPlan {
  const content = loadContent(projectId);
  const allShots = listShots(projectId);
  const screenplay = content.screenplay;

  let shots: Shot[];
  if (shotIds && shotIds.length > 0) {
    shots = shotIds
      .map((id) => allShots.find((shot) => shot.id === id))
      .filter((shot): shot is Shot => Boolean(shot));
  } else {
    // 默认选 2-6 个连续镜头（优先选还没首帧的）
    const candidates = allShots.filter((shot) => !shot.firstFrameMediaId);
    shots = (candidates.length >= 2 ? candidates : allShots).slice(0, 6);
  }
  if (shots.length < 2) throw new Error('至少需要 2 个镜头才能做智能预演');

  const characterIds = new Set<string>();
  shots.forEach((shot) => shot.characterIds.forEach((id) => characterIds.add(id)));
  const characters = (screenplay?.characters ?? [])
    .filter((character) => characterIds.has(character.id))
    .map((character) => ({
      id: character.id,
      appearance: character.appearance,
      costume: character.costume,
      prompt: character.prompt,
    }));

  const locations = screenplay?.locations ?? [];
  const locationOf = (shot: Shot) => locations.find((location) => location.id === shot.locationId);

  const consistencyPrompt = buildConsistencyPrompt(characters);
  const scenePrompt = shots
    .map((shot) => locationOf(shot)?.prompt ?? locationOf(shot)?.description ?? '')
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .join(' | ');

  const framePrompts = shots.map((shot) => {
    const location = locationOf(shot);
    const parts = [
      `一致性锁定：${consistencyPrompt}`,
      location ? `场景：${location.prompt ?? location.description}` : '',
      `画面：${shot.description}`,
      shot.cameraPrompt ? `运镜起幅：${shot.cameraPrompt}` : '',
      `景别：${shot.shotSize}`,
    ].filter(Boolean);
    return { shotId: shot.id, prompt: parts.join('. ') };
  });

  return {
    shotIds: shots.map((shot) => shot.id),
    consistencyPrompt,
    scenePrompt,
    framePrompts,
  };
}

export interface PreviewResult {
  shotId: string;
  ok: boolean;
  mediaId?: string;
  url?: string;
  error?: string;
}

/**
 * 执行预演：按计划批量生成首帧图，写入 shot.firstFrameMediaId。
 * 每个镜头生成后立即落库，可随时中断。
 */
export async function runShotPreview(
  plan: ShotPreviewPlan,
  context: PreviewContext,
): Promise<PreviewResult[]> {
  const results: PreviewResult[] = [];
  for (const frame of plan.framePrompts) {
    try {
      const shot = getShot(frame.shotId);
      if (!shot) {
        results.push({ shotId: frame.shotId, ok: false, error: '镜头不存在' });
        continue;
      }
      const result = await runImage({
        prompt: `${plan.consistencyPrompt}. ${frame.prompt}`,
        negativePrompt: context.negativePrompt,
        aspectRatio: context.aspectRatio ?? '16:9',
        count: 1,
        seed: context.seed,
      });
      if (result.images.length === 0) throw new Error('图片模型未返回任何图片');
      const image = result.images[0]!;
      const source = image.url ?? image.b64;
      if (!source) throw new Error('图片模型返回的内容为空');

      const saved = await saveMedia(context.projectId, 'image', source, {
        filename: image.url ? undefined : `preview_${frame.shotId.slice(0, 12)}.png`,
      });
      const media: MediaFile = createMedia({
        projectId: context.projectId,
        kind: 'image',
        url: saved.url,
        path: saved.path,
        mime: saved.mime,
        fileSize: saved.fileSize,
        width: image.width ?? null,
        height: image.height ?? null,
        prompt: frame.prompt,
        model: result.model ?? null,
        providerId: result.providerId,
        seed: image.seed ?? null,
        ownerType: 'shot',
        ownerId: frame.shotId,
      });
      updateShot(frame.shotId, { firstFrameMediaId: media.id });
      results.push({ shotId: frame.shotId, ok: true, mediaId: media.id, url: media.url });
    } catch (error) {
      results.push({
        shotId: frame.shotId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}
