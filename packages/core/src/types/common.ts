/**
 * 通用基础类型
 */

/** 全局唯一 ID（nanoid 风格字符串） */
export type ID = string;

/** ISO-8601 时间字符串 */
export type ISODateTime = string;

export interface Timestamps {
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/** 画幅比例（短剧以 9:16 为主，电影以 16:9 / 21:9 为主） */
export type AspectRatio = '9:16' | '16:9' | '1:1' | '4:3' | '3:4' | '21:9';

export const ASPECT_RATIOS: Record<AspectRatio, { width: number; height: number; label: string }> = {
  '9:16': { width: 1080, height: 1920, label: '竖屏 9:16（短剧）' },
  '16:9': { width: 1920, height: 1080, label: '横屏 16:9（电影）' },
  '1:1': { width: 1024, height: 1024, label: '方形 1:1' },
  '4:3': { width: 1440, height: 1080, label: '4:3' },
  '3:4': { width: 1080, height: 1440, label: '3:4' },
  '21:9': { width: 2560, height: 1080, label: '宽银幕 21:9' },
};

export type MediaKind = 'image' | 'video' | 'audio' | 'text';

export type TaskStatus = 'pending' | 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export const TERMINAL_STATUSES: TaskStatus[] = ['succeeded', 'failed', 'canceled'];

export function isTerminal(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** 内容分级 / 语言 */
export type Language = 'zh-CN' | 'en-US' | 'ja-JP' | 'ko-KR';
