import { builtinCameraMoves, computeProgress } from '@sakura/core';
import { notFound } from 'next/navigation';
import {
  bootstrap,
  getActivePlan,
  getProjectWithContent,
  listChatMessages,
  listCustomCameraMoves,
  listMedia,
  listPromptTemplates,
  listTurns,
  loadContent,
  touchProject,
  listCanvasItems,
  listCanvasEdges,
  listCanvasGroups,
  mapItemGroups,
} from '@sakura/db';
import { connectedRoutesSummary } from '@/lib/server/ai';
import StudioClient from '@/components/studio/StudioClient';

/**
 * 无限画布工作台（第 1-5 步都在这个页面完成）
 */
export const dynamic = 'force-dynamic';

export default async function StudioPage({ params }: { params: Promise<{ projectId: string }> }) {
  bootstrap();
  const { projectId } = await params;

  let content;
  try {
    content = loadContent(projectId);
  } catch {
    notFound();
  }

  touchProject(projectId);

  const mediaList = listMedia(projectId);
  const media = Object.fromEntries(mediaList.map((item) => [item.id, item]));
  const canvasItems = listCanvasItems(projectId);
  const canvasEdges = listCanvasEdges(projectId);
  const canvasGroups = listCanvasGroups(projectId);
  const itemGroups = mapItemGroups(projectId);
  const chat = listChatMessages(projectId, 'screenplay', 80);
  const promptTemplates = listPromptTemplates();
  const cameraMoves = [...builtinCameraMoves(), ...listCustomCameraMoves(projectId)];
  const snapshot = getProjectWithContent(projectId);
  const progress = computeProgress(snapshot);
  const plan = getActivePlan(projectId);
  const planTurns = plan ? listTurns(plan.id, 100) : [];
  const routes = connectedRoutesSummary();

  return (
    <StudioClient
      data={{
        project: content.project,
        screenplay: content.screenplay,
        assets: content.assets,
        shots: content.shots,
        timeline: content.timeline,
        media,
        canvasItems,
        canvasEdges,
        canvasGroups,
        itemGroups,
        chat: chat.map((item) => ({
          id: item.id,
          role: item.role,
          content: item.content,
          createdAt: item.createdAt,
        })),
        promptTemplates,
        customCameraMoves: cameraMoves,
        progress,
        plan,
        planTurns,
        routes,
      }}
    />
  );
}
