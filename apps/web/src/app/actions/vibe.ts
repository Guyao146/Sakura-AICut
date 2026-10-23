'use server';

import type { Project, Job, VibeProject } from '@sakura/core';
import { cookies } from 'next/headers';
import { createVibeAndEnqueue, enqueueVibeJob, saveVibeDraft, saveVibeDubbing } from '@sakura/pipeline';
import { previewVibeVoice, vibeVoiceOptions } from '@sakura/pipeline';
import { redactUrl } from '@sakura/core/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';
import { revalidatePath } from 'next/cache';
import type { ActionResult } from './project';

async function managed<T>(work: () => T | Promise<T>): Promise<ActionResult<T>> {
  try {
    if (!verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value)) throw new Error('未登录或会话已过期');
    return { ok: true, data: await work() };
  } catch (error) {
    return { ok: false, error: redactUrl(error instanceof Error ? error.message : String(error)) };
  }
}

export async function createVibeProjectAction(input: {
  name: string; topic: string; aspectRatio?: Project['brief']['aspectRatio']; style?: string; targetDurationSec?: number;
}): Promise<ActionResult<{ id: string; job: Job }>> {
  return managed(() => {
    const result = createVibeAndEnqueue(input);
    revalidatePath('/');
    return result;
  });
}

export async function startVibeScriptAction(projectId: string, input: {
  topic: string; instructions?: string; autoRender?: boolean; autoCode?: boolean;
}): Promise<ActionResult<{ job: Job }>> {
  return managed(() => {
    const job = enqueueVibeJob(projectId, 'vibe.generate', input);
    revalidatePath(`/studio/${projectId}`);
    return { job };
  });
}

export async function startVibeCodeAction(projectId: string, instructions?: string): Promise<ActionResult<{ job: Job }>> {
  return managed(() => {
    const job = enqueueVibeJob(projectId, 'vibe.code', { instructions });
    revalidatePath(`/studio/${projectId}`);
    return { job };
  });
}

export async function startVibeRenderAction(projectId: string, confirmedRevision: number): Promise<ActionResult<{ job: Job }>> {
  return managed(() => {
    const job = enqueueVibeJob(projectId, 'vibe.render', { confirmedRevision });
    revalidatePath(`/studio/${projectId}`);
    return { job };
  });
}

export async function saveVibeScriptAction(projectId: string, script: unknown, revision: number): Promise<ActionResult<VibeProject>> {
  return managed(() => {
    const result = saveVibeDraft(projectId, 'script', script, revision);
    revalidatePath(`/studio/${projectId}`);
    return result;
  });
}

export async function saveVibeCodeAction(projectId: string, code: string, revision: number): Promise<ActionResult<VibeProject>> {
  return managed(() => {
    const result = saveVibeDraft(projectId, 'code', code, revision);
    revalidatePath(`/studio/${projectId}`);
    return result;
  });
}

export async function saveVibeDubbingAction(projectId: string, value: unknown, revision: number): Promise<ActionResult<VibeProject>> {
  return managed(() => {
    const result = saveVibeDubbing(projectId, value, revision);
    revalidatePath(`/studio/${projectId}`);
    return result;
  });
}

export async function loadVibeVoicesAction(projectId: string) {
  return managed(() => vibeVoiceOptions(projectId));
}

export async function previewVibeVoiceAction(projectId: string, value: unknown, text: string) {
  return managed(() => previewVibeVoice(projectId, value, text));
}
