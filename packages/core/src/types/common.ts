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

/** 内容分级 / 语言（配音模型常用 20 语言，覆盖一键出海场景） */
export type Language =
  | 'zh-CN'
  | 'en-US'
  | 'ja-JP'
  | 'ko-KR'
  | 'fr-FR'
  | 'de-DE'
  | 'es-ES'
  | 'pt-BR'
  | 'it-IT'
  | 'ru-RU'
  | 'ar-SA'
  | 'hi-IN'
  | 'th-TH'
  | 'vi-VN'
  | 'id-ID'
  | 'ms-MY'
  | 'tr-TR'
  | 'nl-NL'
  | 'pl-PL'
  | 'uk-UA';

export const LANGUAGE_LABELS: Record<Language, string> = {
  'zh-CN': '中文',
  'en-US': 'English',
  'ja-JP': '日本語',
  'ko-KR': '한국어',
  'fr-FR': 'Français',
  'de-DE': 'Deutsch',
  'es-ES': 'Español',
  'pt-BR': 'Português',
  'it-IT': 'Italiano',
  'ru-RU': 'Русский',
  'ar-SA': 'العربية',
  'hi-IN': 'हिन्दी',
  'th-TH': 'ไทย',
  'vi-VN': 'Tiếng Việt',
  'id-ID': 'Bahasa Indonesia',
  'ms-MY': 'Bahasa Melayu',
  'tr-TR': 'Türkçe',
  'nl-NL': 'Nederlands',
  'pl-PL': 'Polski',
  'uk-UA': 'Українська',
};

/** 配音语言选项（下拉用） */
export const LANGUAGE_OPTIONS: Array<{ value: Language; label: string }> = (
  Object.keys(LANGUAGE_LABELS) as Language[]
).map((value) => ({ value, label: LANGUAGE_LABELS[value] }));

/**
 * 爆款复刻（⑩）：上传参考视频 / 链接，AI 解析爆点后产出新剧本
 * 输入侧增强，对齐小云雀「爆款复刻」入口。
 */
export interface ReplicateAnalysis {
  /** 解析出的爆款 DNA：为什么火 */
  hooks: string[];
  /** 文案结构（开头钩子 / 正文 / 结尾） */
  structure: string;
  /** 剧情框架摘要 */
  plot: string;
  /** 配乐与画风判断 */
  styleNotes: string;
  /** 拆解出的可复用分镜建议 */
  shotIdeas: string[];
  /** 据此生成的新剧本大纲 */
  outline: string;
}
