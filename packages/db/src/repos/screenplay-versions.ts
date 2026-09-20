import type { ID, ScreenplayVersion } from '@sakura/core';
import { createId } from '@sakura/core';
import { buildUpdate, getDb, nowIso } from '../client';

/**
 * 剧本版本仓储（⑧剧本助手版本管理）
 */

interface VersionRow {
  id: string;
  project_id: string;
  version: number;
  title: string;
  raw: string;
  data_json: string;
  source: string;
  created_at: string;
  updated_at: string;
}

function mapRow(row: VersionRow): ScreenplayVersion {
  return {
    id: row.id,
    projectId: row.project_id,
    version: row.version,
    title: row.title,
    raw: row.raw,
    dataJson: row.data_json,
    source: row.source as ScreenplayVersion['source'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createScreenplayVersion(input: {
  projectId: ID;
  title: string;
  raw: string;
  dataJson: string;
  source?: ScreenplayVersion['source'];
}): ScreenplayVersion {
  const db = getDb();
  const now = nowIso();
  const max = db
    .prepare('SELECT COALESCE(MAX(version), 0) AS max_version FROM screenplay_versions WHERE project_id = ?')
    .get(input.projectId) as { max_version: number };
  const version = (max.max_version ?? 0) + 1;
  const id = `spv_${createId(12)}`;
  db.prepare(
    `INSERT INTO screenplay_versions (id, project_id, version, title, raw, data_json, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.projectId,
    version,
    input.title,
    input.raw,
    input.dataJson,
    input.source ?? 'manual',
    now,
    now,
  );
  return getScreenplayVersion(id) as ScreenplayVersion;
}

export function getScreenplayVersion(id: ID): ScreenplayVersion | null {
  const row = getDb()
    .prepare('SELECT * FROM screenplay_versions WHERE id = ?')
    .get(id) as VersionRow | undefined;
  return row ? mapRow(row) : null;
}

/** 按版本号倒序返回（最新在前） */
export function listScreenplayVersions(projectId: ID): ScreenplayVersion[] {
  const rows = getDb()
    .prepare('SELECT * FROM screenplay_versions WHERE project_id = ? ORDER BY version DESC')
    .all(projectId) as unknown as VersionRow[];
  return rows.map(mapRow);
}

export function updateScreenplayVersion(
  id: ID,
  patch: Partial<Pick<ScreenplayVersion, 'title' | 'raw' | 'dataJson'>>,
): ScreenplayVersion {
  const fields: Record<string, unknown> = {};
  if (patch.title !== undefined) fields.title = patch.title;
  if (patch.raw !== undefined) fields.raw = patch.raw;
  if (patch.dataJson !== undefined) fields.data_json = patch.dataJson;
  if (Object.keys(fields).length > 0) {
    const { sql, values } = buildUpdate('screenplay_versions', id, fields);
    getDb().prepare(sql).run(...(values as never[]));
  }
  return getScreenplayVersion(id) as ScreenplayVersion;
}

export function deleteScreenplayVersion(id: ID): void {
  getDb().prepare('DELETE FROM screenplay_versions WHERE id = ?').run(id);
}
