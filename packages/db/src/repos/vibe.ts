import type { VibeProject, VibeRenderStatus, VibeScript } from '@sakura/core';
import { createId, vibeDubbingSchema, vibeTopicSchema } from '@sakura/core';
import { getDb, nowIso, parseJson } from '../client';
import { getProject } from './projects';

interface VibeRow {
  id: string; project_id: string; topic: string; revision: number; active_job_id: string | null;
  script_json: string | null; code: string | null; code_updated_at: string | null; dubbing_json: string;
  render_status: string; render_error: string | null; output_media_id: string | null;
  output_url: string | null; rendered_at: string | null; created_at: string; updated_at: string;
}

function mapRow(row: VibeRow): VibeProject {
  return {
    id: row.id, projectId: row.project_id, topic: row.topic,
    revision: row.revision, activeJobId: row.active_job_id,
    dubbing: vibeDubbingSchema.parse(parseJson(row.dubbing_json, {})),
    script: parseJson<VibeScript | null>(row.script_json, null),
    code: row.code, codeUpdatedAt: row.code_updated_at,
    renderStatus: row.render_status as VibeRenderStatus, renderError: row.render_error,
    outputMediaId: row.output_media_id, outputUrl: row.output_url, renderedAt: row.rendered_at,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function getVibeProject(projectId: string): VibeProject | null {
  const row = getDb().prepare('SELECT * FROM vibe_projects WHERE project_id = ?').get(projectId) as unknown as VibeRow | undefined;
  return row ? mapRow(row) : null;
}

export function createVibeProject(projectId: string, topic: string): VibeProject {
  if (getProject(projectId)?.mode !== 'vibe') throw new Error('项目不存在或不是 Vibe 项目');
  const value = vibeTopicSchema.parse(topic);
  if (getVibeProject(projectId)) throw new Error('该项目已存在 Vibe 数据');
  const now = nowIso();
  getDb().prepare(`INSERT INTO vibe_projects (id, project_id, topic, render_status, created_at, updated_at)
    VALUES (?, ?, ?, 'idle', ?, ?)`).run(`vibe_${createId(12)}`, projectId, value, now, now);
  return getVibeProject(projectId)!;
}

export type VibePatch = Partial<Pick<VibeProject,
  'topic' | 'revision' | 'activeJobId' | 'script' | 'code' | 'codeUpdatedAt' | 'renderStatus' |
  'renderError' | 'outputMediaId' | 'outputUrl' | 'renderedAt' | 'dubbing'>>;

/** 单条条件更新，可加入调用方事务；版本与任务所有权不符时拒绝覆盖。 */
export function updateVibeProject(
  projectId: string,
  patch: VibePatch,
  expected: { revision?: number; activeJobId?: string | null } = {},
): VibeProject {
  const columns: string[] = [];
  const values: Array<string | number | null> = [];
  const push = (column: string, value: string | number | null) => { columns.push(`${column} = ?`); values.push(value); };
  if (patch.topic !== undefined) push('topic', vibeTopicSchema.parse(patch.topic));
  if (patch.revision !== undefined) push('revision', patch.revision);
  if (patch.activeJobId !== undefined) push('active_job_id', patch.activeJobId);
  if (patch.script !== undefined) push('script_json', patch.script === null ? null : JSON.stringify(patch.script));
  if (patch.code !== undefined) push('code', patch.code);
  if (patch.dubbing !== undefined) push('dubbing_json', JSON.stringify(vibeDubbingSchema.parse(patch.dubbing)));
  if (patch.codeUpdatedAt !== undefined) push('code_updated_at', patch.codeUpdatedAt);
  if (patch.renderStatus !== undefined) push('render_status', patch.renderStatus);
  if (patch.renderError !== undefined) push('render_error', patch.renderError);
  if (patch.outputMediaId !== undefined) push('output_media_id', patch.outputMediaId);
  if (patch.outputUrl !== undefined) push('output_url', patch.outputUrl);
  if (patch.renderedAt !== undefined) push('rendered_at', patch.renderedAt);
  push('updated_at', nowIso());
  let where = 'project_id = ?';
  values.push(projectId);
  if (expected.revision !== undefined) { where += ' AND revision = ?'; values.push(expected.revision); }
  if (expected.activeJobId !== undefined) { where += ' AND active_job_id IS ?'; values.push(expected.activeJobId); }
  const result = getDb().prepare(`UPDATE vibe_projects SET ${columns.join(', ')} WHERE ${where}`).run(...values);
  if (Number(result.changes) !== 1) throw new Error('Vibe 内容已更新或项目已删除，请刷新后重试');
  return getVibeProject(projectId)!;
}
