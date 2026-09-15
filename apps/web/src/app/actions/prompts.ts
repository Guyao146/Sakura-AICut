'use server';

import { revalidatePath } from 'next/cache';
import {
  createPromptTemplate,
  deletePromptTemplate,
  getPromptTemplate,
  updatePromptTemplate,
} from '@sakura/db';
import type { PromptCategory, PromptTemplate } from '@sakura/core';
import type { ActionResult } from './project';

/**
 * 提示词库动作
 */

function toError(error: unknown): ActionResult<never> {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[prompts]', message);
  return { ok: false, error: message };
}

function refresh(): void {
  revalidatePath('/settings');
}

export async function savePromptTemplateAction(input: {
  id?: string;
  name: string;
  category: PromptCategory;
  description: string;
  template: string;
  tags?: string[];
  capability?: PromptTemplate['capability'];
}): Promise<ActionResult<{ id: string }>> {
  try {
    if (!input.name.trim()) throw new Error('请填写模板名称');
    if (!input.template.trim()) throw new Error('请填写模板内容');

    if (input.id) {
      const existing = getPromptTemplate(input.id);
      if (!existing) throw new Error('模板不存在');
      updatePromptTemplate(input.id, {
        name: input.name,
        category: input.category,
        description: input.description,
        template: input.template,
        tags: input.tags ?? existing.tags,
        capability: input.capability ?? existing.capability,
      });
      refresh();
      return { ok: true, data: { id: input.id } };
    }

    const created = createPromptTemplate({
      source: 'custom',
      name: input.name,
      category: input.category,
      description: input.description,
      template: input.template,
      tags: input.tags ?? [],
      capability: input.capability ?? null,
      projectId: null,
    });
    refresh();
    return { ok: true, data: { id: created.id } };
  } catch (error) {
    return toError(error);
  }
}

export async function deletePromptTemplateAction(id: string): Promise<ActionResult> {
  try {
    deletePromptTemplate(id);
    refresh();
    return { ok: true };
  } catch (error) {
    return toError(error);
  }
}

/** 把内置模板复制成可编辑的自定义模板 */
export async function duplicatePromptTemplateAction(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    const source = getPromptTemplate(id);
    if (!source) throw new Error('模板不存在');
    const created = createPromptTemplate({
      source: 'custom',
      name: `${source.name}（副本）`,
      category: source.category,
      description: source.description,
      template: source.template,
      tags: source.tags,
      capability: source.capability,
      variables: source.variables,
      projectId: null,
    });
    refresh();
    return { ok: true, data: { id: created.id } };
  } catch (error) {
    return toError(error);
  }
}
