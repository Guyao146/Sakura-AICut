'use server';

import { revalidatePath } from 'next/cache';
import {
  bringCanvasItemToFront,
  createCanvasItem,
  deleteCanvasItem,
  getCanvasItem,
  listCanvasItems,
  updateCanvasItem,
  clearCanvas,
  type CreateCanvasItemInput,
  createCanvasEdge,
  deleteCanvasEdge,
  listCanvasEdges,
  createCanvasGroup,
  deleteCanvasGroup,
  getCanvasGroup,
  listCanvasGroups,
  updateCanvasGroup,
  addItemToGroup,
  removeItemFromGroup,
  mapItemGroups,
} from '@sakura/db';
import type { CanvasItem, CanvasEdge, CanvasGroup, CanvasItemKind } from '@sakura/core';
import { CANVAS_TEMPLATES } from '@sakura/core';
import type { ActionResult } from './project';
import { enqueueCanvasGenerate } from '@/lib/server/jobs';

/**
 * 无限画布素材相关 Server Actions
 */

function toError(error: unknown): ActionResult<never> {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[action]', message);
  return { ok: false, error: message };
}

function refresh(projectId: string): void {
  revalidatePath(`/studio/${projectId}`);
}

export async function listCanvasItemsAction(projectId: string): Promise<ActionResult<CanvasItem[]>> {
  try {
    const items = listCanvasItems(projectId);
    return { ok: true, data: items };
  } catch (error) {
    return toError(error);
  }
}

export async function createCanvasItemAction(
  projectId: string,
  input: Omit<CreateCanvasItemInput, 'projectId'>,
): Promise<ActionResult<CanvasItem>> {
  try {
    const item = createCanvasItem({ ...input, projectId });
    refresh(projectId);
    return { ok: true, data: item };
  } catch (error) {
    return toError(error);
  }
}

export async function updateCanvasItemAction(
  itemId: string,
  patch: Partial<
    Pick<
      CanvasItem,
      'kind' | 'text' | 'x' | 'y' | 'width' | 'height' | 'z' | 'rotation' | 'mediaId' | 'url' | 'role' | 'refId'
    >
  >,
): Promise<ActionResult<CanvasItem>> {
  try {
    const item = getCanvasItem(itemId);
    if (!item) throw new Error('画布素材不存在');
    const updated = updateCanvasItem(itemId, patch);
    refresh(item.projectId);
    return { ok: true, data: updated };
  } catch (error) {
    return toError(error);
  }
}

export async function deleteCanvasItemAction(itemId: string): Promise<ActionResult> {
  try {
    const item = getCanvasItem(itemId);
    if (!item) throw new Error('画布素材不存在');
    deleteCanvasItem(itemId);
    refresh(item.projectId);
    return { ok: true };
  } catch (error) {
    return toError(error);
  }
}

export async function bringCanvasItemToFrontAction(itemId: string): Promise<ActionResult<CanvasItem>> {
  try {
    const item = getCanvasItem(itemId);
    if (!item) throw new Error('画布素材不存在');
    const updated = bringCanvasItemToFront(itemId);
    refresh(item.projectId);
    return { ok: true, data: updated };
  } catch (error) {
    return toError(error);
  }
}


/* ------------------------------ 连线 ------------------------------ */

export async function listCanvasEdgesAction(projectId: string): Promise<ActionResult<CanvasEdge[]>> {
  try {
    return { ok: true, data: listCanvasEdges(projectId) };
  } catch (error) {
    return toError(error);
  }
}

export async function createCanvasEdgeAction(
  projectId: string,
  sourceId: string,
  targetId: string,
  label = '',
): Promise<ActionResult<CanvasEdge | null>> {
  try {
    const edge = createCanvasEdge(projectId, sourceId, targetId, label);
    // 不调用 refresh(projectId)：边的显示由客户端乐观更新（onConnect 已经把真实 id 替换回去），
    // 全页 revalidate 会触发整页重新编译，在 dev server 状态不佳时导致 “This page couldn’t load”。
    return { ok: true, data: edge };
  } catch (error) {
    return toError(error);
  }
}

export async function deleteCanvasEdgeAction(edgeId: string): Promise<ActionResult> {
  try {
    deleteCanvasEdge(edgeId);
    return { ok: true };
  } catch (error) {
    return toError(error);
  }
}

/* ------------------------------ 分组 ------------------------------ */

export async function listCanvasGroupsAction(projectId: string): Promise<ActionResult<CanvasGroup[]>> {
  try {
    return { ok: true, data: listCanvasGroups(projectId) };
  } catch (error) {
    return toError(error);
  }
}

