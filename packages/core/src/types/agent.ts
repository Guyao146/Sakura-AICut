import type { ID, ISODateTime, TaskStatus, Timestamps } from './common';

/**
 * 自动规划 Agent
 */

export type AgentStepStatus = TaskStatus | 'waiting_approval' | 'skipped';

/** Agent 可调用的工具名（与 worker 中 tools.ts 的实现一一对应） */
export type AgentToolName =
  | 'project.update_brief'
  | 'screenplay.generate'
  | 'screenplay.update'
  | 'asset.plan'
  | 'asset.generate'
  | 'shot.plan'
  | 'shot.generate'
  | 'agent.ask_user'
  | 'timeline.build'
  | 'timeline.render'
  | 'prompt.lookup'
  | 'finish';

export interface AgentStep {
  id: ID;
  index: number;
  /** 步骤标题，展示用 */
  title: string;
  /** 规划理由 */
  rationale: string;
  tool: AgentToolName;
  args: Record<string, unknown>;
  /** 依赖的步骤 */
  dependsOn: ID[];
  status: AgentStepStatus;
  /** 是否需要用户确认后执行（高风险/高成本动作） */
  needsApproval: boolean;
  /** 预计消耗（例如 12 张图） */
  estimatedCost?: string | null;
  result?: Record<string, unknown> | null;
  error?: string | null;
  startedAt?: ISODateTime | null;
  finishedAt?: ISODateTime | null;
}

export type AgentPlanStatus = 'planning' | 'waiting_approval' | 'running' | 'paused' | 'completed' | 'failed' | 'canceled';

export interface AgentPlan extends Timestamps {
  id: ID;
  projectId: ID;
  /** 用户目标，例如 "帮我把这个故事做成 3 分钟竖屏短剧" */
  goal: string;
  /** Agent 对目标的理解 */
  summary: string;
  /** 追加给用户的澄清问题（ask_user 时填充） */
  question?: string | null;
  steps: AgentStep[];
  status: AgentPlanStatus;
  /** 当前执行到的步骤 index */
  cursor: number;
  /** 自动执行还是每步确认 */
  autoApprove: boolean;
  jobId?: ID | null;
  error?: string | null;
}

export interface AgentChatTurn extends Timestamps {
  id: ID;
  planId: ID;
  projectId: ID;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  toolName?: string | null;
  data?: Record<string, unknown> | null;
}

/** 暴露给前端展示的工具元信息 */
export interface AgentToolMeta {
  name: AgentToolName;
  label: string;
  description: string;
  /** 是否需要人工确认 */
  requiresApproval: boolean;
  /** 入参 schema 描述（JSON Schema 简表，供提示词使用） */
  argsSchema: Record<string, string>;
}

/** 规划器返回的原始 JSON 结构 */
export interface PlanDraft {
  summary: string;
  question?: string;
  steps: Array<{
    title: string;
    rationale: string;
    tool: string;
    args?: Record<string, unknown>;
    needsApproval?: boolean;
    estimatedCost?: string;
  }>;
}
