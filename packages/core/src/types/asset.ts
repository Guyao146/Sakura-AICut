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
  /** 归属：资产 / 镜头 / 时间线 / 画布素材 */
  ownerType: 'asset' | 'shot' | 'project' | 'timeline' | 'upload' | 'canvas';
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

/** 画布连线（表达素材间的叙事顺序 / 引用关系） */
export interface CanvasEdge extends Timestamps {
  id: ID;
  projectId: ID;
  sourceId: ID;
  targetId: ID;
  /** 连线标签，例如"切换到""回忆" */
  label?: string;
}

/** 画布分组（场景卡片：把一组素材/镜头打包） */
export interface CanvasGroup extends Timestamps {
  id: ID;
  projectId: ID;
  name: string;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 分组层级默认 -1，垫在素材下方 */
  z: number;
}

/** 画布模板：预设的分镜布局 */
export interface CanvasTemplate {
  id: string;
  name: string;
  description: string;
  /** 模板预设的节点布局（坐标为相对画布原点） */
  nodes: Array<{
    kind: CanvasItemKind;
    text: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
  }>;
  /** 模板内连线（按 nodes 数组下标） */
  edges?: Array<[number, number]>;
}

/** 三幕式经典结构 */
export const CANVAS_TEMPLATE_THREE_ACT: CanvasTemplate = {
  id: 'three-act',
  name: '三幕式',
  description: '建置 → 冲突 → 解决，经典电影叙事结构',
  nodes: [
    { kind: 'text', text: '第一幕 · 建置', x: 0, y: 0, width: 320, height: 80 },
    { kind: 'text', text: '第二幕 · 冲突', x: 480, y: 0, width: 320, height: 80 },
    { kind: 'text', text: '第三幕 · 解决', x: 960, y: 0, width: 320, height: 80 },
    { kind: 'text', text: '开场画面', x: 0, y: 160, width: 280, height: 60 },
    { kind: 'text', text: '激励事件', x: 480, y: 160, width: 280, height: 60 },
    { kind: 'text', text: '高潮', x: 960, y: 160, width: 280, height: 60 },
    { kind: 'text', text: '人物介绍', x: 0, y: 280, width: 280, height: 60 },
    { kind: 'text', text: '障碍升级', x: 480, y: 280, width: 280, height: 60 },
    { kind: 'text', text: '结局画面', x: 960, y: 280, width: 280, height: 60 },
  ],
  edges: [
    [0, 1],
    [1, 2],
    [3, 4],
    [4, 5],
    [6, 7],
    [7, 8],
  ],
};

/** 起承转合（中式四段结构） */
export const CANVAS_TEMPLATE_QICHENG: CanvasTemplate = {
  id: 'qi-cheng-zhuan-he',
  name: '起承转合',
  description: '起 → 承 → 转 → 合，中式短剧节奏',
  nodes: [
    { kind: 'text', text: '起 · 开场钩子', x: 0, y: 0, width: 300, height: 70 },
    { kind: 'text', text: '承 · 铺垫发展', x: 400, y: 0, width: 300, height: 70 },
    { kind: 'text', text: '转 · 反转冲突', x: 800, y: 0, width: 300, height: 70 },
    { kind: 'text', text: '合 · 收尾点题', x: 1200, y: 0, width: 300, height: 70 },
  ],
  edges: [
    [0, 1],
    [1, 2],
    [2, 3],
  ],
};

/** 竖屏短剧爆款结构（前 3 秒留人） */
export const CANVAS_TEMPLATE_SHORTDRAMA: CanvasTemplate = {
  id: 'short-drama',
  name: '竖屏短剧',
  description: '黄金 3 秒 → 矛盾激化 → 反转 → 钩子结尾',
  nodes: [
    { kind: 'text', text: '黄金 3 秒（强冲突开场）', x: 0, y: 0, width: 360, height: 70 },
    { kind: 'text', text: '身份/误会建立', x: 0, y: 140, width: 360, height: 70 },
    { kind: 'text', text: '打脸准备', x: 0, y: 280, width: 360, height: 70 },
    { kind: 'text', text: '反转 · 真相揭晓', x: 0, y: 420, width: 360, height: 70 },
    { kind: 'text', text: '爽点爆发', x: 0, y: 560, width: 360, height: 70 },
    { kind: 'text', text: '钩子结尾（引导下一集）', x: 0, y: 700, width: 360, height: 70 },
  ],
  edges: [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 5],
  ],
};

export const CANVAS_TEMPLATES: CanvasTemplate[] = [
  CANVAS_TEMPLATE_THREE_ACT,
  CANVAS_TEMPLATE_QICHENG,
  CANVAS_TEMPLATE_SHORTDRAMA,
];

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