export async function createCanvasGroupAction(
  projectId: string,
  input: { name?: string; color?: string; x?: number; y?: number; width?: number; height?: number },
): Promise<ActionResult<CanvasGroup>> {
  try {
    const group = createCanvasGroup({ ...input, projectId });
    refresh(projectId);
    return { ok: true, data: group };
  } catch (error) {
    return toError(error);
  }
}

export async function updateCanvasGroupAction(
  groupId: string,
  patch: Partial<Pick<CanvasGroup, 'name' | 'color' | 'x' | 'y' | 'width' | 'height'>>,
): Promise<ActionResult<CanvasGroup>> {
  try {
    const group = getCanvasGroup(groupId);
    if (!group) throw new Error('分组不存在');
    const updated = updateCanvasGroup(groupId, patch);
    refresh(group.projectId);
    return { ok: true, data: updated };
  } catch (error) {
    return toError(error);
  }
}


/** 成组：把多个素材打包进一个新分组，并自动计算包围盒 */
export async function groupItemsAction(
  projectId: string,
  itemIds: string[],
  name = '未命名场景',
  color?: string,
): Promise<ActionResult<CanvasGroup>> {
  try {
    const all = listCanvasItems(projectId);
    const selected = all.filter((it) => itemIds.includes(it.id));
    if (selected.length === 0) throw new Error('请先选择要成组的素材');
    const minX = Math.min(...selected.map((it) => it.x)) - 24;
    const minY = Math.min(...selected.map((it) => it.y)) - 56;
    const maxX = Math.max(...selected.map((it) => it.x + Math.max(80, it.width))) + 24;
    const maxY = Math.max(...selected.map((it) => it.y + Math.max(60, it.height))) + 24;
    const group = createCanvasGroup({
      projectId,
      name,
      color,
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    });
    for (const item of selected) addItemToGroup(group.id, item.id);
    refresh(projectId);
    return { ok: true, data: group };
  } catch (error) {
    return toError(error);
  }
}

/** 解组：移除分组但保留素材 */
export async function ungroupItemsAction(projectId: string, groupId: string): Promise<ActionResult> {
  try {
    deleteCanvasGroup(groupId);
    refresh(projectId);
    return { ok: true };
  } catch (error) {
    return toError(error);
  }
}

/* ------------------------------ 一键整理 & 模板 ------------------------------ */

const CELL_W = 360;
const CELL_H = 260;
const GAP = 48;

/** 一键整理：按素材类型分列、网格布局 */
export async function autoLayoutCanvasAction(projectId: string): Promise<ActionResult<CanvasItem[]>> {
  try {
    const items = listCanvasItems(projectId);
    const weight: Record<string, number> = { video: 0, image: 1, audio: 2, text: 3 };
    const sorted = [...items].sort((a, b) => (weight[a.kind] ?? 9) - (weight[b.kind] ?? 9));
    const cols = Math.max(1, Math.ceil(Math.sqrt(sorted.length)));
    sorted.forEach((item, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      updateCanvasItem(item.id, { x: col * (CELL_W + GAP), y: row * (CELL_H + GAP) });
    });
    const updated = listCanvasItems(projectId);
    refresh(projectId);
    return { ok: true, data: updated };
  } catch (error) {
    return toError(error);
  }
}

/** 应用画布模板（三幕式 / 起承转合 / 竖屏短剧） */
export async function applyCanvasTemplateAction(
  projectId: string,
  templateId: string,
): Promise<ActionResult<CanvasItem[]>> {
  try {
    const template = CANVAS_TEMPLATES.find((it) => it.id === templateId);
    if (!template) throw new Error(`模板 ${templateId} 不存在`);
    const baseX = 80;
    const baseY = 80;
    const created: CanvasItem[] = [];
    for (const node of template.nodes) {
      const item = createCanvasItem({
        projectId,
        kind: node.kind,
        text: node.text,
        x: baseX + node.x,
        y: baseY + node.y,
        width: node.width ?? 240,
        height: node.height ?? 70,
        z: 1,
      });
      created.push(item);
    }
    if (template.edges) {
      for (const [sourceIdx, targetIdx] of template.edges) {
        const source = created[sourceIdx];
        const target = created[targetIdx];
        if (source && target) createCanvasEdge(projectId, source.id, target.id);
      }
    }
    refresh(projectId);
    return { ok: true, data: created };
  } catch (error) {
    return toError(error);
  }
}

/* ------------------------------ 分镜批量导入 ------------------------------ */

export interface ShotImportRow {
  shotId: string;
  index: number;
  description: string;
  dialogue?: string | null;
  durationSec: number;
  shotSize: string;
  selectedMediaId?: string | null;
}

/**
 * 把第四步的分镜批量铺到画布：有选中视频片段的用视频节点，否则用文字节点。
 * 自动按镜头序号网格排列，并依次连线表达叙事顺序。
 */
