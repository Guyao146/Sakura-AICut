'use server';

import { revalidatePath } from 'next/cache';
import { createPlan, getPlan, listPlans, listTurns, updatePlan, updatePlanStep, addTurn, cancelAgentPlan } from '@sakura/db';
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
  // 在 Next 请求上下文之外（例如单元测试直接调用 action）revalidatePath 会抛错，
  // 此时跳过即可：调用方仍会拿到 action 的返回值。
  try {
    revalidatePath(`/studio/${projectId}`);
  } catch {
    /* 非请求上下文下没有可刷新的缓存 */
  }
}

/** 启动一个目标：创建计划并入队执行 */
export async function startAgentPlanAction(
  projectId: string,
  goal: string,
  autoApprove = false,
): Promise<ActionResult<{ planId: string; jobId: string }>> {
  try {
    if (!goal.trim()) throw new Error('请描述你想让 Agent 完成的目标');

    // 已有未完成的计划先取消，避免多个计划互相干扰（旧实现只是「暂停」，
    // 既没有恢复入口，其进行中的步骤也会永远卡在「执行中」）
    const active = listPlans(projectId, 1)[0];
    if (active && active.status !== 'completed' && active.status !== 'failed' && active.status !== 'canceled') {
      cancelAgentPlan(active.id);
      addTurn({ planId: active.id, projectId, role: 'assistant', content: '已被新目标取代，后续执行已取消。' });
    }

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
    if (plan.status !== 'waiting_approval' || plan.question) throw new Error('计划当前不在等待执行确认');

    // 把等待确认的步骤恢复为待执行
    const steps = plan.steps.map((step) =>
      step.status === 'waiting_approval' ? { ...step, status: 'pending' as const, needsApproval: false } : step,
    );
    updatePlan(planId, { steps, status: 'running', error: null });
    addTurn({ planId, projectId: plan.projectId, role: 'user', content: '已确认，继续执行' });

    const job = enqueueAgentPlan(plan.projectId, planId, plan.autoApprove);
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
    if (plan.status !== 'waiting_approval' || !plan.question) throw new Error('计划当前不在等待回答');
    if (!answer.trim()) throw new Error('请先填写回答');
    addTurn({ planId, projectId: plan.projectId, role: 'user', content: answer.trim() });

    // 回答后：把「正在等待回答」的提问步骤标记完成，问题清空。
    // 只处理当前等待中的那一步，不能把之后还没执行的 ask_user 也提前置为已完成。
    const steps = plan.steps.map((step) =>
      step.tool === 'agent.ask_user' && step.status === 'waiting_approval'
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
    cancelAgentPlan(planId);
    if (plan.status !== 'completed' && plan.status !== 'failed' && plan.status !== 'canceled') {
      addTurn({ planId, projectId: plan.projectId, role: 'assistant', content: '已取消后续执行。已发出的模型请求可能仍会完成并计费。' });
    }
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
    if (plan.status === 'canceled') throw new Error('计划已取消，请重新发起目标');
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
    const plan = listPlans(projectId, 1)[0] ?? null;
    return {
      ok: true as const,
      data: plan ? { plan, turns: listTurns(plan.id, 100) } : { plan: null, turns: [] },
    };
  } catch (error) {
    return toError(error);
  }
}
