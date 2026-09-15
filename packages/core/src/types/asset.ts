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

/**
 * 无限画布上的素材项（RunningHub / LibTV 式自由画布）
 *
 * 与五步流程无关：这里是素材的二维空间编排。
 * 用户可以把文字、图片、视频、语音任意拖放到画布上，自由缩放与排列。
 */
export type CanvasItemKind = 'text' | 'image' | 'video' | 'audio';

export const CANVAS_ITEM_KIND_LABELS: Record<CanvasItemKind, string> = {
  text: '文字',
  image: '图片',
  video: '视频',
  audio: '语音',
};

export interface CanvasItem extends Timestamps {
  id: ID;
  projectId: ID;
  kind: CanvasItemKind;
  /** 图片 / 视频 / 语音关联的媒体记录（kind=text 时为空） */
  mediaId?: ID | null;
  /** 媒体可访问 URL（冗余存储，避免前端再查 media 表） */
  url?: string | null;
  /** 文字内容或素材标题 */
  text: string;
  /** 画布坐标 */
  x: number;
  y: number;
  /** 宽高（0 表示自适应） */
  width: number;
  height: number;
  /** 层级 */
  z: number;
  /** 旋转角度（度） */
  rotation?: number;
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
