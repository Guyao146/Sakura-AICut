'use server';

import { revalidatePath } from 'next/cache';
import { createPlan, getActivePlan, getPlan, listTurns, updatePlan, updatePlanStep, addTurn } from '@sakura/db';
import { enqueueAgentPlan } from '@/lib/server/jobs';
import type { ActionResult } from './project';

/**
 * 自动规划 Agent 的 Server Actions
 * 规划与执行都交给 worker（agent.run 任务），前端轮询 /api/jobs 获取进度
 */

function toError(error: unknown): ActionResult<never> {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[agent]', message);
  return { ok: false, error: message };
}

function refresh(projectId: string): void {
  revalidatePath(`/studio/${projectId}`);
}

/** 启动一个目标：创建计划并入队执行 */
export async function startAgentPlanAction(
  projectId: string,
  goal: string,
  autoApprove = false,
): Promise<ActionResult<{ planId: string; jobId: string }>> {
  try {
    if (!goal.trim()) throw new Error('请描述你想让 Agent 完成的目标');

    // 已有未完成的计划先暂停，避免多个计划互相干扰
    const active = getActivePlan(projectId);
    if (active) updatePlan(active.id, { status: 'paused' });

    const plan = createPlan({ projectId, goal: goal.trim(), status: 'planning', autoApprove });
    addTurn({ planId: plan.id, projectId, role: 'user', content: goal.trim() });
    const job = enqueueAgentPlan(projectId, plan.id, autoApprove);
    updatePlan(plan.id, { jobId: job.id });
    refresh(projectId);
    return { ok: true, data: { planId: plan.id, jobId: job.id } };
  } catch (error) {
    return toError(error);
  }
}

/** 用户确认后继续执行（对高成本步骤放行） */
export async function approvePlanAction(planId: string): Promise<ActionResult<{ jobId: string }>> {
  try {
    const plan = getPlan(planId);
    if (!plan) throw new Error('计划不存在');

    // 把等待确认的步骤恢复为待执行
    const steps = plan.steps.map((step) =>
      step.status === 'waiting_approval' ? { ...step, status: 'pending' as const, needsApproval: false } : step,
    );
    updatePlan(planId, { steps, status: 'running', error: null });
    addTurn({ planId, projectId: plan.projectId, role: 'user', content: '已确认，继续执行' });

    const job = enqueueAgentPlan(plan.projectId, planId, true);
    updatePlan(planId, { jobId: job.id });
    refresh(plan.projectId);
    return { ok: true, data: { jobId: job.id } };
  } catch (error) {
    return toError(error);
  }
}

/** 回答 Agent 的提问并继续 */
export async function answerPlanAction(planId: string, answer: string): Promise<ActionResult<{ jobId: string }>> {
  try {
    const plan = getPlan(planId);
    if (!plan) throw new Error('计划不存在');
    addTurn({ planId, projectId: plan.projectId, role: 'user', content: answer });

    // 回答后：把提问步骤标记完成，问题清空
    const steps = plan.steps.map((step) =>
      step.tool === 'agent.ask_user' && step.status !== 'succeeded'
        ? { ...step, status: 'succeeded' as const, result: { answer } }
        : step.status === 'waiting_approval'
          ? { ...step, status: 'pending' as const }
          : step,
    );
    updatePlan(planId, { steps, status: 'running', question: null, error: null });

    const job = enqueueAgentPlan(plan.projectId, planId, plan.autoApprove);
    updatePlan(planId, { jobId: job.id });
    refresh(plan.projectId);
    return { ok: true, data: { jobId: job.id } };
  } catch (error) {
    return toError(error);
  }
}

/** 取消计划 */
export async function cancelPlanAction(planId: string): Promise<ActionResult> {
  try {
    const plan = getPlan(planId);
    if (!plan) throw new Error('计划不存在');
    updatePlan(planId, { status: 'canceled' });
    addTurn({ planId, projectId: plan.projectId, role: 'assistant', content: '已取消该计划。' });
    refresh(plan.projectId);
    return { ok: true };
  } catch (error) {
    return toError(error);
  }
}

/** 手动调整某个步骤的顺序/内容后重置为待执行 */
export async function resetPlanStepAction(planId: string, stepIndex: number): Promise<ActionResult> {
  try {
    const plan = getPlan(planId);
    if (!plan) throw new Error('计划不存在');
    updatePlanStep(planId, stepIndex, { status: 'pending', error: null, result: null });
    updatePlan(planId, { status: 'running' });
    const job = enqueueAgentPlan(plan.projectId, planId, plan.autoApprove);
    updatePlan(planId, { jobId: job.id });
    refresh(plan.projectId);
    return { ok: true };
  } catch (error) {
    return toError(error);
  }
}

/** 拉取当前计划与对话轨迹 */
export async function getPlanStateAction(projectId: string) {
  try {
    const plan = getActivePlan(projectId);
    return {
      ok: true as const,
      data: plan ? { plan, turns: listTurns(plan.id, 100) } : { plan: null, turns: [] },
    };
  } catch (error) {
    return toError(error);
  }
}
