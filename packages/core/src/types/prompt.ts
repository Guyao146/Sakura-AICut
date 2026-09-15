import type { ID, Timestamps } from './common';

/**
 * 提示词库：可复用的提示词模板
 */

export type PromptCategory =
  | 'screenplay' // 剧本 / 大纲 / 人设
  | 'storyboard' // 分镜 / 镜头
  | 'character' // 人物资产
  | 'location' // 场景资产
  | 'prop' // 物品资产
  | 'image' // 图片生成
  | 'video' // 视频生成
  | 'camera' // 运镜
  | 'style' // 风格
  | 'negative' // 负向
  | 'agent' // Agent 规划
  | 'other';

export const PROMPT_CATEGORY_LABELS: Record<PromptCategory, string> = {
  screenplay: '剧本与人设',
  storyboard: '分镜与镜头',
  character: '人物资产',
  location: '场景资产',
  prop: '物品资产',
  image: '图片生成',
  video: '视频生成',
  camera: '运镜',
  style: '风格后缀',
  negative: '负向提示词',
  agent: 'Agent 规划',
  other: '其它',
};

export interface PromptTemplate extends Timestamps {
  id: ID;
  /** builtin 内置（只读，可复制）、custom 用户自建 */
  source: 'builtin' | 'custom';
  category: PromptCategory;
  name: string;
  /** 用途说明 */
  description: string;
  /** 模板正文，支持 {{变量}} 与 {{#if var}}...{{/if}} */
  template: string;
  /** 声明变量（自动从 template 提取，也可补充默认值） */
  variables: Array<{ key: string; label: string; defaultValue?: string; example?: string }>;
  /** 适用能力 */
  capability?: 'text' | 'image' | 'video' | null;
  tags: string[];
  /** 使用次数，用于「常用模板」排序 */
  useCount: number;
  projectId?: ID | null;
}

/** 从模板中提取 {{变量}} 列表 */
export function extractTemplateVariables(template: string): string[] {
  const found = new Set<string>();
  const regex = /\{\{\s*#?if\s+([\w.]+)\s*\}\}|\{\{\s*([\w.]+)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(template)) !== null) {
    const key = match[1] ?? match[2];
    if (key) found.add(key);
  }
  return [...found];
}
