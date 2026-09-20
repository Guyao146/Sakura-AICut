import type { CanvasItem, CanvasItemVariant, MediaFile } from '@sakura/core';
import {
  createMedia,
  getCanvasItem,
  getProject,
  listCanvasEdges,
  listCanvasItems,
  updateCanvasItem,
} from '@sakura/db';
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

/** 把旧生成结果归档进 variants 抽卡记录（①抽卡折叠） */
function archiveVariant(item: CanvasItem, media: MediaFile): CanvasItemVariant[] {
  if (!item.mediaId || !item.url) return item.variants ?? [];
  const variants = (item.variants ?? []).slice();
  variants.push({
    mediaId: item.mediaId,
    url: item.url,
    prompt: item.text,
    createdAt: item.updatedAt ?? media.createdAt ?? new Date().toISOString(),
  });
  // 最多保留 24 张历史
  return variants.slice(-24);
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

  // 生成结果回填到画布节点：升级为图片节点，旧结果归档进抽卡记录
  const updated = updateCanvasItem(item.id, {
    kind: 'image',
    mediaId: media.id,
    url: media.url,
    variants: archiveVariant(item, media),
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

/* ------------------------------ ④ 整理画布 ------------------------------ */

export type CanvasOrganizeMode = 'tree-h' | 'tree-v' | 'by-role';

const GAP_X = 320;
const GAP_Y = 240;

/**
 * 整理画布：按连线做拓扑分层，横向 / 纵向展开，无连线的孤立节点堆叠在右侧。
 * 返回新的坐标，由调用方写回 DB。
 */
export function organizeCanvas(
  projectId: string,
  mode: CanvasOrganizeMode = 'tree-h',
): Array<{ itemId: string; x: number; y: number }> {
  const items = listCanvasItems(projectId);
  const edges = listCanvasEdges(projectId);
  const byId = new Map(items.map((item) => [item.id, item]));
  if (items.length === 0) return [];

  // 按角色 / 场景分组整理：把同角色的节点摆在一起
  if (mode === 'by-role') {
    return layoutByRole(items);
  }

  // 拓扑分层（Kahn）
  const indegree = new Map<string, number>();
  const out = new Map<string, string[]>();
  for (const item of items) {
    indegree.set(item.id, 0);
    out.set(item.id, []);
  }
  for (const edge of edges) {
    if (!byId.has(edge.sourceId) || !byId.has(edge.targetId)) continue;
    indegree.set(edge.targetId, (indegree.get(edge.targetId) ?? 0) + 1);
    out.get(edge.sourceId)?.push(edge.targetId);
  }

  const levels = new Map<string, number>();
  const queue: string[] = [...indegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  for (const id of queue) levels.set(id, 0);
  while (queue.length > 0) {
    const id = queue.shift()!;
    const level = levels.get(id) ?? 0;
    for (const next of out.get(id) ?? []) {
      levels.set(next, Math.max(levels.get(next) ?? 0, level + 1));
      const d = (indegree.get(next) ?? 1) - 1;
      indegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  // 有环或未处理到的节点，兜底放到第 0 层
  for (const item of items) if (!levels.has(item.id)) levels.set(item.id, 0);

  // 按层聚合
  const byLevel = new Map<number, string[]>();
  for (const [id, level] of levels) {
    if (!byLevel.has(level)) byLevel.set(level, []);
    byLevel.get(level)!.push(id);
  }

  const horizontal = mode === 'tree-h';
  const results: Array<{ itemId: string; x: number; y: number }> = [];
  const maxStack = Math.max(...[...byLevel.values()].map((arr) => arr.length), 1);

  for (const [level, ids] of [...byLevel.entries()].sort((a, b) => a[0] - b[0])) {
    ids.forEach((id, index) => {
      if (horizontal) {
        results.push({
          itemId: id,
          x: level * GAP_X,
          y: index * GAP_Y,
        });
      } else {
        results.push({
          itemId: id,
          x: index * GAP_X,
          y: level * GAP_Y,
        });
      }
    });
  }

  // 孤立节点（无任何连线）整体移到拓扑图下方，避免遮挡
  const connected = new Set<string>();
  for (const edge of edges) {
    connected.add(edge.sourceId);
    connected.add(edge.targetId);
  }
  const orphans = items.filter((item) => !connected.has(item.id));
  const orphanStartY = (maxStack + 1) * GAP_Y;
  orphans.forEach((item, index) => {
    results.push({
      itemId: item.id,
      x: index * GAP_X,
      y: orphanStartY + (Math.floor(index / 4) % 3) * GAP_Y,
    });
  });

  return results;
}

/** 按角色 / 场景分组摆放：同一 refId 的资产节点聚成一列 */
function layoutByRole(items: CanvasItem[]): Array<{ itemId: string; x: number; y: number }> {
  const groups = new Map<string, CanvasItem[]>();
  const keyOf = (item: CanvasItem): string =>
    item.role && item.role !== 'plain' ? `${item.role}:${item.refId ?? 'none'}` : `plain:${item.kind}`;
  for (const item of items) {
    const key = keyOf(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }
  const results: Array<{ itemId: string; x: number; y: number }> = [];
  [...groups.entries()].forEach(([, group], col) => {
    group.forEach((item, row) => {
      results.push({ itemId: item.id, x: col * GAP_X, y: row * GAP_Y });
    });
  });
  return results;
}

/** 应用整理结果到 DB */
export function applyCanvasLayout(layout: Array<{ itemId: string; x: number; y: number }>): void {
  for (const { itemId, x, y } of layout) {
    updateCanvasItem(itemId, { x, y });
  }
}

/* ------------------------------ ① 抽卡记录切换 ------------------------------ */

/** 切换抽卡记录展示：把指定 variant 提升为当前展示项 */
export function selectCanvasItemVariant(itemId: string, mediaId: string): CanvasItem {
  const item = getCanvasItem(itemId);
  if (!item) throw new Error(`画布素材不存在：${itemId}`);
  const variants = item.variants ?? [];
  const target = variants.find((variant) => variant.mediaId === mediaId);
  if (!target) throw new Error(`抽卡记录不存在：${mediaId}`);

  // 把当前展示项归档（若与目标不同）
  const rest = variants.filter((variant) => variant.mediaId !== mediaId);
  if (item.mediaId && item.mediaId !== mediaId) {
    rest.push({
      mediaId: item.mediaId,
      url: item.url ?? '',
      prompt: item.text,
      createdAt: item.updatedAt ?? new Date().toISOString(),
    });
  }
  const updated = updateCanvasItem(itemId, {
    mediaId: target.mediaId,
    url: target.url,
    variants: rest,
  });
  return updated;
}

/** 清空抽卡记录（只保留当前展示项） */
export function clearCanvasItemVariants(itemId: string): CanvasItem {
  const item = getCanvasItem(itemId);
  if (!item) throw new Error(`画布素材不存在：${itemId}`);
  return updateCanvasItem(itemId, { variants: [] });
}
