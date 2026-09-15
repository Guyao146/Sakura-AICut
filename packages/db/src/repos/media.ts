import type { Asset, AssetType, MediaFile, TaskStatus } from '@sakura/core';
import { createId } from '@sakura/core';
import { buildUpdate, getDb, intToBool, nowIso, parseJson, toJson } from '../client';

/**
 * 媒体与资产仓储
 */

/* ------------------------- 媒体 ------------------------- */

interface MediaRow {
  id: string;
  project_id: string;
  kind: string;
  url: string;
  path: string | null;
  mime: string;
  width: number | null;
  height: number | null;
  duration_sec: number | null;
  file_size: number | null;
  prompt: string | null;
  negative_prompt: string | null;
  model: string | null;
  provider_id: string | null;
  job_id: string | null;
  seed: number | null;
  owner_type: string;
  owner_id: string | null;
  is_favorite: number;
  created_at: string;
  updated_at: string;
}

function mapMedia(row: MediaRow): MediaFile {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind as MediaFile['kind'],
    url: row.url,
    path: row.path,
    mime: row.mime,
    width: row.width,
    height: row.height,
    durationSec: row.duration_sec,
    fileSize: row.file_size,
    prompt: row.prompt,
    negativePrompt: row.negative_prompt,
    model: row.model,
    providerId: row.provider_id,
    jobId: row.job_id,
    seed: row.seed,
    ownerType: row.owner_type as MediaFile['ownerType'],
    ownerId: row.owner_id,
    isFavorite: intToBool(row.is_favorite),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateMediaInput {
  projectId: string;
  kind: MediaFile['kind'];
  url: string;
  path?: string | null;
  mime?: string;
  width?: number | null;
  height?: number | null;
  durationSec?: number | null;
  fileSize?: number | null;
  prompt?: string | null;
  negativePrompt?: string | null;
  model?: string | null;
  providerId?: string | null;
  jobId?: string | null;
  seed?: number | null;
  ownerType?: MediaFile['ownerType'];
  ownerId?: string | null;
}

export function createMedia(input: CreateMediaInput): MediaFile {
  const db = getDb();
  const now = nowIso();
  const id = `med_${createId(12)}`;
  db.prepare(
    `INSERT INTO media (id, project_id, kind, url, path, mime, width, height, duration_sec, file_size, prompt,
      negative_prompt, model, provider_id, job_id, seed, owner_type, owner_id, is_favorite, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(
    id,
    input.projectId,
    input.kind,
    input.url,
    input.path ?? null,
    input.mime ?? 'application/octet-stream',
    input.width ?? null,
    input.height ?? null,
    input.durationSec ?? null,
    input.fileSize ?? null,
    input.prompt ?? null,
    input.negativePrompt ?? null,
    input.model ?? null,
    input.providerId ?? null,
    input.jobId ?? null,
    input.seed ?? null,
    input.ownerType ?? 'upload',
    input.ownerId ?? null,
    now,
    now,
  );
  return getMedia(id) as MediaFile;
}

export function getMedia(id: string): MediaFile | null {
  const row = getDb().prepare('SELECT * FROM media WHERE id = ?').get(id) as unknown as MediaRow | undefined;
  return row ? mapMedia(row) : null;
}

export function listMedia(
  projectId: string,
  filter: { ownerType?: MediaFile['ownerType']; ownerId?: string; kind?: MediaFile['kind']; ids?: string[] } = {},
): MediaFile[] {
  const clauses = ['project_id = ?'];
  const params: unknown[] = [projectId];
  if (filter.ownerType) {
    clauses.push('owner_type = ?');
    params.push(filter.ownerType);
  }
  if (filter.ownerId) {
    clauses.push('owner_id = ?');
    params.push(filter.ownerId);
  }
  if (filter.kind) {
    clauses.push('kind = ?');
    params.push(filter.kind);
  }
  if (filter.ids && filter.ids.length > 0) {
    clauses.push(`id IN (${filter.ids.map(() => '?').join(',')})`);
    params.push(...filter.ids);
  }
  const rows = getDb()
    .prepare(`SELECT * FROM media WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC`)
    .all(...(params as never[])) as unknown as MediaRow[];
  return rows.map(mapMedia);
}

export function updateMedia(id: string, patch: Partial<Pick<MediaFile, 'isFavorite' | 'ownerType' | 'ownerId'>>): void {
  const { sql, values } = buildUpdate('media', id, {
    ...(patch.isFavorite !== undefined ? { is_favorite: patch.isFavorite ? 1 : 0 } : {}),
    ...(patch.ownerType ? { owner_type: patch.ownerType } : {}),
    ...(patch.ownerId !== undefined ? { owner_id: patch.ownerId } : {}),
  });
  getDb().prepare(sql).run(...(values as never[]));
}

export function deleteMedia(id: string): void {
  getDb().prepare('DELETE FROM media WHERE id = ?').run(id);
}

/* ------------------------- 资产 ------------------------- */

interface AssetRow {
  id: string;
  project_id: string;
  type: string;
  name: string;
  ref_id: string | null;
  description: string;
  prompt: string;
  negative_prompt: string | null;
  tags_json: string;
  media_ids_json: string;
  status: string;
  error: string | null;
  seed: number | null;
  variants: number;
  locked: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function mapAsset(row: AssetRow): Asset {
  return {
    id: row.id,
    projectId: row.project_id,
    type: row.type as AssetType,
    name: row.name,
    refId: row.ref_id,
    description: row.description,
    prompt: row.prompt,
    negativePrompt: row.negative_prompt,
    tags: parseJson<string[]>(row.tags_json, []),
    mediaIds: parseJson<string[]>(row.media_ids_json, []),
    status: row.status as TaskStatus,
    error: row.error,
    seed: row.seed,
    variants: row.variants,
    locked: intToBool(row.locked),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listAssets(projectId: string): Asset[] {
  const rows = getDb()
    .prepare('SELECT * FROM assets WHERE project_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(projectId) as unknown as AssetRow[];
  return rows.map(mapAsset);
}

export function getAsset(id: string): Asset | null {
  const row = getDb().prepare('SELECT * FROM assets WHERE id = ?').get(id) as unknown as AssetRow | undefined;
  return row ? mapAsset(row) : null;
}

export interface AssetUpsertInput {
  id?: string;
  type: AssetType;
  name: string;
  refId?: string | null;
  description?: string;
  prompt?: string;
  negativePrompt?: string | null;
  tags?: string[];
  mediaIds?: string[];
  variants?: number;
  seed?: number | null;
  locked?: boolean;
  status?: TaskStatus;
}

export function createAsset(projectId: string, input: AssetUpsertInput): Asset {
  const db = getDb();
  const now = nowIso();
  const id = input.id ?? `ast_${createId(12)}`;
  const orderRow = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM assets WHERE project_id = ?')
    .get(projectId) as unknown as { next: number };
  db.prepare(
    `INSERT INTO assets (id, project_id, type, name, ref_id, description, prompt, negative_prompt, tags_json,
      media_ids_json, status, seed, variants, locked, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    projectId,
    input.type,
    input.name,
    input.refId ?? null,
    input.description ?? '',
    input.prompt ?? '',
    input.negativePrompt ?? null,
    toJson(input.tags ?? []),
    toJson(input.mediaIds ?? []),
    input.status ?? 'pending',
    input.seed ?? null,
    input.variants ?? 1,
    input.locked ? 1 : 0,
    orderRow?.next ?? 0,
    now,
    now,
  );
  return getAsset(id) as Asset;
}

export function updateAsset(
  id: string,
  patch: Partial<{
    name: string;
    description: string;
    prompt: string;
    negativePrompt: string | null;
    tags: string[];
    mediaIds: string[];
    status: TaskStatus;
    error: string | null;
    seed: number | null;
    variants: number;
    locked: boolean;
    refId: string | null;
  }>,
): Asset {
  const fields: Record<string, unknown> = {};
  if (patch.name !== undefined) fields.name = patch.name;
  if (patch.description !== undefined) fields.description = patch.description;
  if (patch.prompt !== undefined) fields.prompt = patch.prompt;
  if (patch.negativePrompt !== undefined) fields.negative_prompt = patch.negativePrompt;
  if (patch.tags !== undefined) fields.tags_json = toJson(patch.tags);
  if (patch.mediaIds !== undefined) fields.media_ids_json = toJson(patch.mediaIds);
  if (patch.status !== undefined) fields.status = patch.status;
  if (patch.error !== undefined) fields.error = patch.error;
  if (patch.seed !== undefined) fields.seed = patch.seed;
  if (patch.variants !== undefined) fields.variants = patch.variants;
  if (patch.locked !== undefined) fields.locked = patch.locked ? 1 : 0;
  if (patch.refId !== undefined) fields.ref_id = patch.refId;

  if (Object.keys(fields).length > 0) {
    const { sql, values } = buildUpdate('assets', id, fields);
    getDb().prepare(sql).run(...(values as never[]));
  }
  return getAsset(id) as Asset;
}

export function appendAssetMedia(id: string, mediaId: string): Asset {
  const asset = getAsset(id);
  if (!asset) throw new Error(`资产不存在：${id}`);
  const mediaIds = asset.mediaIds.includes(mediaId) ? asset.mediaIds : [...asset.mediaIds, mediaId];
  return updateAsset(id, { mediaIds, status: 'succeeded', error: null });
}

export function deleteAsset(id: string): void {
  getDb().prepare('DELETE FROM assets WHERE id = ?').run(id);
}

/** 用一批资产整体替换（asset.plan 用）；保留已出图的同名资产 */
export function replaceAssets(
  projectId: string,
  inputs: AssetUpsertInput[],
  options: { keepGenerated?: boolean } = {},
): Asset[] {
  const db = getDb();
  const existing = listAssets(projectId);
  const keep = new Map<string, Asset>();
  if (options.keepGenerated !== false) {
    for (const asset of existing) {
      if (asset.mediaIds.length > 0 || asset.locked) keep.set(`${asset.type}:${asset.name}`, asset);
    }
  }

  db.prepare('DELETE FROM assets WHERE project_id = ?').run(projectId);
  inputs.forEach((input) => {
    const previous = keep.get(`${input.type}:${input.name}`);
    createAsset(projectId, {
      ...input,
      ...(previous ? { mediaIds: previous.mediaIds, status: previous.status } : {}),
    });
  });
  return listAssets(projectId);
}

