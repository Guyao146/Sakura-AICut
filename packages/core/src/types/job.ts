import type { ID, ISODateTime, TaskStatus, Timestamps } from './common';

/**
 * 任务队列与作业模型
 */

export type JobType =
  | 'text.generate'
  | 'image.generate'
  | 'video.generate'
  | 'asset.prepare'
  | 'shot.batchGenerate'
  | 'canvas.generate'
  | 'canvas.audio'
  | 'audio.generate'
  | 'video.redraw'
  | 'timeline.render'
  | 'agent.run'
  | 'provider.probe';

export const JOB_TYPE_LABELS: Record<JobType, string> = {
  'text.generate': '文本生成',
  'image.generate': '图片生成',
  'video.generate': '视频生成',
  'asset.prepare': '资产准备',
  'shot.batchGenerate': '批量分镜生成',
  'canvas.generate': '画布素材生成',
  'canvas.audio': '画布语音合成',
  'audio.generate': '台词配音',
  'video.redraw': '视频重绘',
  'timeline.render': '时间线合成',
  'agent.run': 'Agent 执行',
  'provider.probe': '供应商连通性检测',
};

export interface Job<T = unknown> extends Timestamps {
  id: ID;
  projectId?: ID | null;
  type: JobType;
  status: TaskStatus;
  /** 0-100 */
  progress: number;
  priority: number;
  /** 入参 */
  payload: T;
  /** 结果 */
  result?: Record<string, unknown> | null;
  error?: string | null;
  attempts: number;
  maxAttempts: number;
  /** 供应商异步任务 ID（视频类普遍是异步） */
  remoteTaskId?: string | null;
  /** 定时/重试时间 */
  scheduledAt: ISODateTime;
  startedAt?: ISODateTime | null;
  finishedAt?: ISODateTime | null;
  /** 心跳，用于僵尸任务回收 */
  heartbeatAt?: ISODateTime | null;
  /** 关联的实体（便于前端按实体查任务） */
  targetType?: 'asset' | 'shot' | 'timeline' | 'project' | 'agent' | 'redraw' | null;
  targetId?: ID | null;
  /** 当前阶段描述（例如 "已提交、等待渲染中"） */
  stageLabel?: string | null;
}

export interface JobEvent extends Timestamps {
  id: ID;
  jobId: ID;
  level: 'info' | 'warn' | 'error';
  message: string;
  data?: Record<string, unknown> | null;
}

/** 前端轮询任务列表的响应 */
export interface JobSnapshot {
  job: Job;
  events: JobEvent[];
}
