import type {
  AgentChatTurn,
  AgentPlan,
  Asset,
  CanvasEdge,
  CanvasGroup,
  CanvasItem,
  MediaFile,
  Project,
  PromptTemplate,
  Screenplay,
  ScreenplayVersion,
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
  /** ⑧ 剧本版本（最新在前） */
  screenplayVersions: ScreenplayVersion[];
  assets: Asset[];
  shots: Shot[];
  timeline: Timeline | null;
  media: Record<string, MediaFile>;
  canvasItems: CanvasItem[];
  canvasEdges: CanvasEdge[];
  canvasGroups: CanvasGroup[];
  /** 素材 → 分组 ID 映射 */
  itemGroups: Record<string, string>;
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

