/**
 * @sakura/core —— 客户端安全入口
 * 只导出纯逻辑（类型、提示词、流程定义、Agent 规划），不含 node:crypto 等 Node 专属依赖。
 * 需要适配器注册表 / 加密 / 任务队列时，请从 '@sakura/core/server' 引入。
 */

// 类型
export * from './types/common';
export * from './types/project';
export * from './types/screenplay';
export * from './types/asset';
export * from './types/shot';
export * from './types/timeline';
export * from './types/provider';
export * from './types/job';
export * from './types/redraw';
export * from './types/agent';
export * from './types/prompt';

// DB 不导出 CreateCanvasItemInput，由 db 仓储包导出

// 工具
export * from './utils/id';
export * from './utils/text';

// 版本号（由 pnpm bump 同步）
export { APP_VERSION } from './version';

// 供应商预设与协议类型（纯数据）
export * from './ai/presets';
export type {
  AdapterContext,
  AudioGenerateRequest,
  AudioGenerateResult,
  AsyncTaskHandle,
  AsyncTaskState,
  BalanceResult,
  ChatMessage,
  GeneratedImage,
  ImageGenerateRequest,
  ImageGenerateResult,
  ProbeResult,
  ProviderAdapter,
  TextGenerateRequest,
  TextGenerateResult,
  VideoGenerateRequest,
  VideoGenerateResult,
} from './ai/types';

// 提示词
export * from './prompt/camera-moves';
export * from './prompt/library';
export * from './prompt/assistant-prompts';
export * from './prompt/templates';
export * from './prompt/build';
export * from './prompt/node-tools';

// 流程
export * from './pipeline/steps';
export * from './pipeline/schema';

// Agent
export * from './agent/tools';
export * from './agent/planner';
