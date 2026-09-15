import type { ID, ISODateTime, TaskStatus, Timestamps } from './common';

/**
 * 第五步：在线剪辑时间线
 */

export type TrackType = 'video' | 'audio' | 'subtitle' | 'overlay';

export type TransitionType = 'none' | 'fade' | 'dissolve' | 'wipe' | 'slide' | 'zoom';

export interface Transition {
  type: TransitionType;
  durationSec: number;
  direction?: 'left' | 'right' | 'up' | 'down';
}

/** 时间线上的一个片段 */
export interface TimelineClip {
  id: ID;
  /** 来源镜头（可空，例如上传的 BGM / 素材） */
  shotId?: ID | null;
  /** 来源媒体 */
  mediaId: ID;
  /** 在轨道上的起始时间（秒） */
  start: number;
  /** 使用时长（秒，已含裁剪与变速后的净值） */
  duration: number;
  /** 源文件裁剪起点（秒） */
  trimIn: number;
  /** 变速倍率 */
  speed: number;
  /** 音量 0-2 */
  volume: number;
  /** 是否静音（视频轨道去原声） */
  muted?: boolean;
  /** 入场转场 */
  transitionIn?: Transition;
  /** 画面变换 */
  transform?: {
    x?: number;
    y?: number;
    scale?: number;
    rotate?: number;
  };
  /** 叠加文字（字幕轨） */
  text?: string | null;
  label?: string;
}

export interface Track {
  id: ID;
  type: TrackType;
  name: string;
  clips: TimelineClip[];
  muted?: boolean;
  locked?: boolean;
  /** 音频轨音量 */
  volume?: number;
}

export interface Timeline extends Timestamps {
  id: ID;
  projectId: ID;
  /** 版本号，每次保存 +1，渲染时记录 */
  version: number;
  fps: number;
  width: number;
  height: number;
  tracks: Track[];
  /** 总时长（秒，由最长轨道推算） */
  durationSec: number;
  /** 最近一次渲染 */
  renderStatus?: TaskStatus;
  renderProgress?: number;
  renderOutputUrl?: string | null;
  renderJobId?: ID | null;
  renderedAt?: ISODateTime | null;
  /** 渲染预设：分辨率/码率/编码 */
  exportPreset?: ExportPreset;
}

export interface ExportPreset {
  width: number;
  height: number;
  fps: number;
  videoBitrate: string;
  audioBitrate: string;
  codec: 'libx264' | 'libx265' | 'h264_nvenc' | 'hevc_nvenc';
  format: 'mp4' | 'mov' | 'webm';
}

export const DEFAULT_EXPORT_PRESETS: Record<string, ExportPreset> = {
  'vertical-1080p': {
    width: 1080,
    height: 1920,
    fps: 30,
    videoBitrate: '8M',
    audioBitrate: '192k',
    codec: 'libx264',
    format: 'mp4',
  },
  'horizontal-1080p': {
    width: 1920,
    height: 1080,
    fps: 30,
    videoBitrate: '12M',
    audioBitrate: '192k',
    codec: 'libx264',
    format: 'mp4',
  },
};
