import type { CanvasItem, CanvasItemKind, ID } from '@sakura/core';
import { createId } from '@sakura/core';
import { buildUpdate, getDb, nowIso } from '../client';

/**
 * 无限画布素材仓储
 * 画布是完全自由的二维空间：用户导入的文字 / 图片 / 视频 / 语音都在这里持久化位置与尺寸。
 */

interface CanvasItemRow {
  id: string;
  project_id: string;
  kind: string;
  media_id: string | null;
  url: string | null;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  rotation: number;
  created_at: string;
  updated_at: string;
}

function mapItem(row: CanvasItemRow): CanvasItem {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind as CanvasItemKind,
    mediaId: row.media_id,
    url: row.url,
    text: row.text,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    z: row.z,
    rotation: row.rotation,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateCanvasItemInput {
  projectId: ID;
  kind: CanvasItemKind;
  mediaId?: ID | null;
  url?: string | null;
  text?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  z?: number;
  rotation?: number;
}

export function createCanvasItem(input: CreateCanvasItemInput): CanvasItem {
  const db = getDb();
  const now = nowIso();
  const id = `cv_${createId(12)}`;
  db.prepare(
    `INSERT INTO canvas_items (id, project_id, kind, media_id, url, text, x, y, width, height, z, rotation,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.projectId,
    input.kind,
    input.mediaId ?? null,
    input.url ?? null,
    input.text ?? '',
    input.x ?? 0,
    input.y ?? 0,
    input.width ?? 0,
    input.height ?? 0,
    input.z ?? 0,
    input.rotation ?? 0,
    now,
    now,
  );
  return getCanvasItem(id) as CanvasItem;
}

export function getCanvasItem(id: ID): CanvasItem | null {
  const row = getDb().prepare('SELECT * FROM canvas_items WHERE id = ?').get(id) as
    | CanvasItemRow
    | undefined;
  return row ? mapItem(row) : null;
}

/** 按 z 与创建时间排序，保证绘制顺序稳定 */
export function listCanvasItems(projectId: ID): CanvasItem[] {
  const rows = getDb()
    .prepare('SELECT * FROM canvas_items WHERE project_id = ? ORDER BY z ASC, created_at ASC')
    .all(projectId) as unknown as CanvasItemRow[];
  return rows.map(mapItem);
}

export function updateCanvasItem(
  id: ID,
  patch: Partial<
    Pick<CanvasItem, 'text' | 'x' | 'y' | 'width' | 'height' | 'z' | 'rotation' | 'mediaId' | 'url'>
  >,
): CanvasItem {
  const fields: Record<string, unknown> = {};
  if (patch.text !== undefined) fields.text = patch.text;
  if (patch.x !== undefined) fields.x = patch.x;
  if (patch.y !== undefined) fields.y = patch.y;
  if (patch.width !== undefined) fields.width = patch.width;
  if (patch.height !== undefined) fields.height = patch.height;
  if (patch.z !== undefined) fields.z = patch.z;
  if (patch.rotation !== undefined) fields.rotation = patch.rotation;
  if (patch.mediaId !== undefined) fields.media_id = patch.mediaId;
  if (patch.url !== undefined) fields.url = patch.url;

  if (Object.keys(fields).length > 0) {
    const { sql, values } = buildUpdate('canvas_items', id, fields);
    getDb().prepare(sql).run(...(values as never[]));
  }
  return getCanvasItem(id) as CanvasItem;
}

export function deleteCanvasItem(id: ID): void {
  // 外键级联会自动清理 canvas_edges，这里做双保险
  getDb().prepare('DELETE FROM canvas_items WHERE id = ?').run(id);
}

export function clearCanvas(projectId: ID): void {
  getDb().prepare('DELETE FROM canvas_items WHERE project_id = ?').run(projectId);
}

/** 置顶：把素材移到最上层 */
export function bringCanvasItemToFront(id: ID): CanvasItem {
  const item = getCanvasItem(id);
  if (!item) throw new Error('画布素材不存在');
  const maxZ = getDb()
    .prepare('SELECT COALESCE(MAX(z), 0) AS max_z FROM canvas_items WHERE project_id = ?')
    .get(item.projectId) as { max_z: number };
  return updateCanvasItem(id, { z: (maxZ.max_z ?? 0) + 1 });
}
