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
  patch: Partial<Pick<CanvasItem, 'text' | 'x' | 'y' | 'width' | 'height' | 'z' | 'rotation'>>,
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
    refresh(projectId);
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
