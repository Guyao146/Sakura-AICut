'use server';

import { revalidatePath } from 'next/cache';
import type { QaSummary } from '@sakura/core';
import type { ActionResult } from './project';

/**
 * 成片 QA Server Actions
 */

function toError(error: unknown): ActionResult<never> {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[action]', message);
  return { ok: false, error: message };
}

/** 提交一次项目级 QA 检查任务（异步，交给 worker 执行） */
export async function startQaReviewAction(
  projectId: string,
  options: { shotIndexes?: number[]; withVision?: boolean; autoFlag?: boolean; refresh?: boolean } = {},
): Promise<ActionResult<{ jobId: string }>> {
  try {
    const { enqueueQaReview } = await import('@/lib/server/jobs');
    const job = enqueueQaReview(projectId, options);
    revalidatePath(`/studio/${projectId}`);
    return { ok: true, data: { jobId: job.id } };
  } catch (error) {
    return toError(error);
  }
}

/** 读取项目最近一次 QA 汇总（含报告列表，不调模型） */
export async function getProjectQaSummaryAction(projectId: string): Promise<ActionResult<QaSummary>> {
  try {
    const { getProjectQaSummary } = await import('@sakura/pipeline');
    return { ok: true, data: getProjectQaSummary(projectId) };
  } catch (error) {
    return toError(error);
  }
}
