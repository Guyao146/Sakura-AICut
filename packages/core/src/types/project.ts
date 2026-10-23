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
  /** 外部创作包的溯源快照，不等同于剧本导入或事实核验 */
  provenance?: {
    producer: 'SakuraSeeking'; schemaVersion: '1.0'; createdAt: string; keyword: string;
    generator: 'template' | 'model'; reviewRequired: true;
    source: { id: string; title: string; sourceName: string; platform?: string; sourceUrl?: string; observedAt?: string; kind: 'demo' | 'sourced' };
  };
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
  /** 创作模式：studio 五步流水线 / vibe 主题直出 */
  mode: ProjectMode;
  /** 封面（首帧或指定媒体 ID） */
  coverMediaId?: ID | null;
  /** 最近一次渲染输出 */
  lastExportUrl?: string | null;
  lastOpenedAt?: ISODateTime | null;
}

/**
 * Vibe 模式：主题 → AI 视频脚本 → AI 动画代码 → 浏览器渲染 MP4
 * 与五步流水线（studio 模式）并列的另一种创作模式
 */

/** 项目模式：studio 走五步流水线，vibe 走主题直出 */
export type ProjectMode = 'studio' | 'vibe';

export const PROJECT_MODES: ProjectMode[] = ['studio', 'vibe'];

/** Vibe 模式渲染状态 */
export type VibeRenderStatus = 'idle' | 'queued' | 'rendering' | 'succeeded' | 'failed' | 'canceled';

export const VIBE_RENDER_STATUS_LABELS: Record<VibeRenderStatus, string> = {
  idle: '未渲染',
  queued: '排队中',
  rendering: '渲染中',
  succeeded: '已生成',
  failed: '渲染失败',
  canceled: '已取消',
};

/** AI 生成的视频脚本：一组按时间顺序排列的镜头 */
export interface VibeScriptShot {
  /** 场次 ID */
  id: string;
  /** 场次序号（从 1 开始） */
  index: number;
  /** 时长（秒） */
  durationSec: number;
  /** 画面描述：场景、人物、动作、视觉元素（交给代码生成模型） */
  visualDescription: string;
  /** 旁白 / 字幕文本 */
  narration: string;
  /** 运镜提示（可选） */
  cameraMotion?: string;
  /** 情绪氛围（可选） */
  mood?: string;
}

export interface VibeScript {
  shots: VibeScriptShot[];
}

/** 生成项目时的入参 */
export type CreateProjectInput = Partial<Omit<ProjectBrief, 'name'>> & { name: string; mode?: ProjectMode };

export interface VibeDubbing {
  enabled: boolean;
  voice: string;
  speed: number;
  volume: number;
  pitch: number;
  music?: { mediaId: string; name: string; volume: number; loop: boolean };
}

/** Vibe 项目数据（对应 vibe_projects 表） */
export interface VibeProject extends Timestamps {
  id: ID;
  projectId: ID;
  /** 编辑与任务快照版本，阻止旧任务覆盖新内容 */
  revision: number;
  activeJobId: ID | null;
  /** 最终导出配音设置；由应用合成，不在动画页面执行 */
  dubbing: VibeDubbing;
  /** 创作主题 */
  topic: string;
  /** AI 生成的视频脚本（JSON） */
  script: VibeScript | null;
  /** AI 生成的动画页面代码（完整 HTML） */
  code: string | null;
  /** 代码最近更新时间 */
  codeUpdatedAt: ISODateTime | null;
  /** 渲染状态 */
  renderStatus: VibeRenderStatus;
  /** 渲染错误信息 */
  renderError: string | null;
  /** 渲染产物媒体 ID */
  outputMediaId: ID | null;
  /** 渲染产物访问地址 */
  outputUrl: string | null;
  /** 最近渲染完成时间 */
  renderedAt: ISODateTime | null;
}

/**
 * 渲染帧协议：AI 生成的动画页面必须遵守的约定
 * 渲染器按时间轴逐帧调用 window.__vibeSeek(t) 截屏合成视频，
 * 因此动画必须由 t 驱动（确定性渲染），不能用 setTimeout / requestAnimationFrame 自驱动
 */
export interface VibeFrameProtocol {
  /** 页面暴露的寻帧函数：把动画驱动到第 t 秒 */
  seekFunction: '__vibeSeek';
  /** 页面暴露的元信息对象 */
  meta: '__vibeMeta';
}

export const VIBE_PROTOCOL: VibeFrameProtocol = {
  seekFunction: '__vibeSeek',
  meta: '__vibeMeta',
};

/** 协议元信息：页面须定义 window.__vibeMeta = { durationSec, fps, width, height } */
export interface VibeProtocolMeta {
  /** 总时长（秒） */
  durationSec: number;
  /** 帧率 */
  fps: number;
  width: number;
  height: number;
}
