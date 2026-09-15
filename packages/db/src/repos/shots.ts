import type { CameraMoveTemplate, Shot, TaskStatus, Timeline, TimelineClip, Track } from '@sakura/core';
import { createId } from '@sakura/core';
import { buildUpdate, getDb, nowIso, parseJson, toJson } from '../client';

/**
 * 镜头 / 时间线 / 自定义运镜 仓储
 */

interface ShotRow {
  id: string;
  project_id: string;
  idx: number;
  beat_id: string | null;
  episode: number;
  description: string;
  dialogue: string | null;
  narration: string | null;
  duration_sec: number;
  shot_size: string;
  camera_template_id: string | null;
  camera_prompt: string | null;
  character_ids_json: string;
  prop_ids_json: string;
  location_id: string | null;
  prompt: string;
  negative_prompt: string | null;
  first_frame_media_id: string | null;
  last_frame_media_id: string | null;
  clip_media_ids_json: string;
  selected_media_id: string | null;
  status: string;
  error: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function mapShot(row: ShotRow): Shot {
  return {
    id: row.id,
    projectId: row.project_id,
    index: row.idx,
    beatId: row.beat_id,
    episode: row.episode,
    description: row.description,
    dialogue: row.dialogue,
    narration: row.narration,
    durationSec: row.duration_sec,
    shotSize: row.shot_size as Shot['shotSize'],
    cameraTemplateId: row.camera_template_id,
    cameraPrompt: row.camera_prompt,
    characterIds: parseJson<string[]>(row.character_ids_json, []),
    propIds: parseJson<string[]>(row.prop_ids_json, []),
    locationId: row.location_id,
    prompt: row.prompt,
    negativePrompt: row.negative_prompt,
    firstFrameMediaId: row.first_frame_media_id,
    lastFrameMediaId: row.last_frame_media_id,
    clipMediaIds: parseJson<string[]>(row.clip_media_ids_json, []),
    selectedMediaId: row.selected_media_id,
    status: row.status as TaskStatus,
    error: row.error,
    order: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listShots(projectId: string): Shot[] {
  const rows = getDb()
    .prepare('SELECT * FROM shots WHERE project_id = ? ORDER BY sort_order ASC, idx ASC')
    .all(projectId) as unknown as ShotRow[];
  return rows.map(mapShot);
}

export function getShot(id: string): Shot | null {
  const row = getDb().prepare('SELECT * FROM shots WHERE id = ?').get(id) as unknown as ShotRow | undefined;
  return row ? mapShot(row) : null;
}

export type ShotInput = Omit<Shot, 'id' | 'projectId' | 'createdAt' | 'updatedAt' | 'order'> & {
  id?: string;
  order?: number;
};

export function createShot(projectId: string, input: ShotInput): Shot {
  const db = getDb();
  const now = nowIso();
  const id = input.id ?? `sht_${createId(12)}`;
  const orderRow = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM shots WHERE project_id = ?')
    .get(projectId) as unknown as { next: number };
  db.prepare(
    `INSERT INTO shots (id, project_id, idx, beat_id, episode, description, dialogue, narration, duration_sec, shot_size,
      camera_template_id, camera_prompt, character_ids_json, prop_ids_json, location_id, prompt, negative_prompt,
      first_frame_media_id, last_frame_media_id, clip_media_ids_json, selected_media_id, status, error, sort_order,
      created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    projectId,
    input.index,
    input.beatId ?? null,
    input.episode ?? 1,
    input.description ?? '',
    input.dialogue ?? null,
    input.narration ?? null,
    input.durationSec ?? 5,
    input.shotSize ?? '中景',
    input.cameraTemplateId ?? null,
    input.cameraPrompt ?? null,
    toJson(input.characterIds ?? []),
    toJson(input.propIds ?? []),
    input.locationId ?? null,
    input.prompt ?? '',
    input.negativePrompt ?? null,
    input.firstFrameMediaId ?? null,
    input.lastFrameMediaId ?? null,
    toJson(input.clipMediaIds ?? []),
    input.selectedMediaId ?? null,
    input.status ?? 'pending',
    input.error ?? null,
    input.order ?? orderRow?.next ?? 0,
    now,
    now,
  );
  return getShot(id) as Shot;
}

export function updateShot(
  id: string,
  patch: Partial<{
    index: number;
    beatId: string | null;
    episode: number;
    description: string;
    dialogue: string | null;
    narration: string | null;
    durationSec: number;
    shotSize: Shot['shotSize'];
    cameraTemplateId: string | null;
    cameraPrompt: string | null;
    characterIds: string[];
    propIds: string[];
    locationId: string | null;
    prompt: string;
    negativePrompt: string | null;
    firstFrameMediaId: string | null;
    lastFrameMediaId: string | null;
    clipMediaIds: string[];
    selectedMediaId: string | null;
    status: TaskStatus;
    error: string | null;
    order: number;
  }>,
): Shot {
  const columnMap: Record<string, string> = {
    index: 'idx',
    beatId: 'beat_id',
    episode: 'episode',
    description: 'description',
    dialogue: 'dialogue',
    narration: 'narration',
    durationSec: 'duration_sec',
    shotSize: 'shot_size',
    cameraTemplateId: 'camera_template_id',
    cameraPrompt: 'camera_prompt',
    characterIds: 'character_ids_json',
    propIds: 'prop_ids_json',
    locationId: 'location_id',
    prompt: 'prompt',
    negativePrompt: 'negative_prompt',
    firstFrameMediaId: 'first_frame_media_id',
    lastFrameMediaId: 'last_frame_media_id',
    clipMediaIds: 'clip_media_ids_json',
    selectedMediaId: 'selected_media_id',
    status: 'status',
    error: 'error',
    order: 'sort_order',
  };
  const jsonFields = new Set(['characterIds', 'propIds', 'clipMediaIds']);
  const fields: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(columnMap)) {
    const value = (patch as Record<string, unknown>)[key];
    if (value === undefined) continue;
    fields[column] = jsonFields.has(key) ? toJson(value) : (value as never);
  }
  if (Object.keys(fields).length > 0) {
    const { sql, values } = buildUpdate('shots', id, fields);
    getDb().prepare(sql).run(...(values as never[]));
  }
  return getShot(id) as Shot;
}

export function deleteShot(id: string): void {
  getDb().prepare('DELETE FROM shots WHERE id = ?').run(id);
}

/** 整体替换镜头列表（shot.plan 用） */
export function replaceShots(projectId: string, inputs: ShotInput[]): Shot[] {
  getDb().prepare('DELETE FROM shots WHERE project_id = ?').run(projectId);
  inputs.forEach((input, index) => createShot(projectId, { ...input, index: index + 1, order: index }));
  return listShots(projectId);
}

/** 追加镜头（保留已有镜头，序号顺延） */
export function appendShots(projectId: string, inputs: ShotInput[]): Shot[] {
  const existing = listShots(projectId);
  const startIndex = existing.reduce((max, shot) => Math.max(max, shot.index), 0);
  inputs.forEach((input, offset) =>
    createShot(projectId, { ...input, index: startIndex + offset + 1, order: existing.length + offset }),
  );
  return listShots(projectId);
}

/* ------------------------- 时间线 ------------------------- */

interface TimelineRow {
  id: string;
  project_id: string;
  version: number;
  fps: number;
  width: number;
  height: number;
  tracks_json: string;
  duration_sec: number;
  render_status: string | null;
  render_progress: number;
  render_output_url: string | null;
  render_job_id: string | null;
  rendered_at: string | null;
  export_preset_json: string | null;
  created_at: string;
  updated_at: string;
}

function mapTimeline(row: TimelineRow): Timeline {
  return {
    id: row.id,
    projectId: row.project_id,
    version: row.version,
    fps: row.fps,
    width: row.width,
    height: row.height,
    tracks: parseJson<Track[]>(row.tracks_json, []),
    durationSec: row.duration_sec,
    renderStatus: (row.render_status as TaskStatus | null) ?? undefined,
    renderProgress: row.render_progress,
    renderOutputUrl: row.render_output_url,
    renderJobId: row.render_job_id,
    renderedAt: row.rendered_at,
    exportPreset: parseJson<Timeline['exportPreset']>(row.export_preset_json, undefined),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function computeTimelineDuration(tracks: Track[]): number {
  let max = 0;
  for (const track of tracks) {
    for (const clip of track.clips) {
      max = Math.max(max, clip.start + clip.duration);
    }
  }
  return Number(max.toFixed(3));
}

export function getTimeline(projectId: string): Timeline | null {
  const row = getDb().prepare('SELECT * FROM timelines WHERE project_id = ?').get(projectId) as unknown as
    | TimelineRow
    | undefined;
  return row ? mapTimeline(row) : null;
}

/** 创建或更新时间线（不传 tracks 时保留原内容） */
export function saveTimeline(
  projectId: string,
  patch: {
    tracks?: Track[];
    fps?: number;
    width?: number;
    height?: number;
    exportPreset?: Timeline['exportPreset'];
    bumpVersion?: boolean;
  },
): Timeline {
  const db = getDb();
  const now = nowIso();
  const existing = getTimeline(projectId);
  const tracks = patch.tracks ?? existing?.tracks ?? [];
  const duration = computeTimelineDuration(tracks);

  if (!existing) {
    const id = `tml_${createId(12)}`;
    db.prepare(
      `INSERT INTO timelines (id, project_id, version, fps, width, height, tracks_json, duration_sec, render_progress,
        export_preset_json, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    ).run(
      id,
      projectId,
      patch.fps ?? 30,
      patch.width ?? 1080,
      patch.height ?? 1920,
      toJson(tracks),
      duration,
      toJson(patch.exportPreset ?? null),
      now,
      now,
    );
  } else {
    db.prepare(
      `UPDATE timelines SET tracks_json = ?, duration_sec = ?, fps = ?, width = ?, height = ?,
        export_preset_json = ?, version = version + ?, updated_at = ? WHERE project_id = ?`,
    ).run(
      toJson(tracks),
      duration,
      patch.fps ?? existing.fps,
      patch.width ?? existing.width,
      patch.height ?? existing.height,
      toJson(patch.exportPreset ?? existing.exportPreset ?? null),
      patch.bumpVersion === false ? 0 : 1,
      now,
      projectId,
    );
  }
  return getTimeline(projectId) as Timeline;
}

/** 更新渲染状态 */
export function updateTimelineRender(
  projectId: string,
  patch: { status?: TaskStatus; progress?: number; outputUrl?: string | null; jobId?: string | null; renderedAt?: string | null },
): Timeline | null {
  const fields: Record<string, unknown> = {};
  if (patch.status) fields.render_status = patch.status;
  if (patch.progress !== undefined) fields.render_progress = patch.progress;
  if (patch.outputUrl !== undefined) fields.render_output_url = patch.outputUrl;
  if (patch.jobId !== undefined) fields.render_job_id = patch.jobId;
  if (patch.renderedAt !== undefined) fields.rendered_at = patch.renderedAt;
  if (Object.keys(fields).length === 0) return getTimeline(projectId);

  const setClause = Object.keys(fields).map((key) => `${key} = ?`).join(', ');
  getDb()
    .prepare(`UPDATE timelines SET ${setClause}, updated_at = ? WHERE project_id = ?`)
    .run(...([...Object.values(fields), nowIso(), projectId] as never[]));
  return getTimeline(projectId);
}

/* ------------------------- 自定义运镜 ------------------------- */

interface CameraRow {
  id: string;
  project_id: string | null;
  name: string;
  category: string;
  description: string;
  prompt: string;
  usage: string | null;
  frame_mode: string | null;
  params_json: string | null;
  tags_json: string;
  created_at: string;
  updated_at: string;
}

function mapCamera(row: CameraRow): CameraMoveTemplate {
  return {
    id: row.id,
    source: 'custom',
    name: row.name,
    category: row.category as CameraMoveTemplate['category'],
    description: row.description,
    prompt: row.prompt,
    usage: row.usage ?? undefined,
    frameMode: (row.frame_mode as CameraMoveTemplate['frameMode']) ?? undefined,
    params: parseJson<Record<string, unknown> | undefined>(row.params_json, undefined),
    projectId: row.project_id,
    tags: parseJson<string[]>(row.tags_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listCustomCameraMoves(projectId?: string): CameraMoveTemplate[] {
  const db = getDb();
  const rows = (
    projectId
      ? db
          .prepare('SELECT * FROM camera_moves WHERE project_id IS NULL OR project_id = ? ORDER BY created_at DESC')
          .all(projectId)
      : db.prepare('SELECT * FROM camera_moves ORDER BY created_at DESC').all()
  ) as unknown as CameraRow[];
  return rows.map(mapCamera);
}

export function createCustomCameraMove(
  input: Omit<CameraMoveTemplate, 'id' | 'createdAt' | 'updatedAt' | 'source'> & { id?: string },
): CameraMoveTemplate {
  const id = input.id ?? `cam_${createId(12)}`;
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO camera_moves (id, project_id, name, category, description, prompt, usage, frame_mode, params_json,
        tags_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.projectId ?? null,
      input.name,
      input.category,
      input.description,
      input.prompt,
      input.usage ?? null,
      input.frameMode ?? null,
      input.params ? toJson(input.params) : null,
      toJson(input.tags ?? []),
      now,
      now,
    );
  const row = getDb().prepare('SELECT * FROM camera_moves WHERE id = ?').get(id) as unknown as CameraRow;
  return mapCamera(row);
}

export function deleteCustomCameraMove(id: string): void {
  getDb().prepare('DELETE FROM camera_moves WHERE id = ?').run(id);
}

