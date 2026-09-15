import type { AgentChatTurn, AgentPlan, AgentStep } from '@sakura/core';
import { createId } from '@sakura/core';
import { buildUpdate, getDb, intToBool, nowIso, parseJson, toJson } from '../client';

/**
 * Agent 计划与对话仓储
 */

interface PlanRow {
  id: string;
  project_id: string;
  goal: string;
  summary: string;
  question: string | null;
  steps_json: string;
  status: string;
  cursor: number;
  auto_approve: number;
  job_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

function mapPlan(row: PlanRow): AgentPlan {
  return {
    id: row.id,
    projectId: row.project_id,
    goal: row.goal,
    summary: row.summary,
    question: row.question,
    steps: parseJson<AgentStep[]>(row.steps_json, []),
    status: row.status as AgentPlan['status'],
    cursor: row.cursor,
    autoApprove: intToBool(row.auto_approve),
    jobId: row.job_id,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreatePlanInput {
  projectId: string;
  goal: string;
  summary?: string;
  question?: string | null;
  steps?: AgentStep[];
  status?: AgentPlan['status'];
  autoApprove?: boolean;
  id?: string;
}

export function createPlan(input: CreatePlanInput): AgentPlan {
  const id = input.id ?? `plan_${createId(12)}`;
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO agent_plans (id, project_id, goal, summary, question, steps_json, status, cursor, auto_approve,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    )
    .run(
      id,
      input.projectId,
      input.goal,
      input.summary ?? '',
      input.question ?? null,
      toJson(input.steps ?? []),
      input.status ?? 'planning',
      input.autoApprove ? 1 : 0,
      now,
      now,
    );
  return getPlan(id) as AgentPlan;
}

export function getPlan(id: string): AgentPlan | null {
  const row = getDb().prepare('SELECT * FROM agent_plans WHERE id = ?').get(id) as unknown as PlanRow | undefined;
  return row ? mapPlan(row) : null;
}

export function listPlans(projectId: string, limit = 20): AgentPlan[] {
  const rows = getDb()
    .prepare('SELECT * FROM agent_plans WHERE project_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(projectId, limit) as unknown as PlanRow[];
  return rows.map(mapPlan);
}

export function getActivePlan(projectId: string): AgentPlan | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM agent_plans WHERE project_id = ? AND status IN ('planning','waiting_approval','running','paused')
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(projectId) as unknown as PlanRow | undefined;
  return row ? mapPlan(row) : null;
}

export function updatePlan(
  id: string,
  patch: Partial<{
    summary: string;
    question: string | null;
    steps: AgentStep[];
    status: AgentPlan['status'];
    cursor: number;
    autoApprove: boolean;
    jobId: string | null;
    error: string | null;
  }>,
): AgentPlan {
  const fields: Record<string, unknown> = {};
  if (patch.summary !== undefined) fields.summary = patch.summary;
  if (patch.question !== undefined) fields.question = patch.question;
  if (patch.steps !== undefined) fields.steps_json = toJson(patch.steps);
  if (patch.status !== undefined) fields.status = patch.status;
  if (patch.cursor !== undefined) fields.cursor = patch.cursor;
  if (patch.autoApprove !== undefined) fields.auto_approve = patch.autoApprove ? 1 : 0;
  if (patch.jobId !== undefined) fields.job_id = patch.jobId;
  if (patch.error !== undefined) fields.error = patch.error;

  if (Object.keys(fields).length > 0) {
    const { sql, values } = buildUpdate('agent_plans', id, fields);
    getDb().prepare(sql).run(...(values as never[]));
  }
  return getPlan(id) as AgentPlan;
}

/** 更新单个步骤（按 index） */
export function updatePlanStep(planId: string, stepIndex: number, patch: Partial<AgentStep>): AgentPlan {
  const plan = getPlan(planId);
  if (!plan) throw new Error(`Agent 计划不存在：${planId}`);
  const steps = plan.steps.map((step) => (step.index === stepIndex ? { ...step, ...patch } : step));
  return updatePlan(planId, { steps });
}

/** 取下一个待执行步骤 */
export function nextPendingStep(plan: AgentPlan): AgentStep | null {
  return plan.steps.find((step) => step.status === 'pending') ?? null;
}

/* ------------------------- 对话轨迹 ------------------------- */

interface TurnRow {
  id: string;
  plan_id: string;
  project_id: string;
  role: string;
  content: string;
  tool_name: string | null;
  data_json: string | null;
  created_at: string;
  updated_at: string;
}

export function addTurn(input: {
  planId: string;
  projectId: string;
  role: AgentChatTurn['role'];
  content: string;
  toolName?: string | null;
  data?: Record<string, unknown> | null;
}): AgentChatTurn {
  const id = `turn_${createId(12)}`;
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO agent_turns (id, plan_id, project_id, role, content, tool_name, data_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.planId,
      input.projectId,
      input.role,
      input.content,
      input.toolName ?? null,
      input.data ? toJson(input.data) : null,
      now,
      now,
    );
  return {
    id,
    planId: input.planId,
    projectId: input.projectId,
    role: input.role,
    content: input.content,
    toolName: input.toolName ?? null,
    data: input.data ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

export function listTurns(planId: string, limit = 200): AgentChatTurn[] {
  const rows = getDb()
    .prepare('SELECT * FROM agent_turns WHERE plan_id = ? ORDER BY created_at ASC LIMIT ?')
    .all(planId, limit) as unknown as TurnRow[];
  return rows.map((row) => ({
    id: row.id,
    planId: row.plan_id,
    projectId: row.project_id,
    role: row.role as AgentChatTurn['role'],
    content: row.content,
    toolName: row.tool_name,
    data: parseJson<Record<string, unknown> | null>(row.data_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}
