import type { ID, ISODateTime, Timestamps } from './common';

/**
 * 第二步：剧本与分镜骨架
 */

export type CharacterRole = 'protagonist' | 'antagonist' | 'supporting' | 'extra';

export const CHARACTER_ROLE_LABELS: Record<CharacterRole, string> = {
  protagonist: '主角',
  antagonist: '反派',
  supporting: '配角',
  extra: '群演',
};

/** 人物卡：用于驱动人物资产图与镜头一致性 */
export interface Character {
  id: ID;
  name: string;
  aliases: string[];
  role: CharacterRole;
  gender: '男' | '女' | '其他' | '未知';
  age: string;
  /** 外貌：脸型/发型/瞳色/身材等，直接拼进图片提示词 */
  appearance: string;
  /** 服装造型（分场景可覆盖） */
  costume: string;
  personality: string;
  /** 人物小传与动机 */
  background: string;
  /** 音色描述（用于台词 TTS / 配音指路） */
  voiceStyle?: string;
  /** 该人物的图片提示词（可由 appearance 派生） */
  prompt?: string;
  /** 绑定的资产 ID */
  assetId?: ID | null;
}

/** 场景卡 */
export interface SceneLocation {
  id: ID;
  name: string;
  /** 内景 / 外景 */
  interior: boolean;
  timeOfDay: '凌晨' | '清晨' | '白天' | '黄昏' | '夜晚' | '不限';
  atmosphere: string;
  description: string;
  prompt?: string;
  assetId?: ID | null;
}

/** 道具 / 关键物品卡 */
export interface PropItem {
  id: ID;
  name: string;
  category: string;
  description: string;
  /** 剧情作用（为什么重要） */
  importance: string;
  prompt?: string;
  assetId?: ID | null;
}

/** 剧情节拍（一个小段落，通常包含若干镜头） */
export interface StoryBeat {
  id: ID;
  index: number;
  title: string;
  summary: string;
  locationId?: ID | null;
  characterIds: ID[];
  /** 情绪曲线关键词：压抑 / 爆发 / 反转 */
  mood: string;
  /** 预估时长（秒） */
  durationSec: number;
}

export interface Screenplay extends Timestamps {
  id: ID;
  projectId: ID;
  title: string;
  logline: string;
  synopsis: string;
  characters: Character[];
  locations: SceneLocation[];
  props: PropItem[];
  beats: StoryBeat[];
  /** 原始剧本文本（用户手写或助手生成后保留） */
  raw?: string;
  source: 'ai' | 'manual';
}

export interface AgentChatMessage extends Timestamps {
  id: ID;
  projectId: ID;
  /** 会话分组：剧本助手 / 分镜助手 / 通用 Agent */
  scope: 'screenplay' | 'storyboard' | 'general';
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** 引用的提示词模板 */
  templateId?: ID | null;
  tokenUsage?: number | null;
  model?: string | null;
  createdAtAt?: ISODateTime;
}
