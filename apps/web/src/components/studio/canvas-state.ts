import type { Node } from '@xyflow/react';
import type { CanvasItem } from '@sakura/core';

/** 更新节点内容，不覆盖 React Flow 正在维护的位置、缩放和选中状态。 */
export function reconcileCanvasNodes(previous: Node[], incoming: Node[]): Node[] {
  const byId = new Map(previous.map((node) => [node.id, node]));
  return incoming.map((node) => {
    const existing = byId.get(node.id);
    if (!existing) return node;
    return {
      ...existing,
      ...node,
      position: existing.position,
      width: existing.width ?? node.width,
      height: existing.height ?? node.height,
      selected: existing.selected,
      dragging: existing.dragging,
      measured: existing.measured,
      resizing: existing.resizing,
    };
  });
}

/** 只允许有提示词的文字/图片节点生图；选择视频时不会回退到生成全画布。 */
export function canvasGenerationTargets(items: CanvasItem[], selectedIds: string[], busyIds: Set<string>): string[] {
  const selected = new Set(selectedIds);
  return items.filter((item) =>
    (selected.size ? selected.has(item.id) : item.kind === 'text')
    && (item.kind === 'text' || item.kind === 'image') && item.text.trim().length > 0 && !busyIds.has(item.id),
  ).map((item) => item.id);
}

export function clampDockPosition(
  position: { x: number; y: number },
  pane: { width: number; height: number },
  dock: { width: number; height: number },
): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(Number.isFinite(position.x) ? position.x : 0, Math.max(0, pane.width - dock.width))),
    y: Math.max(0, Math.min(Number.isFinite(position.y) ? position.y : 0, Math.max(0, pane.height - dock.height))),
  };
}
