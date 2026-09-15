import type { AspectRatio, ID, ISODateTime, Language, Timestamps } from './common';

/**
 * 第一步：项目设定
 */

/** 题材类型 */
export const GENRES = [
  '都市逆袭',
  '古装权谋',
  '玄幻仙侠',
  '悬疑推理',
  '科幻未来',
  '甜宠言情',
  '喜剧搞笑',
  '末日废土',
  '校园青春',
  '职场商战',
  '民国传奇',
  '军事战争',
  '奇幻冒险',
  '家庭伦理',
] as const;
export type Genre = (typeof GENRES)[number];

/** 视觉风格 */
export const VISUAL_STYLES = [
  '写实电影感',
  '日系赛璐璐动漫',
  '国风工笔',
  '3D 皮克斯质感',
  '国潮水墨',
  '赛博朋克霓虹',
  '美漫硬朗线条',
  '复古胶片 35mm',
  '唯美韩剧柔光',
  '黑白纪实',
] as const;
export type VisualStyle = (typeof VISUAL_STYLES)[number];

export interface ProjectBrief {
  /** 项目名称 */
  name: string;
  /** 一句话故事（logline） */
  logline: string;
  /** 题材类型（可多选） */
  genres: string[];
  /** 视觉风格 */
  style: string;
  /** 画幅 */
  aspectRatio: AspectRatio;
  /** 目标总时长（秒） */
  targetDurationSec: number;
  /** 台词语言 */
  language: Language;
  /** 集数（短剧常见 1 / 10 / 30 集） */
  episodeCount: number;
  /** 目标平台/受众，用于 Agent 决策口吻 */
  audience?: string;
  /** 全局负向提示词 */
  negativePrompt?: string;
  /** 全局随机种子，保证风格一致性 */
  seed?: number;
  /** 补充说明（交给 Agent 的自由文本要求） */
  notes?: string;
}

export const DEFAULT_BRIEF: ProjectBrief = {
  name: '未命名项目',
  logline: '',
  genres: ['都市逆袭'],
  style: '写实电影感',
  aspectRatio: '9:16',
  targetDurationSec: 90,
  language: 'zh-CN',
  episodeCount: 1,
  audience: '',
  negativePrompt: 'lowres, blurry, watermark, text, extra fingers, deformed hands',
  seed: undefined,
  notes: '',
};

/** 五步流程阶段 */
export type PipelineStage = 'brief' | 'script' | 'assets' | 'shots' | 'edit' | 'done';

export const PIPELINE_STAGES: PipelineStage[] = ['brief', 'script', 'assets', 'shots', 'edit', 'done'];

export type ProjectStatus = 'draft' | 'in_progress' | 'rendering' | 'completed' | 'archived';

export interface Project extends Timestamps {
  id: ID;
  brief: ProjectBrief;
  stage: PipelineStage;
  status: ProjectStatus;
  /** 封面（首帧或指定媒体 ID） */
  coverMediaId?: ID | null;
  /** 最近一次渲染输出 */
  lastExportUrl?: string | null;
  lastOpenedAt?: ISODateTime | null;
}

/** 生成项目时的入参 */
export type CreateProjectInput = Partial<Omit<ProjectBrief, 'name'>> & { name: string };
