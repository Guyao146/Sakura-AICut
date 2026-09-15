'use server';

import { revalidatePath } from 'next/cache';
import {
  addChatMessage,
  clearChatMessages,
  createProject,
  deleteProject,
  getProject,
  listChatMessages,
  listProjects,
  updateProject,
  upsertScreenplay,
} from '@sakura/db';
import type { AgentChatMessage, Project, ProjectBrief } from '@sakura/core';
import { assistantChat, generateScreenplay } from '@sakura/pipeline';

/**
 * 项目 / 剧本 / 助手对话 的 Server Actions
 */

export interface ActionResult<T = unknown> {
  ok: boolean;
  error?: string;
  data?: T;
}

function toResult<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

function toError(error: unknown): ActionResult<never> {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[action]', message);
  return { ok: false, error: message };
}

export async function listProjectsAction(): Promise<ActionResult<Project[]>> {
  try {
    return toResult(listProjects());
  } catch (error) {
    return toError(error);
  }
}

/** 第一步：创建项目 */
export async function createProjectAction(input: {
  name: string;
  genres?: string[];
  style?: string;
  aspectRatio?: ProjectBrief['aspectRatio'];
  targetDurationSec?: number;
  logline?: string;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const project = createProject({
      name: input.name,
      genres: input.genres,
      style: input.style,
      aspectRatio: input.aspectRatio,
      targetDurationSec: input.targetDurationSec,
      logline: input.logline,
    });
    revalidatePath('/');
    return toResult({ id: project.id });
  } catch (error) {
    return toError(error);
  }
}

/** 第一步：保存项目设定 */
export async function updateBriefAction(
  projectId: string,
  patch: Partial<ProjectBrief>,
): Promise<ActionResult<Project>> {
  try {
    const project = updateProject(projectId, { brief: patch, ...(patch.name ? { name: patch.name } : {}) });
    revalidatePath(`/studio/${projectId}`);
    return toResult(project);
  } catch (error) {
    return toError(error);
  }
}

export async function setProjectStageAction(
  projectId: string,
  stage: Project['stage'],
): Promise<ActionResult<Project>> {
  try {
    const project = updateProject(projectId, { stage });
    revalidatePath(`/studio/${projectId}`);
    return toResult(project);
  } catch (error) {
    return toError(error);
  }
}

export async function deleteProjectAction(projectId: string): Promise<ActionResult> {
  try {
    deleteProject(projectId);
    revalidatePath('/');
    return { ok: true };
  } catch (error) {
    return toError(error);
  }
}

/** 第二步：手动保存剧本（编辑大纲 / 人物 / 节拍后保存） */
export async function saveScreenplayTextAction(
  projectId: string,
  payload: { title?: string; synopsis?: string; raw?: string },
): Promise<ActionResult> {
  try {
    const current = getProject(projectId);
    if (!current) throw new Error('项目不存在');
    const existing = (await import('@sakura/db')).getScreenplay(projectId);
    if (!existing) return toError('尚未生成剧本，请先使用 AI 生成或手动创建人物与节拍');
    upsertScreenplay(projectId, {
      title: payload.title ?? existing.title,
      logline: existing.logline,
      synopsis: payload.synopsis ?? existing.synopsis,
      characters: existing.characters,
      locations: existing.locations,
      props: existing.props,
      beats: existing.beats,
      raw: payload.raw ?? existing.raw,
      source: 'manual',
    });
    revalidatePath(`/studio/${projectId}`);
    return { ok: true };
  } catch (error) {
    return toError(error);
  }
}

/** 第二步：AI 生成完整剧本结构 */
export async function generateScreenplayAction(
  projectId: string,
  options: { idea?: string; keepExistingCharacters?: boolean; extraInstructions?: string } = {},
): Promise<ActionResult<{ title: string; characters: number; beats: number }>> {
  try {
    const screenplay = await generateScreenplay(projectId, options);
    revalidatePath(`/studio/${projectId}`);
    return toResult({
      title: screenplay.title,
      characters: screenplay.characters.length,
      beats: screenplay.beats.length,
    });
  } catch (error) {
    return toError(error);
  }
}

/** 第二步：与剧本助手对话 */
export async function sendChatAction(
  projectId: string,
  message: string,
  options: { templateId?: string; scope?: AgentChatMessage['scope'] } = {},
): Promise<ActionResult<{ reply: string; history: AgentChatMessage[] }>> {
  try {
    if (!message.trim()) throw new Error('请输入内容');
    const result = await assistantChat(projectId, message, {
      templateId: options.templateId,
      scope: options.scope ?? 'screenplay',
    });
    revalidatePath(`/studio/${projectId}`);
    return toResult({ reply: result.reply, history: result.history });
  } catch (error) {
    return toError(error);
  }
}

export async function listChatAction(
  projectId: string,
  scope: AgentChatMessage['scope'] = 'screenplay',
): Promise<ActionResult<AgentChatMessage[]>> {
  try {
    return toResult(listChatMessages(projectId, scope, 80));
  } catch (error) {
    return toError(error);
  }
}

export async function clearChatAction(
  projectId: string,
  scope: AgentChatMessage['scope'] = 'screenplay',
): Promise<ActionResult> {
  try {
    clearChatMessages(projectId, scope);
    revalidatePath(`/studio/${projectId}`);
    return { ok: true };
  } catch (error) {
    return toError(error);
  }
}

export async function addAssistantNoteAction(projectId: string, content: string): Promise<ActionResult> {
  try {
    addChatMessage({ projectId, scope: 'screenplay', role: 'assistant', content });
    return { ok: true };
  } catch (error) {
    return toError(error);
  }
}
