/**
 * 无限画布布局持久化（localStorage，按项目隔离）
 *
 * 保存三类状态：
 * - positions: 数据节点（项目设定/剧本/资产/镜头/成片）的画布坐标
 * - edges:     用户拖出的连线（表达数据依赖）
 * - notes:     用户添加的便签节点（文本 + 颜色 + 坐标）
 *
 * 数据节点的「存在与否」仍由服务端数据决定，这里只保存用户对布局的编排。
 */

export type NoteColor = 'amber' | 'green' | 'blue' | 'pink';

export interface PersistedNote {
  id: string;
  text: string;
  color: NoteColor;
  x: number;
  y: number;
}

export interface CanvasLayout {
  version: number;
  positions: Record<string, { x: number; y: number }>;
  edges: Array<Record<string, unknown>>;
  notes: PersistedNote[];
}

const VERSION = 1;
const KEY = (projectId: string): string => `sakura:canvas:${projectId}`;

export function loadLayout(projectId: string): CanvasLayout | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CanvasLayout>;
    if (parsed.version !== VERSION || !parsed.positions) return null;
    return {
      version: VERSION,
      positions: parsed.positions,
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
    };
  } catch {
    return null;
  }
}

export function saveLayout(projectId: string, layout: Omit<CanvasLayout, 'version'>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY(projectId), JSON.stringify({ ...layout, version: VERSION }));
  } catch {
    /* 配额或隐私模式：忽略 */
  }
}

export function clearLayout(projectId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(KEY(projectId));
  } catch {
    /* 忽略 */
  }
}

export const NOTE_COLORS: Record<NoteColor, string> = {
  amber: '#f59e0b',
  green: '#34d399',
  blue: '#60a5fa',
  pink: '#f472b6',
};
