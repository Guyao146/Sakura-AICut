import type { AgentChatMessage, CreateProjectInput, Project, ProjectBrief, Screenplay } from '@sakura/core';
import { DEFAULT_BRIEF, createId } from '@sakura/core';
import { buildUpdate, getDb, nowIso, parseJson, toJson } from '../client';

/**
 * 项目 / 剧本 / 助手对话 仓储
 */

interface ProjectRow {
  id: string;
  name: string;
  brief_json: string;
  stage: string;
  status: string;
  cover_media_id: string | null;
  last_export_url: string | null;
  last_opened_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapProject(row: ProjectRow): Project {
  const brief = parseJson<ProjectBrief>(row.brief_json, DEFAULT_BRIEF);
  return {
    id: row.id,
    brief: { ...DEFAULT_BRIEF, ...brief, name: row.name },
    stage: row.stage as Project['stage'],
    status: row.status as Project['status'],
    coverMediaId: row.cover_media_id,
    lastExportUrl: row.last_export_url,
    lastOpenedAt: row.last_opened_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listProjects(): Project[] {
  const rows = getDb()
    .prepare('SELECT * FROM projects ORDER BY updated_at DESC')
    .all() as unknown as ProjectRow[];
  return rows.map(mapProject);
}

export function getProject(id: string): Project | null {
  const row = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as unknown as ProjectRow | undefined;
  return row ? mapProject(row) : null;
}

export function createProject(input: CreateProjectInput): Project {
  const now = nowIso();
  const id = `prj_${createId(12)}`;
  const brief: ProjectBrief = { ...DEFAULT_BRIEF, ...input, name: input.name || DEFAULT_BRIEF.name };
  getDb()
    .prepare(
      `INSERT INTO projects (id, name, brief_json, stage, status, created_at, updated_at)
       VALUES (?, ?, ?, 'brief', 'draft', ?, ?)`,
    )
    .run(id, brief.name, toJson(brief), now, now);
  return getProject(id) as Project;
}

export function updateProject(id: string, patch: { name?: string; brief?: Partial<ProjectBrief>; status?: Project['status']; stage?: Project['stage']; coverMediaId?: string | null }): Project {
  const current = getProject(id);
  if (!current) throw new Error(`项目不存在：${id}`);

  const nextBrief: ProjectBrief = { ...current.brief, ...(patch.brief ?? {}) };
  const name = patch.name ?? nextBrief.name;
  nextBrief.name = name;

  const { sql, values } = buildUpdate('projects', id, {
    name,
    brief_json: toJson(nextBrief),
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.stage ? { stage: patch.stage } : {}),
    ...(patch.coverMediaId !== undefined ? { cover_media_id: patch.coverMediaId } : {}),
  });
  getDb().prepare(sql).run(...(values as never[]));
  return getProject(id) as Project;
}

export function touchProject(id: string): void {
  getDb().prepare('UPDATE projects SET last_opened_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), id);
}

export function deleteProject(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM media WHERE project_id = ?').run(id);
  db.prepare('DELETE FROM assets WHERE project_id = ?').run(id);
  db.prepare('DELETE FROM shots WHERE project_id = ?').run(id);
  db.prepare('DELETE FROM screenplays WHERE project_id = ?').run(id);
  db.prepare('DELETE FROM timelines WHERE project_id = ?').run(id);
  db.prepare('DELETE FROM chat_messages WHERE project_id = ?').run(id);
  db.prepare('DELETE FROM agent_plans WHERE project_id = ?').run(id);
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
}

/* ------------------------- 剧本 ------------------------- */

interface ScreenplayRow {
  id: string;
  project_id: string;
  title: string;
  raw: string | null;
  source: string;
  data_json: string;
  created_at: string;
  updated_at: string;
}

function mapScreenplay(row: ScreenplayRow): Screenplay {
  const data = parseJson<Partial<Screenplay>>(row.data_json, {});
  return {
    id: row.id,
    projectId: row.project_id,
    title: data.title ?? row.title ?? '未命名剧本',
    logline: data.logline ?? '',
    synopsis: data.synopsis ?? '',
    characters: data.characters ?? [],
    locations: data.locations ?? [],
    props: data.props ?? [],
    beats: data.beats ?? [],
    raw: row.raw ?? data.raw ?? '',
    source: (row.source as Screenplay['source']) ?? 'ai',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getScreenplay(projectId: string): Screenplay | null {
  const row = getDb().prepare('SELECT * FROM screenplays WHERE project_id = ?').get(projectId) as unknown as
    | ScreenplayRow
    | undefined;
  return row ? mapScreenplay(row) : null;
}

export function upsertScreenplay(
  projectId: string,
  content: Omit<Screenplay, 'id' | 'projectId' | 'createdAt' | 'updatedAt'> & { id?: string },
): Screenplay {
  const db = getDb();
  const now = nowIso();
  const existing = getScreenplay(projectId);
  const id = existing?.id ?? content.id ?? `scr_${createId(12)}`;
  const payload = {
    title: content.title,
    logline: content.logline,
    synopsis: content.synopsis,
    characters: content.characters,
    locations: content.locations,
    props: content.props,
    beats: content.beats,
  };

  if (existing) {
    db.prepare(
      `UPDATE screenplays SET title = ?, raw = ?, source = ?, data_json = ?, updated_at = ? WHERE project_id = ?`,
    ).run(content.title, content.raw ?? '', content.source, toJson(payload), now, projectId);
  } else {
    db.prepare(
      `INSERT INTO screenplays (id, project_id, title, raw, source, data_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, projectId, content.title, content.raw ?? '', content.source, toJson(payload), now, now);
  }
  return getScreenplay(projectId) as Screenplay;
}

/* ------------------------- 助手对话 ------------------------- */

interface ChatRow {
  id: string;
  project_id: string;
  scope: string;
  role: string;
  content: string;
  template_id: string | null;
  token_usage: number | null;
  model: string | null;
  created_at: string;
  updated_at: string;
}

function mapChat(row: ChatRow): AgentChatMessage {
  return {
    id: row.id,
    projectId: row.project_id,
    scope: row.scope as AgentChatMessage['scope'],
    role: row.role as AgentChatMessage['role'],
    content: row.content,
    templateId: row.template_id,
    tokenUsage: row.token_usage,
    model: row.model,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listChatMessages(projectId: string, scope: AgentChatMessage['scope'], limit = 100): AgentChatMessage[] {
  const rows = getDb()
    .prepare('SELECT * FROM chat_messages WHERE project_id = ? AND scope = ? ORDER BY created_at ASC LIMIT ?')
    .all(projectId, scope, limit) as unknown as ChatRow[];
  return rows.map(mapChat);
}

export function addChatMessage(input: {
  projectId: string;
  scope: AgentChatMessage['scope'];
  role: AgentChatMessage['role'];
  content: string;
  templateId?: string | null;
  tokenUsage?: number | null;
  model?: string | null;
}): AgentChatMessage {
  const db = getDb();
  const now = nowIso();
  const id = `msg_${createId(12)}`;
  db.prepare(
    `INSERT INTO chat_messages (id, project_id, scope, role, content, template_id, token_usage, model, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.projectId,
    input.scope,
    input.role,
    input.content,
    input.templateId ?? null,
    input.tokenUsage ?? null,
    input.model ?? null,
    now,
    now,
  );
  return {
    id,
    projectId: input.projectId,
    scope: input.scope,
    role: input.role,
    content: input.content,
    templateId: input.templateId ?? null,
    tokenUsage: input.tokenUsage ?? null,
    model: input.model ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

export function clearChatMessages(projectId: string, scope?: AgentChatMessage['scope']): void {
  if (scope) {
    getDb().prepare('DELETE FROM chat_messages WHERE project_id = ? AND scope = ?').run(projectId, scope);
  } else {
    getDb().prepare('DELETE FROM chat_messages WHERE project_id = ?').run(projectId);
  }
}

