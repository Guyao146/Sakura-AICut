import type { ID, QaProbe, QaReport, QaReview, QaVerdict, TaskStatus } from '@sakura/core';
import { createId } from '@sakura/core';
import { buildUpdate, getDb, nowIso, parseJson, toJson } from '../client';

/**
 * 成片 QA 报告仓储
 */

interface QaRow {
  id: string;
  project_id: string;
  media_id: string;
  shot_id: string | null;
  status: string;
  probe_json: string;
  review_json: string | null;
  verdict: string;
  issues_json: string;
  source: string;
  created_at: string;
  updated_at: string;
}

function mapRow(row: QaRow): QaReport {
  return {
    id: row.id,
    projectId: row.project_id,
    mediaId: row.media_id,
    shotId: row.shot_id,
    status: row.status as TaskStatus,
    probe: parseJson<QaProbe>(row.probe_json, { ok: false }),
    review: parseJson<QaReview | null>(row.review_json, null),
    verdict: (row.verdict as QaVerdict) ?? 'pass',
    issues: parseJson<string[]>(row.issues_json, []),
    source: (row.source as QaReport['source']) ?? 'manual',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateQaReportInput {
  projectId: ID;
  mediaId: ID;
  shotId?: ID | null;
  source?: QaReport['source'];
}

export function createQaReport(input: CreateQaReportInput): QaReport {
  const db = getDb();
  const now = nowIso();
  const id = `qa_${createId(12)}`;
  db.prepare(
    `INSERT INTO qa_reports (id, project_id, media_id, shot_id, status, probe_json, review_json, verdict,
      issues_json, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'running', '{}', NULL, 'pass', '[]', ?, ?, ?)`,
  ).run(id, input.projectId, input.mediaId, input.shotId ?? null, input.source ?? 'manual', now, now);
  return getQaReport(id) as QaReport;
}

export function getQaReport(id: string): QaReport | null {
  const row = getDb().prepare('SELECT * FROM qa_reports WHERE id = ?').get(id) as unknown as QaRow | undefined;
  return row ? mapRow(row) : null;
}

/** 某条媒体最近一次 QA 报告 */
export function getLatestQaReport(mediaId: string): QaReport | null {
  const row = getDb()
    .prepare('SELECT * FROM qa_reports WHERE media_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(mediaId) as unknown as QaRow | undefined;
  return row ? mapRow(row) : null;
}

export function listQaReports(
  filter: { projectId?: string; mediaId?: string; verdict?: QaVerdict[]; limit?: number } = {},
): QaReport[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.projectId) {
    clauses.push('project_id = ?');
    params.push(filter.projectId);
  }
  if (filter.mediaId) {
    clauses.push('media_id = ?');
    params.push(filter.mediaId);
  }
  if (filter.verdict && filter.verdict.length > 0) {
    clauses.push(`verdict IN (${filter.verdict.map(() => '?').join(',')})`);
    params.push(...filter.verdict);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(filter.limit ?? 100, 500));
  const rows = getDb()
    .prepare(`SELECT * FROM qa_reports ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...([...params, limit] as never[])) as unknown as QaRow[];
  return rows.map(mapRow);
}

export function updateQaReport(
  id: string,
  patch: Partial<{
    status: TaskStatus;
    probe: QaProbe;
    review: QaReview | null;
    verdict: QaVerdict;
    issues: string[];
  }>,
): QaReport {
  const fields: Record<string, unknown> = {};
  if (patch.status !== undefined) fields.status = patch.status;
  if (patch.probe !== undefined) fields.probe_json = toJson(patch.probe);
  if (patch.review !== undefined) fields.review_json = patch.review ? toJson(patch.review) : null;
  if (patch.verdict !== undefined) fields.verdict = patch.verdict;
  if (patch.issues !== undefined) fields.issues_json = toJson(patch.issues);
  if (Object.keys(fields).length > 0) {
    const { sql, values } = buildUpdate('qa_reports', id, fields);
    getDb().prepare(sql).run(...(values as never[]));
  }
  return getQaReport(id) as QaReport;
}

export function deleteQaReport(id: string): void {
  getDb().prepare('DELETE FROM qa_reports WHERE id = ?').run(id);
}
