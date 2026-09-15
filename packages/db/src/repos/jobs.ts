import type { Job, JobEvent, JobType, TaskStatus } from '@sakura/core';
import { createId } from '@sakura/core';
import { getDb, nowIso, parseJson, toJson } from '../client';

/**
 * 任务队列仓储（基于 SQLite 的轻量队列，无需 Redis）
 */

interface JobRow {
  id: string;
  project_id: string | null;
  type: string;
  status: string;
  progress: number;
  priority: number;
  payload_json: string;
  result_json: string | null;
  error: string | null;
  attempts: number;
  max_attempts: number;
  remote_task_id: string | null;
  scheduled_at: string;
  started_at: string | null;
  finished_at: string | null;
  heartbeat_at: string | null;
  target_type: string | null;
  target_id: string | null;
  stage_label: string | null;
  created_at: string;
  updated_at: string;
}

function mapJob(row: JobRow): Job {
  return {
    id: row.id,
    projectId: row.project_id,
    type: row.type as JobType,
    status: row.status as TaskStatus,
    progress: row.progress,
    priority: row.priority,
    payload: parseJson<unknown>(row.payload_json, {}),
    result: parseJson<Record<string, unknown> | null>(row.result_json, null),
    error: row.error,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    remoteTaskId: row.remote_task_id,
    scheduledAt: row.scheduled_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    heartbeatAt: row.heartbeat_at,
    targetType: (row.target_type as Job['targetType']) ?? null,
    targetId: row.target_id,
    stageLabel: row.stage_label,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateJobInput {
  type: JobType;
  projectId?: string | null;
  payload?: unknown;
  priority?: number;
  maxAttempts?: number;
  targetType?: Job['targetType'];
  targetId?: string | null;
  /** 延迟执行（毫秒） */
  delayMs?: number;
  stageLabel?: string;
}

export function createJob(input: CreateJobInput): Job {
  const id = `job_${createId(12)}`;
  const now = nowIso();
  const scheduledAt = new Date(Date.now() + (input.delayMs ?? 0)).toISOString();
  getDb()
    .prepare(
      `INSERT INTO jobs (id, project_id, type, status, progress, priority, payload_json, attempts, max_attempts,
        scheduled_at, target_type, target_id, stage_label, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', 0, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.projectId ?? null,
      input.type,
      input.priority ?? 0,
      toJson(input.payload ?? {}),
      input.maxAttempts ?? 3,
      scheduledAt,
      input.targetType ?? null,
      input.targetId ?? null,
      input.stageLabel ?? null,
      now,
      now,
    );
  return getJob(id) as Job;
}

export function getJob(id: string): Job | null {
  const row = getDb().prepare('SELECT * FROM jobs WHERE id = ?').get(id) as unknown as JobRow | undefined;
  return row ? mapJob(row) : null;
}

export function listJobs(
  filter: { projectId?: string; status?: TaskStatus[]; targetType?: string; targetId?: string; limit?: number } = {},
): Job[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.projectId) {
    clauses.push('project_id = ?');
    params.push(filter.projectId);
  }
  if (filter.status && filter.status.length > 0) {
    clauses.push(`status IN (${filter.status.map(() => '?').join(',')})`);
    params.push(...filter.status);
  }
  if (filter.targetType) {
    clauses.push('target_type = ?');
    params.push(filter.targetType);
  }
  if (filter.targetId) {
    clauses.push('target_id = ?');
    params.push(filter.targetId);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = getDb()
    .prepare(`SELECT * FROM jobs ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...([...params, filter.limit ?? 100] as never[])) as unknown as JobRow[];
  return rows.map(mapJob);
}

export function updateJob(
  id: string,
  patch: Partial<{
    status: TaskStatus;
    progress: number;
    result: Record<string, unknown> | null;
    error: string | null;
    remoteTaskId: string | null;
    stageLabel: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    heartbeatAt: string | null;
    attempts: number;
    scheduledAt: string;
  }>,
): Job | null {
  const fields: Record<string, unknown> = {};
  if (patch.status !== undefined) fields.status = patch.status;
  if (patch.progress !== undefined) fields.progress = Math.max(0, Math.min(100, patch.progress));
  if (patch.result !== undefined) fields.result_json = toJson(patch.result);
  if (patch.error !== undefined) fields.error = patch.error;
  if (patch.remoteTaskId !== undefined) fields.remote_task_id = patch.remoteTaskId;
  if (patch.stageLabel !== undefined) fields.stage_label = patch.stageLabel;
  if (patch.startedAt !== undefined) fields.started_at = patch.startedAt;
  if (patch.finishedAt !== undefined) fields.finished_at = patch.finishedAt;
  if (patch.heartbeatAt !== undefined) fields.heartbeat_at = patch.heartbeatAt;
  if (patch.attempts !== undefined) fields.attempts = patch.attempts;
  if (patch.scheduledAt !== undefined) fields.scheduled_at = patch.scheduledAt;
  if (Object.keys(fields).length === 0) return getJob(id);

  const setClause = Object.keys(fields).map((key) => `${key} = ?`).join(', ');
  getDb()
    .prepare(`UPDATE jobs SET ${setClause}, updated_at = ? WHERE id = ?`)
    .run(...([...Object.values(fields), nowIso(), id] as never[]));
  return getJob(id);
}

/* ------------------------- 事件日志 ------------------------- */

export function addJobEvent(
  jobId: string,
  level: JobEvent['level'],
  message: string,
  data?: Record<string, unknown> | null,
): JobEvent {
  const id = `jev_${createId(12)}`;
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO job_events (id, job_id, level, message, data_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, jobId, level, message, data ? toJson(data) : null, now, now);
  return { id, jobId, level, message, data: data ?? null, createdAt: now, updatedAt: now };
}

export function listJobEvents(jobId: string, limit = 50): JobEvent[] {
  const rows = getDb()
    .prepare('SELECT * FROM job_events WHERE job_id = ? ORDER BY created_at ASC LIMIT ?')
    .all(jobId, limit) as unknown as Array<{
    id: string;
    job_id: string;
    level: string;
    message: string;
    data_json: string | null;
    created_at: string;
    updated_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    jobId: row.job_id,
    level: row.level as JobEvent['level'],
    message: row.message,
    data: parseJson<Record<string, unknown> | null>(row.data_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/* ------------------------- 队列操作 ------------------------- */

/**
 * 领取下一个可执行任务（原子操作，支持多 worker 并发）
 * @param types 允许执行的类型，留空表示全部
 */
export function claimNextJob(types?: JobType[]): Job | null {
  const db = getDb();
  const now = nowIso();
  const clauses = ["status = 'pending'", 'scheduled_at <= ?'];
  const params: unknown[] = [now];
  if (types && types.length > 0) {
    clauses.push(`type IN (${types.map(() => '?').join(',')})`);
    params.push(...types);
  }
  const row = db
    .prepare(
      `SELECT * FROM jobs WHERE ${clauses.join(' AND ')} ORDER BY priority DESC, scheduled_at ASC LIMIT 1`,
    )
    .get(...(params as never[])) as unknown as JobRow | undefined;
  if (!row) return null;

  const updated = db
    .prepare(
      `UPDATE jobs SET status = 'running', started_at = ?, heartbeat_at = ?, attempts = attempts + 1, updated_at = ?
       WHERE id = ? AND status = 'pending'`,
    )
    .run(now, now, now, row.id);

  if ((updated as { changes?: number }).changes === 0) return null; // 被其它 worker 抢走
  return getJob(row.id);
}

/** 心跳：长任务定期调用，避免被判为僵尸 */
export function heartbeatJob(id: string, stageLabel?: string): void {
  const db = getDb();
  if (stageLabel) {
    db.prepare('UPDATE jobs SET heartbeat_at = ?, stage_label = ?, updated_at = ? WHERE id = ?').run(
      nowIso(),
      stageLabel,
      nowIso(),
      id,
    );
  } else {
    db.prepare('UPDATE jobs SET heartbeat_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), id);
  }
}

export function completeJob(id: string, result: Record<string, unknown> = {}): Job | null {
  const now = nowIso();
  getDb()
    .prepare(
      `UPDATE jobs SET status = 'succeeded', progress = 100, result_json = ?, error = NULL, finished_at = ?,
        updated_at = ? WHERE id = ?`,
    )
    .run(toJson(result), now, now, id);
  return getJob(id);
}

/** 失败处理：未达最大重试次数时回到队列，并做退避 */
export function failJob(id: string, error: string, retryDelayMs = 12_000): Job | null {
  const job = getJob(id);
  if (!job) return null;
  const now = nowIso();
  const canRetry = job.attempts < job.maxAttempts;
  if (canRetry) {
    getDb()
      .prepare(
        `UPDATE jobs SET status = 'pending', error = ?, scheduled_at = ?, finished_at = NULL, updated_at = ? WHERE id = ?`,
      )
      .run(error, new Date(Date.now() + retryDelayMs).toISOString(), now, id);
  } else {
    getDb()
      .prepare(`UPDATE jobs SET status = 'failed', error = ?, finished_at = ?, updated_at = ? WHERE id = ?`)
      .run(error, now, now, id);
  }
  return getJob(id);
}

export function cancelJob(id: string): Job | null {
  const now = nowIso();
  getDb()
    .prepare(`UPDATE jobs SET status = 'canceled', finished_at = ?, updated_at = ? WHERE id = ? AND status IN ('pending','running','queued')`)
    .run(now, now, id);
  return getJob(id);
}

/** 回收僵尸任务：运行中但心跳超时 */
export function requeueStalledJobs(stallMs = 10 * 60 * 1000): number {
  const threshold = new Date(Date.now() - stallMs).toISOString();
  const result = getDb()
    .prepare(
      `UPDATE jobs SET status = 'pending', error = '任务执行超时，已自动重新排队', updated_at = ? 
       WHERE status = 'running' AND (heartbeat_at IS NULL OR heartbeat_at < ?)`,
    )
    .run(nowIso(), threshold);
  return Number((result as { changes?: number }).changes ?? 0);
}

export function countActiveJobs(projectId?: string): number {
  const row = (
    projectId
      ? getDb()
          .prepare(
            `SELECT COUNT(*) AS c FROM jobs WHERE project_id = ? AND status IN ('pending','running','queued')`,
          )
          .get(projectId)
      : getDb().prepare(`SELECT COUNT(*) AS c FROM jobs WHERE status IN ('pending','running','queued')`).get()
  ) as unknown as { c: number };
  return row?.c ?? 0;
}