export async function importShotsToCanvasAction(
  projectId: string,
  shots: ShotImportRow[],
  mediaMap: Record<string, { kind: string; url: string }>,
): Promise<ActionResult<CanvasItem[]>> {
  try {
    if (shots.length === 0) throw new Error('没有可导入的分镜');
    const cols = Math.max(1, Math.ceil(Math.sqrt(shots.length)));
    const created: CanvasItem[] = [];
    shots.forEach((shot, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const media = shot.selectedMediaId ? mediaMap[shot.selectedMediaId] : undefined;
      const kind = media?.kind === 'video' ? 'video' : media?.kind === 'image' ? 'image' : 'text';
      const label = `#${shot.index} ${shot.shotSize} · ${shot.durationSec}s\n${shot.description}${shot.dialogue ? `\n💬 ${shot.dialogue}` : ''}`;
      const item = createCanvasItem({
        projectId,
        kind,
        text: label,
        url: media?.url ?? null,
        mediaId: shot.selectedMediaId ?? null,
        x: col * (CELL_W + GAP),
        y: row * (CELL_H + GAP),
        width: kind === 'video' ? 480 : kind === 'image' ? 360 : 320,
        height: kind === 'text' ? 180 : 270,
        z: 1,
      });
      created.push(item);
    });
    for (let i = 0; i < created.length - 1; i++) {
      createCanvasEdge(projectId, created[i]!.id, created[i + 1]!.id);
    }
    refresh(projectId);
    return { ok: true, data: created };
  } catch (error) {
    return toError(error);
  }
}

/* ------------------------------ 画布内 AI 生成 ------------------------------ */

/**
 * 画布节点直接生成图片（入队，由 worker 执行）：
 * 以节点文本为提示词生成图片，生成结果回填到该节点。
 */
export async function generateCanvasItemsAction(
  projectId: string,
  itemIds: string[],
  options: { aspectRatio?: string } = {},
): Promise<ActionResult<{ jobId: string; count: number }>> {
  try {
    if (itemIds.length === 0) throw new Error('请先选择要生成的节点');
    const job = enqueueCanvasGenerate({ projectId, canvasItemIds: itemIds, aspectRatio: options.aspectRatio });
    refresh(projectId);
    return { ok: true, data: { jobId: job.id, count: itemIds.length } };
  } catch (error) {
    return toError(error);
  }
}

/** 导入画布快照 JSON：批量还原素材布局与连线 */
export async function importCanvasJsonAction(
  projectId: string,
  snapshot: {
    items: Array<{
      kind: string;
      text?: string;
      url?: string | null;
      x?: number;
      y?: number;
      width?: number;
      height?: number;
    }>;
    edges?: Array<[number, number]>;
  },
): Promise<ActionResult<CanvasItem[]>> {
  try {
    if (!snapshot?.items?.length) throw new Error('快照中没有素材');
    const created: CanvasItem[] = [];
    for (const node of snapshot.items) {
      const kind = (['text', 'image', 'video', 'audio'].includes(node.kind) ? node.kind : 'text') as CanvasItemKind;
      const item = createCanvasItem({
        projectId,
        kind,
        text: node.text ?? '',
        url: node.url ?? null,
        x: node.x ?? Math.random() * 400,
        y: node.y ?? Math.random() * 400,
        width: node.width,
        height: node.height,
        z: 1,
      });
      created.push(item);
    }
    // 按下标重建连线
    if (snapshot.edges) {
      for (const [sourceIdx, targetIdx] of snapshot.edges) {
        const source = created[sourceIdx];
        const target = created[targetIdx];
        if (source && target) createCanvasEdge(projectId, source.id, target.id);
      }
    }
    refresh(projectId);
    return { ok: true, data: created };
  } catch (error) {
    return toError(error);
  }
}

export async function deleteCanvasGroupAction(groupId: string): Promise<ActionResult> {
  try {
    const group = getCanvasGroup(groupId);
    if (!group) throw new Error('分组不存在');
    deleteCanvasGroup(groupId);
    refresh(group.projectId);
    return { ok: true };
  } catch (error) {
    return toError(error);
  }
}

export async function clearCanvasAction(projectId: string): Promise<ActionResult> {
  try {
    clearCanvas(projectId);
    refresh(projectId);
    return { ok: true };
  } catch (error) {
    return toError(error);
  }
}

/* ------------------------------ ① 抽卡记录 ------------------------------ */

