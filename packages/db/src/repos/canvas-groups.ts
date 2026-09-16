import type { CanvasEdge, CanvasGroup, ID } from '@sakura/core';
import { createId } from '@sakura/core';
import { buildUpdate, getDb, nowIso } from '../client';

/**
 * 画布连线与分组仓储
 */

interface CanvasEdgeRow {
  id: string;
  project_id: string;
  source_id: string;
  target_id: string;
  label: string;
  created_at: string;
  updated_at: string;
}

interface CanvasGroupRow {
  id: string;
  project_id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  created_at: string;
  updated_at: string;
}

function mapEdge(row: CanvasEdgeRow): CanvasEdge {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceId: row.source_id,
    targetId: row.target_id,
    label: row.label,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapGroup(row: CanvasGroupRow): CanvasGroup {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    color: row.color,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    z: row.z,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* ------------------------------ 连线 ------------------------------ */

export function listCanvasEdges(projectId: ID): CanvasEdge[] {
  const rows = getDb()
    .prepare('SELECT * FROM canvas_edges WHERE project_id = ? ORDER BY created_at ASC')
    .all(projectId) as unknown as CanvasEdgeRow[];
  return rows.map(mapEdge);
}

export function createCanvasEdge(
  projectId: ID,
  sourceId: ID,
  targetId: ID,
  label = '',
): CanvasEdge | null {
  if (sourceId === targetId) return null;
  const db = getDb();
  // 防重复连线
  const exists = db
    .prepare('SELECT id FROM canvas_edges WHERE project_id = ? AND source_id = ? AND target_id = ?')
    .get(projectId, sourceId, targetId);
  if (exists) return null;
  const id = `ce_${createId(12)}`;
  const now = nowIso();
  db.prepare(
    'INSERT INTO canvas_edges (id, project_id, source_id, target_id, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, projectId, sourceId, targetId, label, now, now);
  return mapEdge(
    db.prepare('SELECT * FROM canvas_edges WHERE id = ?').get(id) as unknown as CanvasEdgeRow,
  );
}

export function deleteCanvasEdge(id: ID): void {
  getDb().prepare('DELETE FROM canvas_edges WHERE id = ?').run(id);
}

/** 素材被删除时，级联清理相关连线（SQLite 外键级联已覆盖，此处做双保险） */
export function deleteEdgesOfItem(itemId: ID): void {
  getDb().prepare('DELETE FROM canvas_edges WHERE source_id = ? OR target_id = ?').run(itemId, itemId);
}


/* ------------------------------ 分组 ------------------------------ */

export function listCanvasGroups(projectId: ID): CanvasGroup[] {
  const rows = getDb()
    .prepare('SELECT * FROM canvas_groups WHERE project_id = ? ORDER BY created_at ASC')
    .all(projectId) as unknown as CanvasGroupRow[];
  return rows.map(mapGroup);
}

export interface CreateCanvasGroupInput {
  projectId: ID;
  name?: string;
  color?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export function createCanvasGroup(input: CreateCanvasGroupInput): CanvasGroup {
  const db = getDb();
  const now = nowIso();
  const id = `cg_${createId(12)}`;
  db.prepare(
    `INSERT INTO canvas_groups (id, project_id, name, color, x, y, width, height, z, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.projectId,
    input.name ?? '未命名场景',
    input.color ?? '#f472b6',
    input.x ?? 0,
    input.y ?? 0,
    input.width ?? 640,
    input.height ?? 420,
    -1,
    now,
    now,
  );
  return mapGroup(db.prepare('SELECT * FROM canvas_groups WHERE id = ?').get(id) as unknown as CanvasGroupRow);
}

export function getCanvasGroup(id: ID): CanvasGroup | null {
  const row = getDb().prepare('SELECT * FROM canvas_groups WHERE id = ?').get(id) as
    | CanvasGroupRow
    | undefined;
  return row ? mapGroup(row) : null;
}

export function updateCanvasGroup(
  id: ID,
  patch: Partial<Pick<CanvasGroup, 'name' | 'color' | 'x' | 'y' | 'width' | 'height' | 'z'>>,
): CanvasGroup {
  const fields: Record<string, unknown> = {};
  if (patch.name !== undefined) fields.name = patch.name;
  if (patch.color !== undefined) fields.color = patch.color;
  if (patch.x !== undefined) fields.x = patch.x;
  if (patch.y !== undefined) fields.y = patch.y;
  if (patch.width !== undefined) fields.width = patch.width;
  if (patch.height !== undefined) fields.height = patch.height;
  if (patch.z !== undefined) fields.z = patch.z;
  if (Object.keys(fields).length > 0) {
    const { sql, values } = buildUpdate('canvas_groups', id, fields);
    getDb().prepare(sql).run(...(values as never[]));
  }
  return getCanvasGroup(id) as CanvasGroup;
}

export function deleteCanvasGroup(id: ID): void {
  getDb().prepare('DELETE FROM canvas_groups WHERE id = ?').run(id);
}

/** 把素材加入分组 */
export function addItemToGroup(groupId: ID, itemId: ID): void {
  getDb()
    .prepare('INSERT OR IGNORE INTO canvas_group_items (group_id, item_id) VALUES (?, ?)')
    .run(groupId, itemId);
}

/** 把素材移出分组 */
export function removeItemFromGroup(itemId: ID): void {
  getDb().prepare('DELETE FROM canvas_group_items WHERE item_id = ?').run(itemId);
}

/** 获取分组内的素材 ID */
export function listGroupItemIds(groupId: ID): ID[] {
  const rows = getDb()
    .prepare('SELECT item_id FROM canvas_group_items WHERE group_id = ?')
    .all(groupId) as unknown as Array<{ item_id: string }>;
  return rows.map((row) => row.item_id);
}

/** 获取素材所属分组 ID */
export function getGroupOfItem(itemId: ID): ID | null {
  const row = getDb()
    .prepare('SELECT group_id FROM canvas_group_items WHERE item_id = ?')
    .get(itemId) as { group_id: string } | undefined;
  return row ? row.group_id : null;
}

/** 查询某项目的"素材 → 分组"映射 */
export function mapItemGroups(projectId: ID): Record<string, string> {
  const rows = getDb()
    .prepare(
      `SELECT cgi.item_id AS item_id, cgi.group_id AS group_id
       FROM canvas_group_items cgi
       JOIN canvas_groups cg ON cg.id = cgi.group_id
       WHERE cg.project_id = ?`,
    )
    .all(projectId) as unknown as Array<{ item_id: string; group_id: string }>;
  return Object.fromEntries(rows.map((row) => [row.item_id, row.group_id]));
}
