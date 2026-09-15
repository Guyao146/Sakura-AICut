import type { ID, ISODateTime, TaskStatus, Timestamps } from './common';

/**
 * 第三步：资产（人物 / 场景 / 道具 / 风格参考）
 */

export type AssetType = 'character' | 'location' | 'prop' | 'style' | 'audio' | 'other';

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  character: '人物',
  location: '场景',
  prop: '物品',
  style: '风格参考',
  audio: '音频',
  other: '其他',
};

/** 资产图类型：三视图 / 表情 / 多角度 / 关键帧 */
export type AssetViewKind = 'three-view' | 'expression' | 'multi-angle' | 'keyframe' | 'reference';

export const ASSET_VIEW_LABELS: Record<AssetViewKind, string> = {
  'three-view': '角色三视图',
  expression: '表情集',
  'multi-angle': '多角度',
  keyframe: '关键帧',
  reference: '参考图',
};

/** 统一媒体记录：一张生成图 / 一段生成视频 / 一段音频 */
export interface MediaFile extends Timestamps {
  id: ID;
  projectId: ID;
  kind: 'image' | 'video' | 'audio';
  /** 可访问 URL（本地为 /api/files/xxx） */
  url: string;
  /** 本地磁盘相对路径 */
  path?: string | null;
  mime: string;
  width?: number | null;
  height?: number | null;
  durationSec?: number | null;
  fileSize?: number | null;
  /** 生成元数据 */
  prompt?: string | null;
  negativePrompt?: string | null;
  model?: string | null;
  providerId?: ID | null;
  jobId?: ID | null;
  seed?: number | null;
  /** 归属：资产 / 镜头 / 时间线 */
  ownerType: 'asset' | 'shot' | 'project' | 'timeline' | 'upload';
  ownerId?: ID | null;
  isFavorite?: boolean;
}

export interface Asset extends Timestamps {
  id: ID;
  projectId: ID;
  type: AssetType;
  name: string;
  /** 关联的剧本人/场景/道具 ID */
  refId?: ID | null;
  description: string;
  prompt: string;
  negativePrompt?: string | null;
  tags: string[];
  /** 已生成的资产图（有序，第一个为封面） */
  mediaIds: ID[];
  /** 生成状态 */
  status: TaskStatus;
  /** 失败原因 */
  error?: string | null;
  seed?: number | null;
  variants: number;
  /** 用户锁定：Agent 不会再自动覆盖 */
  locked?: boolean;
}

export interface AssetWithMedia extends Asset {
  media: MediaFile[];
}