/** 切换抽卡记录展示：把指定历史记录提升为当前展示项 */
export async function selectCanvasItemVariantAction(
  itemId: string,
  mediaId: string,
): Promise<ActionResult<CanvasItem>> {
  try {
    const item = getCanvasItem(itemId);
    if (!item) throw new Error('画布素材不存在');
    const { selectCanvasItemVariant } = await import('@sakura/pipeline');
    const updated = selectCanvasItemVariant(itemId, mediaId);
    refresh(item.projectId);
    return { ok: true, data: updated };
  } catch (error) {
    return toError(error);
  }
}

/** 清空抽卡记录（只保留当前展示项） */
export async function clearCanvasItemVariantsAction(itemId: string): Promise<ActionResult<CanvasItem>> {
  try {
    const item = getCanvasItem(itemId);
    if (!item) throw new Error('画布素材不存在');
    const { clearCanvasItemVariants } = await import('@sakura/pipeline');
    const updated = clearCanvasItemVariants(itemId);
    refresh(item.projectId);
    return { ok: true, data: updated };
  } catch (error) {
    return toError(error);
  }
}

/* ------------------------------ ④ 整理画布 ------------------------------ */

/** 整理画布：按连线拓扑分层排布 */
export async function organizeCanvasAction(
  projectId: string,
  mode: 'tree-h' | 'tree-v' | 'by-role' = 'tree-h',
): Promise<ActionResult<{ count: number }>> {
  try {
    const { organizeCanvas, applyCanvasLayout } = await import('@sakura/pipeline');
    const layout = organizeCanvas(projectId, mode);
    applyCanvasLayout(layout);
    refresh(projectId);
    return { ok: true, data: { count: layout.length } };
  } catch (error) {
    return toError(error);
  }
}

/* ------------------------------ ⑥ 节点工具 ------------------------------ */

/** 提示词反解析：图片 → 可复用提示词 */
export async function reverseParseNodeImageAction(itemId: string): Promise<ActionResult<{ prompt: string }>> {
  try {
    const item = getCanvasItem(itemId);
    if (!item) throw new Error('画布素材不存在');
    const { reverseParseNodeImage } = await import('@sakura/pipeline');
    const result = await reverseParseNodeImage(itemId);
    refresh(item.projectId);
    return { ok: true, data: result };
  } catch (error) {
    return toError(error);
  }
}

/** 智能打光 */
export async function relightNodeAction(
  itemId: string,
  lighting: { direction: string; quality?: string; tone?: string },
): Promise<ActionResult<CanvasItem>> {
  try {
    const item = getCanvasItem(itemId);
    if (!item) throw new Error('画布素材不存在');
    const { relightNode } = await import('@sakura/pipeline');
    await relightNode(itemId, lighting as never);
    refresh(item.projectId);
    return { ok: true, data: getCanvasItem(itemId)! };
  } catch (error) {
    return toError(error);
  }
}

/** 镜头调节（取景角度 / 景别） */
export async function adjustNodeCameraAngleAction(
  itemId: string,
  angle: string,
  shotSize: string,
): Promise<ActionResult<CanvasItem>> {
  try {
    const item = getCanvasItem(itemId);
    if (!item) throw new Error('画布素材不存在');
    const { adjustNodeCameraAngle } = await import('@sakura/pipeline');
    await adjustNodeCameraAngle(itemId, angle as never, shotSize);
    refresh(item.projectId);
    return { ok: true, data: getCanvasItem(itemId)! };
  } catch (error) {
    return toError(error);
  }
}

/* ------------------------------ ③ 运镜库插入 ------------------------------ */

/** 把运镜模板插入选中节点（写入节点文本尾部，或给镜头节点设置运镜） */
export async function insertCameraMoveAction(
  itemId: string,
  cameraId: string,
): Promise<ActionResult<CanvasItem>> {
  try {
    const item = getCanvasItem(itemId);
    if (!item) throw new Error('画布素材不存在');
    const { findCameraMove } = await import('@sakura/core');
    const move = findCameraMove(cameraId);
    if (!move) throw new Error(`运镜模板不存在：${cameraId}`);
    const updated = updateCanvasItem(itemId, {
      text: `${item.text}\n[运镜] ${move.name}：${move.prompt}`,
    });
    refresh(item.projectId);
    return { ok: true, data: updated };
  } catch (error) {
    return toError(error);
  }
}

/* ------------------------------ ⑨ 资产节点 ------------------------------ */

/** 把节点升级为角色 / 场景 / 道具资产节点，并关联剧本实体 */
export async function linkNodeToAssetAction(
  itemId: string,
  role: 'character' | 'scene' | 'prop',
  refId: string,
): Promise<ActionResult<CanvasItem>> {
  try {
    const item = getCanvasItem(itemId);
    if (!item) throw new Error('画布素材不存在');
    const updated = updateCanvasItem(itemId, { role, refId });
    refresh(item.projectId);
    return { ok: true, data: updated };
  } catch (error) {
    return toError(error);
  }
}
