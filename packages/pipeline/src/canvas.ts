import type { CanvasItem, MediaFile } from '@sakura/core';
import { getCanvasItem, getProject, updateCanvasItem, createMedia } from '@sakura/db';
import { runImage } from './ai';
import { saveMedia } from './storage';

/**
 * 画布节点的媒体生成（RunningHub 式"节点即计算"）
 *
 * 选中画布上的文字 / 素材节点，直接以节点文本为提示词生成图片，
 * 生成结果会回填到该节点（kind 升级为 image）。
 */

export interface GenerateCanvasImageResult {
  item: CanvasItem;
  media: MediaFile;
}

/** 为画布节点生成图片：以节点文本为提示词 */
export async function generateCanvasItemImage(
  canvasItemId: string,
  options: { aspectRatio?: string; variants?: number } = {},
): Promise<GenerateCanvasImageResult> {
  const item = getCanvasItem(canvasItemId);
  if (!item) throw new Error(`画布素材不存在：${canvasItemId}`);
  const project = getProject(item.projectId);
  if (!project) throw new Error('项目不存在');

  const prompt = item.text.trim();
  if (!prompt) throw new Error('节点文本为空，无法生成图片');

  const result = await runImage({
    prompt,
    negativePrompt: project.brief.negativePrompt,
    aspectRatio: options.aspectRatio ?? project.brief.aspectRatio,
    count: 1,
    seed: project.brief.seed,
  });

  if (result.images.length === 0) throw new Error('图片模型未返回任何图片');

  const image = result.images[0]!;
  const source = image.url ?? image.b64;
  if (!source) throw new Error('图片模型返回的内容为空');

  const saved = await saveMedia(item.projectId, 'image', source, {
    filename: image.url ? undefined : `canvas_${item.id.slice(0, 12)}.png`,
  });
  const media = createMedia({
    projectId: item.projectId,
    kind: 'image',
    url: saved.url,
    path: saved.path,
    mime: saved.mime,
    fileSize: saved.fileSize,
    width: image.width ?? null,
    height: image.height ?? null,
    prompt,
    model: result.model ?? null,
    providerId: result.providerId,
    seed: image.seed ?? null,
    ownerType: 'canvas',
    ownerId: item.id,
  });

  // 生成结果回填到画布节点：升级为图片节点
  const updated = updateCanvasItem(item.id, {
    kind: 'image',
    mediaId: media.id,
    url: media.url,
  });

  return { item: updated, media };
}

/** 为画布节点批量生成图片（文字 → 图片） */
export async function generateCanvasItemsImage(
  canvasItemIds: string[],
  options: { aspectRatio?: string } = {},
): Promise<Array<{ itemId: string; ok: boolean; error?: string }>> {
  const results: Array<{ itemId: string; ok: boolean; error?: string }> = [];
  for (const itemId of canvasItemIds) {
    try {
      await generateCanvasItemImage(itemId, options);
      results.push({ itemId, ok: true });
    } catch (error) {
      results.push({
        itemId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}
