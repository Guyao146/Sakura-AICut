import type { ID, RedrawKeyframe, TaskStatus, VideoRedraw } from '@sakura/core';
import { createId } from '@sakura/core';
import { buildUpdate, getDb, nowIso } from '../client';

/**
 * 视频重绘仓储（重制转绘 / 一键出海）
 */

interface RedrawRow {
  id: string;
  project_id: string;
  source_media_id: string;
  output_media_id: string | null;
  character_prompt: string | null;
  style_prompt: string | null;
  aspect_ratio: string | null;
  scene_prompt: string | null;
  extra_prompt: string | null;
  segment_duration_sec: number;
  keyframes_json: string;
  status: string;
  error: string | null;
  job_id: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(row: RedrawRow): VideoRedraw {
  let keyframes: RedrawKeyframe[] = [];
  try {
    const parsed = JSON.parse(row.keyframes_json || '[]');
    if (Array.isArray(parsed)) keyframes = parsed as RedrawKeyframe[];
  } catch {
    keyframes = [];
  }
  return {
    id: row.id,
    projectId: row.project_id,
    sourceMediaId: row.source_media_id,
    outputMediaId: row.output_media_id,
    characterPrompt: row.character_prompt,
    stylePrompt: row.style_prompt,
    aspectRatio: row.aspect_ratio,
    scenePrompt: row.scene_prompt,
    extraPrompt: row.extra_prompt,
    segmentDurationSec: row.segment_duration_sec,
    keyframes,
    status: row.status as TaskStatus,
    error: row.error,
    jobId: row.job_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateVideoRedrawInput {
  projectId: ID;
  sourceMediaId: ID;
  characterPrompt?: string | null;
  stylePrompt?: string | null;
  aspectRatio?: string | null;
  scenePrompt?: string | null;
  extraPrompt?: string | null;
  segmentDurationSec?: number;
  keyframes?: RedrawKeyframe[];
}

export function createVideoRedraw(input: CreateVideoRedrawInput): VideoRedraw {
  const db = getDb();
  const now = nowIso();
  const id = `vr_${createId(12)}`;
  db.prepare(
    `INSERT INTO video_redraws (id, project_id, source_media_id, output_media_id, character_prompt,
       style_prompt, aspect_ratio, scene_prompt, extra_prompt, segment_duration_sec, keyframes_json,
       status, error, job_id, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?)`,
  ).run(
    id,
    input.projectId,
    input.sourceMediaId,
    input.characterPrompt ?? null,
    input.stylePrompt ?? null,
    input.aspectRatio ?? null,
    input.scenePrompt ?? null,
    input.extraPrompt ?? null,
    input.segmentDurationSec ?? 5,
    JSON.stringify(input.keyframes ?? []),
    now,
    now,
  );
  return getVideoRedraw(id) as VideoRedraw;
}

export function getVideoRedraw(id: ID): VideoRedraw | null {
  const row = getDb().prepare('SELECT * FROM video_redraws WHERE id = ?').get(id) as
    | RedrawRow
    | undefined;
  return row ? mapRow(row) : null;
}

export function listVideoRedraws(projectId: ID): VideoRedraw[] {
  const rows = getDb()
    .prepare('SELECT * FROM video_redraws WHERE project_id = ? ORDER BY created_at DESC')
    .all(projectId) as unknown as RedrawRow[];
  return rows.map(mapRow);
}

export function updateVideoRedraw(
  id: ID,
  patch: Partial<
    Pick<
      VideoRedraw,
      | 'outputMediaId'
      | 'characterPrompt'
      | 'stylePrompt'
      | 'aspectRatio'
      | 'scenePrompt'
      | 'extraPrompt'
      | 'segmentDurationSec'
      | 'keyframes'
      | 'status'
      | 'error'
      | 'jobId'
    >
  >,
): VideoRedraw {
  const fields: Record<string, unknown> = {};
  if (patch.outputMediaId !== undefined) fields.output_media_id = patch.outputMediaId;
  if (patch.characterPrompt !== undefined) fields.character_prompt = patch.characterPrompt;
  if (patch.stylePrompt !== undefined) fields.style_prompt = patch.stylePrompt;
  if (patch.aspectRatio !== undefined) fields.aspect_ratio = patch.aspectRatio;
  if (patch.scenePrompt !== undefined) fields.scene_prompt = patch.scenePrompt;
  if (patch.extraPrompt !== undefined) fields.extra_prompt = patch.extraPrompt;
  if (patch.segmentDurationSec !== undefined)
    fields.segment_duration_sec = patch.segmentDurationSec;
  if (patch.keyframes !== undefined) fields.keyframes_json = JSON.stringify(patch.keyframes);
  if (patch.status !== undefined) fields.status = patch.status;
  if (patch.error !== undefined) fields.error = patch.error;
  if (patch.jobId !== undefined) fields.job_id = patch.jobId;
  if (Object.keys(fields).length > 0) {
    const { sql, values } = buildUpdate('video_redraws', id, fields);
    getDb().prepare(sql).run(...(values as never[]));
  }
  return getVideoRedraw(id) as VideoRedraw;
}

export function deleteVideoRedraw(id: ID): void {
  getDb().prepare('DELETE FROM video_redraws WHERE id = ?').run(id);
}
