'use server';

import { revalidatePath } from 'next/cache';
import {
  bringCanvasItemToFront,
  createCanvasItem,
  deleteCanvasItem,
  getCanvasItem,
  listCanvasItems,
  updateCanvasItem,
  clearCanvas,
  type CreateCanvasItemInput,
} from '@sakura/db';
import type { CanvasItem } from '@sakura/core';
import type { ActionResult } from './project';

/**
 * 无限画布素材相关 Server Actions
 */

function toError(error: unknown): ActionResult<never> {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[action]', message);
  return { ok: false, error: message };
}

function refresh(projectId: string): void {
  revalidatePath(`/studio/${projectId}`);
}

export async function listCanvasItemsAction(projectId: string): Promise<ActionResult<CanvasItem[]>> {
  try {
    const items = listCanvasItems(projectId);
    return { ok: true, data: items };
  } catch (error) {
    return toError(error);
  }
}

export async function createCanvasItemAction(
  projectId: string,
  input: Omit<CreateCanvasItemInput, 'projectId'>,
): Promise<ActionResult<CanvasItem>> {
  try {
    const item = createCanvasItem({ ...input, projectId });
    refresh(projectId);
    return { ok: true, data: item };
  } catch (error) {
    return toError(error);
  }
}

export async function updateCanvasItemAction(
  itemId: string,
  patch: Partial<Pick<CanvasItem, 'text' | 'x' | 'y' | 'width' | 'height' | 'z' | 'rotation'>>,
): Promise<ActionResult<CanvasItem>> {
  try {
    const item = getCanvasItem(itemId);
    if (!item) throw new Error('画布素材不存在');
    const updated = updateCanvasItem(itemId, patch);
    refresh(item.projectId);
    return { ok: true, data: updated };
  } catch (error) {
    return toError(error);
  }
}

export async function deleteCanvasItemAction(itemId: string): Promise<ActionResult> {
  try {
    const item = getCanvasItem(itemId);
    if (!item) throw new Error('画布素材不存在');
    deleteCanvasItem(itemId);
    refresh(item.projectId);
    return { ok: true };
  } catch (error) {
    return toError(error);
  }
}

export async function bringCanvasItemToFrontAction(itemId: string): Promise<ActionResult<CanvasItem>> {
  try {
    const item = getCanvasItem(itemId);
    if (!item) throw new Error('画布素材不存在');
    const updated = bringCanvasItemToFront(itemId);
    refresh(item.projectId);
    return { ok: true, data: updated };
  } catch (error) {
    return toError(error);
  }
}

export async function clearCanvasAction(projectId: string): Promise<ActionResult> {
  try {
    clearCanvas(projectId);
    refresh(projectId);
    return { ok: true };
  } catch (error) {
    return toError(error);
  }
}
