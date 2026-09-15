import type {
  AgentChatTurn,
  AgentPlan,
  Asset,
  MediaFile,
  Project,
  PromptTemplate,
  Screenplay,
  Shot,
  Timeline,
  CameraMoveTemplate,
} from '@sakura/core';

/**
 * 工作台共享类型
 */

export interface StudioData {
  project: Project;
  screenplay: Screenplay | null;
  assets: Asset[];
  shots: Shot[];
  timeline: Timeline | null;
  media: Record<string, MediaFile>;
  chat: Array<{ id: string; role: string; content: string; createdAt: string }>;
  promptTemplates: PromptTemplate[];
  customCameraMoves: CameraMoveTemplate[];
  progress: Array<{ stage: string; index: number; title: string; percent: number; done: boolean; stats: string }>;
  plan: AgentPlan | null;
  planTurns: AgentChatTurn[];
  routes: {
    providers: Array<{ id: string; name: string; protocol: string; baseUrl: string; enabled: boolean }>;
    routes: Array<{ capability: string; providerId: string; providerName: string; modelId: string }>;
  };
}
