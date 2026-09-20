import type { ID, TaskStatus, Timestamps } from './common';

/**
 * 第四步：分镜与镜头片段
 */

/** 景别 */
export const SHOT_SIZES = [
  '大远景',
  '远景',
  '全景',
  '中景',
  '中近景',
  '近景',
  '特写',
  '大特写',
  '过肩',
  '主观视角',
] as const;
export type ShotSize = (typeof SHOT_SIZES)[number];

/** 运镜模板（内置 + 用户自定义） */
export interface CameraMoveTemplate extends Timestamps {
  id: ID;
  /** 内置模板为 builtin，自定义为 custom */
  source: 'builtin' | 'custom';
  name: string;
  category: '推拉' | '摇移' | '跟随' | '环绕' | '升降' | '特殊' | '固定';
  /** 中文说明 */
  description: string;
  /** 英文提示词（直接拼进视频模型提示词） */
  prompt: string;
  /** 推荐使用场景 */
  usage?: string;
  /** 首尾帧偏好：none / start-end / keyframe */
  frameMode?: 'none' | 'start-end' | 'keyframe';
  /** 常用参数，例如 { strength: 0.8 } */
  params?: Record<string, unknown>;
  projectId?: ID | null;
  tags: string[];
}

/** 镜头 */
export interface Shot extends Timestamps {
  id: ID;
  projectId: ID;
  /** 全局序号（1 起） */
  index: number;
  /** 所属剧情节拍 */
  beatId?: ID | null;
  /** 集数（短剧分集） */
  episode: number;
  /** 画面描述（中文，给人看） */
  description: string;
  /** 台词 */
  dialogue?: string | null;
  /** 旁白 / 音效提示 */
  narration?: string | null;
  /** 时长（秒），视频模型通常 5s / 10s */
  durationSec: number;
  /** 景别 */
  shotSize: ShotSize;
  /** 运镜模板 ID */
  cameraTemplateId?: ID | null;
  /** 自定义运镜文本（覆盖模板） */
  cameraPrompt?: string | null;
  /** 出场人物 */
  characterIds: ID[];
  /** 出场道具 */
  propIds: ID[];
  /** 场景 */
  locationId?: ID | null;
  /** 送给视频模型的完整提示词（正向） */
  prompt: string;
  /** 负向提示词 */
  negativePrompt?: string | null;
  /** 首帧图（由分镜关键帧或人物场景合成） */
  firstFrameMediaId?: ID | null;
  /** 尾帧图（用于首尾帧生视频） */
  lastFrameMediaId?: ID | null;
  /** 生成出的视频片段 */
  clipMediaIds: ID[];
  /** 选中的片段（进入时间线） */
  selectedMediaId?: ID | null;
  /** 台词配音生成的音频（TTS），与视频片段对齐进时间线 */
  dubbingMediaId?: ID | null;
  status: TaskStatus;
  error?: string | null;
  /** 列表排序/画布坐标 */
  order: number;
}

/** 画布上镜头根据 beat 分组的展示 */
export interface ShotGroup {
  beatId: ID;
  title: string;
  shots: Shot[];
}

/**
 * 智能预演（⑦，对齐小云雀智能预演）
 *
 * 为一组镜头统一规划关键分镜图（首帧），再批量生成视频，
 * 保持多镜头间人物动作、运镜关系与空间逻辑一致，大幅降低抽卡率。
 */
export interface ShotPreviewPlan {
  /** 参与预演的镜头 ID（按顺序） */
  shotIds: ID[];
  /** 统一的角色锁定提示词（从剧本人物卡派生，保证一致性） */
  consistencyPrompt: string;
  /** 统一的场景锁定提示词 */
  scenePrompt: string;
  /** 每个镜头的关键帧提示词 */
  framePrompts: Array<{ shotId: ID; prompt: string }>;
}
