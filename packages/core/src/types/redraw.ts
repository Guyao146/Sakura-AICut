import type { ID, ISODateTime, TaskStatus, Timestamps } from './common';

/**
 * RHSTORY 式视频重绘（原片一换角色 / 画风 / 画幅的视频转视频）
 *
 * 用户上传一段原片，指定「换成什么角色 / 什么画风 / 什么画幅」，
 * 系统抽出关键帧、逐帧理解构图与运镜，再按新设定重绘并重新生成动态片段。
 */

/** 重绘的维度 */
export type RedrawDimension = 'character' | 'style' | 'aspect' | 'scene';

export const REDRAW_DIMENSION_LABELS: Record<RedrawDimension, string> = {
  character: '换角色',
  style: '换画风',
  aspect: '换画幅',
  scene: '换场景',
};

/** 单个关键帧的分析与重绘结果 */
export interface RedrawKeyframe {
  /** 在原片中的时间点（秒） */
  timeSec: number;
  /** 抽出的原帧图片媒体 ID */
  sourceMediaId: ID;
  /** 原帧的可访问 URL（登记帧时临时携带，落盘后可省） */
  url?: string;
  /** 视觉模型对原帧的理解（构图 / 景别 / 人物动作 / 光影） */
  analysis?: string;
  /** 重绘后新帧图片媒体 ID */
  targetMediaId?: ID | null;
}

export interface VideoRedraw extends Timestamps {
  id: ID;
  projectId: ID;
  /** 原片媒体 ID */
  sourceMediaId: ID;
  /** 重绘后成片媒体 ID */
  outputMediaId?: ID | null;
  /** 目标角色描述（换角色） */
  characterPrompt?: string | null;
  /** 目标画风（换画风），例如「吉卜力水彩 / 赛博朋克霓虹 / 写实电影」 */
  stylePrompt?: string | null;
  /** 目标画幅 */
  aspectRatio?: string | null;
  /** 场景替换描述 */
  scenePrompt?: string | null;
  /** 额外要求 */
  extraPrompt?: string | null;
  /** 每段时长（秒） */
  segmentDurationSec: number;
  /** 关键帧（含分析结果与重绘结果） */
  keyframes: RedrawKeyframe[];
  status: TaskStatus;
  error?: string | null;
  /** 关联任务 */
  jobId?: ID | null;
}

export const REDRAW_STYLE_PRESETS: Array<{ key: string; label: string; prompt: string }> = [
  {
    key: 'ghibli',
    label: '吉卜力水彩',
    prompt:
      'Studio Ghibli inspired hand-painted watercolor style, soft cel shading, warm pastoral light, lush detailed background, gentle anime aesthetics',
  },
  {
    key: 'cyberpunk',
    label: '赛博朋克霓虹',
    prompt:
      'Cyberpunk neon-noir style, rain-soaked streets glowing with magenta and cyan holograms, high contrast cinematic lighting, blade-runner atmosphere',
  },
  {
    key: 'cinematic',
    label: '写实电影',
    prompt:
      'Photorealistic cinematic film still, anamorphic lens flare, shallow depth of field, teal-and-orange color grading, 35mm grain texture',
  },
  {
    key: 'ink',
    label: '水墨国风',
    prompt:
      'Traditional Chinese ink-wash painting style, xuan paper texture, expressive brush strokes, minimalist composition with negative space, muted monochrome accents',
  },
  {
    key: 'claymation',
    label: '黏土定格',
    prompt:
      'Claymation stop-motion style, tactile polymer clay textures, soft studio lighting, handcrafted miniature diorama aesthetics',
  },
  {
    key: 'comic',
    label: '美漫插画风',
    prompt:
      'American superhero comic book illustration, bold ink outlines, halftone dot shading, dynamic exaggerated perspective, vibrant saturated colors',
  },
];

export const REDRAW_CHARACTER_PRESETS: Array<{ key: string; label: string; prompt: string }> = [
  {
    key: 'anime-girl',
    label: '二次元少女',
    prompt: 'a young anime heroine with expressive eyes, flowing pastel hair, detailed school uniform',
  },
  {
    key: 'warrior',
    label: '古风侠客',
    prompt: 'a Chinese wuxia swordsman in flowing robes, hair tied with a jade crown, dignified posture',
  },
  {
    key: 'astronaut',
    label: '宇航员',
    prompt: 'an astronaut in a sleek white spacesuit with reflective gold visor',
  },
  {
    key: 'detective',
    label: '复古侦探',
    prompt: 'a 1940s private detective in a trench coat and fedora, moody film-noir atmosphere',
  },
];
