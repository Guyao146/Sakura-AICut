import type { ID, TaskStatus, Timestamps } from './common';

/**
 * 成片 QA：ffprobe 探针 + 视觉模型评审
 *
 * 对标短剧制作流水线里「生成后立即校验」的环节：
 * 视频模型偶发返回损坏 / 黑屏 / 时长异常 / 分辨率错误的片段，
 * 与角色一致性漂移一起构成废片的两大笑点。
 * QA 在片段落库后做一次自动体检，把不可用的片段挡在时间线之外。
 */

export type QaVerdict = 'pass' | 'warn' | 'fail';

/** ffprobe 探针结果（纯文件层面，不调模型） */
export interface QaProbe {
  /** 文件存在且可被 ffmpeg 打开 */
  ok: boolean;
  /** 文件可被 ffmpeg 解码（探针硬故障时为 false，此时直接判负、不再调模型省钱） */
  decodable?: boolean | null;
  durationSec?: number | null;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  codec?: string | null;
  /** 音频轨是否存在（无声模型生成的片段进时间线需要配音覆盖） */
  hasAudio?: boolean | null;
  /** 黑屏 / 纯色画面占比过高（> 阈值秒数） */
  blackScreen?: boolean | null;
  /** 探针失败原因 */
  error?: string | null;
}

/** 视觉模型评审结果（调模型，按帧评分） */
export interface QaReview {
  /** 0-100 可用度评分，>= 60 视为通过 */
  score: number;
  passed: boolean;
  /** 发现的问题（中文，供前端展示与提示词修改参考） */
  issues: string[];
  /** 一句话总结 */
  summary?: string | null;
  /** 评审使用的模型 */
  model?: string | null;
}

export interface QaReport extends Timestamps {
  id: ID;
  projectId: ID;
  /** 被检查的媒体 */
  mediaId: ID;
  /** 关联镜头（媒体归属镜头时填写） */
  shotId?: ID | null;
  status: TaskStatus;
  probe: QaProbe;
  review?: QaReview | null;
  verdict: QaVerdict;
  /** 汇总的问题（探针 + 评审） */
  issues: string[];
  /** 触发来源 */
  source: 'manual' | 'agent' | 'auto';
}

/** 一次项目级 QA 扫描的汇总结果 */
export interface QaSummary {
  total: number;
  passed: number;
  warned: number;
  failed: number;
  skipped: number;
  /** 需要重抽的镜头序号 */
  reshootIndexes: number[];
  reports: QaReport[];
}
