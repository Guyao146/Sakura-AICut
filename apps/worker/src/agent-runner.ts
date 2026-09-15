import type { AgentStep, Shot } from '@sakura/core';
import {
  AGENT_TOOLS,
  buildPlannerMessages,
  draftToSteps,
  extractJson,
  fallbackPlan,
  parsePlanResponse,
  parseWithSchema,
  screenplaySchema,
} from '@sakura/core';
import {
  addTurn,
  getAsset,
  getPlan,
  getProject,
  getScreenplay,
  listAssets,
  listPromptTemplates,
  listShots,
  loadContent,
  updatePlan,
  updatePlanStep,
  updateProject,
  upsertScreenplay,
} from '@sakura/db';
import {
  buildTimelineFromShots,
  checkShotVideo,
  failShotVideo,
  finishShotVideo,
  generateAssetImage,
  generateScreenplay,
  planAssetsFromScreenplay,
  planShotsFromScreenplay,
  renderTimeline,
  runText,
  submitShotVideo,
} from '@sakura/pipeline';
import type { HandlerContext } from './handlers';

/**
 * 自动规划 Agent 的执行器
 * 规划 → 逐步执行（高风险步骤需人工确认）→ 汇报
 */

export interface AgentRunOptions extends HandlerContext {
  autoApprove: boolean;
}

export async function runAgentPlan(planId: string, options: AgentRunOptions): Promise<Record<string, unknown>> {
  const { log, progress, autoApprove } = options;
  let plan = getPlan(planId);
  if (!plan) throw new Error(`Agent 计划不存在：${planId}`);

  // ---------- 1. 没有步骤时先规划 ----------
  if (plan.steps.length === 0) {
    plan = await planOnce(planId, options);
    if (plan.status === 'waiting_approval' || plan.status === 'completed') {
      return { status: plan.status, question: plan.question ?? null };
    }
  }

  // ---------- 2. 逐步执行 ----------
  updatePlan(planId, { status: 'running', error: null });
  const steps = [...plan.steps];

  for (const step of steps) {
    const current = getPlan(planId);
    if (!current) break;
    const target = current.steps.find((item) => item.index === step.index);
    if (!target || target.status === 'succeeded' || target.status === 'skipped') continue;

    // 需要确认的高成本步骤：暂停等待用户确认
    if (target.needsApproval && !autoApprove) {
      updatePlanStep(planId, target.index, { status: 'waiting_approval' });
      updatePlan(planId, { status: 'waiting_approval', cursor: target.index });
      addTurn({
        planId,
        projectId: current.projectId,
        role: 'assistant',
        content: `步骤「${target.title}」需要你确认后执行${target.estimatedCost ? `（预计 ${target.estimatedCost}）` : ''}。`,
        toolName: target.tool,
      });
      log(`等待用户确认：${target.title}`);
      return { status: 'waiting_approval', step: target.title };
    }

    updatePlanStep(planId, target.index, { status: 'running', startedAt: new Date().toISOString() });
    progress(Math.round((target.index / Math.max(1, current.steps.length)) * 100), target.title);
    log(`执行步骤 ${target.index + 1}/${current.steps.length}：${target.title}（${target.tool}）`);
    addTurn({
      planId,
      projectId: current.projectId,
      role: 'tool',
      content: `开始执行：${target.title}`,
      toolName: target.tool,
      data: target.args,
    });

    try {
      const result = await executeAgentTool(current.projectId, target, options);
      if (target.tool === 'agent.ask_user') {
        updatePlanStep(planId, target.index, { status: 'waiting_approval', result });
        updatePlan(planId, {
          status: 'waiting_approval',
          question: String((result as { question?: string }).question ?? ''),
          cursor: target.index,
        });
        return { status: 'waiting_approval', question: (result as { question?: string }).question };
      }

      updatePlanStep(planId, target.index, {
        status: 'succeeded',
        result,
        finishedAt: new Date().toISOString(),
      });
      updatePlan(planId, { cursor: target.index + 1 });
      addTurn({
        planId,
        projectId: current.projectId,
        role: 'tool',
        content: `完成：${target.title}`,
        toolName: target.tool,
        data: result,
      });

      if (target.tool === 'finish') {
        updatePlan(planId, { status: 'completed' });
        return { status: 'completed', message: (result as { message?: string }).message ?? '' };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updatePlanStep(planId, target.index, { status: 'failed', error: message, finishedAt: new Date().toISOString() });
      updatePlan(planId, { status: 'failed', error: message });
      addTurn({
        planId,
        projectId: current.projectId,
        role: 'assistant',
        content: `步骤「${target.title}」执行失败：${message}`,
        toolName: target.tool,
      });
      log(`步骤失败：${message}`, 'error');
      return { status: 'failed', error: message };
    }
  }

  updatePlan(planId, { status: 'completed', cursor: steps.length });
  return { status: 'completed' };
}

/** 第一次执行时调用模型做规划 */
async function planOnce(planId: string, options: AgentRunOptions) {
  const plan = getPlan(planId);
  if (!plan) throw new Error(`Agent 计划不存在：${planId}`);
  const { log } = options;

  updatePlan(planId, { status: 'planning', error: null });
  const snapshot = loadContent(plan.projectId).snapshot;

  try {
    const messages = buildPlannerMessages({ goal: plan.goal, snapshot });
    const result = await runText({ messages, json: true, temperature: 0.3, maxTokens: 4000 });
    const draft = parsePlanResponse(result.text);
    const steps = draftToSteps(draft);
    addTurn({
      planId,
      projectId: plan.projectId,
      role: 'assistant',
      content: draft.summary || '已生成执行计划',
      data: { steps: steps.map((step) => ({ title: step.title, tool: step.tool })) },
    });
    return updatePlan(planId, {
      summary: draft.summary,
      question: draft.question ?? null,
      steps,
      status: 'running',
      cursor: 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`模型规划不可用，改用标准制片流程：${message}`, 'warn');
    return updatePlan(planId, {
      summary: '模型规划不可用，已按标准制片流程生成计划',
      steps: fallbackPlan(plan.goal, snapshot),
      status: 'running',
      cursor: 0,
    });
  }
}

/** 工具执行实现：把每个 AgentTool 映射到真实的生成动作 */
async function executeAgentTool(
  projectId: string,
  step: AgentStep,
  options: AgentRunOptions,
): Promise<Record<string, unknown>> {
  const args = step.args as Record<string, unknown>;
  const { log } = options;
  const str = (key: string): string | undefined => (args[key] === undefined ? undefined : String(args[key]));
  const num = (key: string): number | undefined => (args[key] === undefined ? undefined : Number(args[key]));
  const bool = (key: string): boolean => Boolean(args[key]);

  switch (step.tool) {
    case 'agent.ask_user':
      return { question: str('question') ?? '请补充项目设定或创作要求。' };

    case 'project.update_brief': {
      const briefPatch: Record<string, unknown> = {};
      for (const key of [
        'genres',
        'style',
        'aspectRatio',
        'targetDurationSec',
        'language',
        'logline',
        'notes',
        'audience',
        'negativePrompt',
      ]) {
        if (args[key] !== undefined) briefPatch[key] = args[key];
      }
      const updated = updateProject(projectId, {
        ...(str('name') ? { name: String(str('name')) } : {}),
        brief: briefPatch as never,
      });
      return { name: updated.brief.name, genres: updated.brief.genres, style: updated.brief.style };
    }

    case 'screenplay.generate': {
      const screenplay = await generateScreenplay(projectId, {
        idea: str('idea'),
        keepExistingCharacters: bool('keepExistingCharacters'),
      });
      return {
        title: screenplay.title,
        characters: screenplay.characters.map((c) => c.name),
        beats: screenplay.beats.length,
      };
    }

    case 'screenplay.update': {
      const current = getScreenplay(projectId);
      if (!current) throw new Error('尚未生成剧本，无法修改');
      const result = await runText({
        messages: [
          {
            role: 'system',
            content: '你是剧本编辑。请严格按要求修改剧本 JSON，只输出修改后的完整 JSON，结构与输入保持一致。',
          },
          {
            role: 'user',
            content: `修改要求：${str('instruction') ?? '优化节奏与台词'}\n\n现有剧本 JSON：\n${JSON.stringify(
              {
                title: current.title,
                logline: current.logline,
                synopsis: current.synopsis,
                characters: current.characters,
                locations: current.locations,
                props: current.props,
                beats: current.beats,
              },
              null,
              1,
            )}`,
          },
        ],
        json: true,
        temperature: 0.5,
        maxTokens: 8000,
      });
      const draft = parseWithSchema(screenplaySchema, extractJson(result.text), '修改后的剧本');
      const screenplay = upsertScreenplay(projectId, {
        title: draft.title,
        logline: draft.logline,
        synopsis: draft.synopsis,
        characters: draft.characters.map((item) => {
          const existing = current.characters.find((c) => c.name === item.name);
          return {
            id: existing?.id ?? `cha_${item.name}`,
            name: item.name,
            aliases: item.aliases ?? [],
            role: item.role as typeof current.characters[number]['role'],
            gender: item.gender as typeof current.characters[number]['gender'],
            age: item.age,
            appearance: item.appearance,
            costume: item.costume,
            personality: item.personality,
            background: item.background,
            voiceStyle: item.voiceStyle,
            assetId: existing?.assetId ?? null,
          };
        }),
        locations: current.locations,
        props: current.props,
        beats: draft.beats.map((beat, index) => ({
          id: current.beats[index]?.id ?? `beat_${index}`,
          index,
          title: beat.title,
          summary: beat.summary,
          locationId: current.locations.find((l) => l.name === beat.locationName)?.id ?? null,
          characterIds: draft.characters
            .filter((c) => beat.characterNames.includes(c.name))
            .map((c) => current.characters.find((item) => item.name === c.name)?.id)
            .filter((id): id is string => Boolean(id)),
          mood: beat.mood,
          durationSec: beat.durationSec,
        })),
        raw: result.text,
        source: 'ai',
      });
      return { title: screenplay.title, beats: screenplay.beats.length };
    }

    case 'asset.plan': {
      const assets = planAssetsFromScreenplay(projectId, { instructions: str('instructions') });
      return { count: assets.length, assets: assets.map((asset) => `${asset.type}:${asset.name}`) };
    }
  }

  return executeGenerationTool(projectId, step, options);
}

/** 生成类工具（图片 / 视频 / 时间线 / 渲染 / 检索） */
async function executeGenerationTool(
  projectId: string,
  step: AgentStep,
  options: AgentRunOptions,
): Promise<Record<string, unknown>> {
  const args = step.args as Record<string, unknown>;
  const { log } = options;
  const str = (key: string): string | undefined => (args[key] === undefined ? undefined : String(args[key]));
  const num = (key: string): number | undefined => (args[key] === undefined ? undefined : Number(args[key]));
  const bool = (key: string): boolean => Boolean(args[key]);

  switch (step.tool) {
    case 'asset.generate': {
      const names = Array.isArray(args.assetNames) ? (args.assetNames as string[]) : null;
      const regenerate = bool('regenerate');
      const targets = listAssets(projectId).filter((asset) =>
        names && names.length > 0 ? names.includes(asset.name) : regenerate || asset.mediaIds.length === 0,
      );
      let succeeded = 0;
      const failed: string[] = [];
      for (const asset of targets) {
        try {
          await generateAssetImage(asset.id, { variants: num('variants') });
          succeeded += 1;
          log(`资产「${asset.name}」已生成（${succeeded}/${targets.length}）`);
        } catch (error) {
          failed.push(`${asset.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      return { total: targets.length, succeeded, failed };
    }

    case 'shot.plan': {
      const shots = await planShotsFromScreenplay(projectId, {
        maxShots: num('maxShots'),
        cameraPreference: str('cameraPreference'),
        replaceExisting: bool('replaceExisting'),
      });
      return { total: shots.length };
    }

    case 'shot.generate': {
      const indexes = Array.isArray(args.shotIndexes) ? (args.shotIndexes as number[]) : null;
      const withFirstFrame = args.withFirstFrame === undefined ? true : bool('withFirstFrame');
      const regenerate = bool('regenerate');
      const targets = listShots(projectId).filter((shot) =>
        indexes && indexes.length > 0 ? indexes.includes(shot.index) : regenerate || shot.clipMediaIds.length === 0,
      );
      let succeeded = 0;
      const failed: string[] = [];
      for (const shot of targets) {
        try {
          await runShotToCompletion(shot, { withFirstFrame, log });
          succeeded += 1;
        } catch (error) {
          failed.push(`#${shot.index}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      return { total: targets.length, succeeded, failed };
    }

    case 'timeline.build': {
      const timeline = buildTimelineFromShots(projectId, {
        transition: (str('transition') as 'fade' | 'dissolve' | 'none' | undefined) ?? 'fade',
        transitionDuration: num('transitionDuration') ?? 0.4,
        includeSubtitles: args.includeSubtitles === undefined ? true : bool('includeSubtitles'),
      });
      return {
        clips: timeline.tracks.reduce((sum, track) => sum + track.clips.length, 0),
        durationSec: timeline.durationSec,
      };
    }

    case 'timeline.render': {
      const result = await renderTimeline(projectId, {
        includeSubtitles: args.includeSubtitles === undefined ? true : bool('includeSubtitles'),
      });
      return { outputUrl: result.outputUrl, durationSec: result.durationSec };
    }

    case 'prompt.lookup': {
      const templates = listPromptTemplates({ query: str('query'), category: str('category') });
      return {
        count: templates.length,
        templates: templates.slice(0, 8).map((template) => ({
          id: template.id,
          name: template.name,
          category: template.category,
        })),
      };
    }

    case 'finish':
      return { message: str('message') ?? '全部步骤已完成' };

    default: {
      const project = getProject(projectId);
      return { skipped: true, project: project?.brief.name ?? '' };
    }
  }
}

/** 单个镜头：提交 + 轮询直到完成 */
async function runShotToCompletion(
  shot: Shot,
  options: { withFirstFrame: boolean; log: (message: string, level?: 'info' | 'warn' | 'error') => void },
): Promise<void> {
  const { providerId, taskId } = await submitShotVideo(shot.id, { withFirstFrame: options.withFirstFrame });
  const timeoutMs = Number(process.env.ASYNC_TASK_TIMEOUT ?? 1800) * 1000;
  const startedAt = Date.now();

  for (;;) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('视频任务超时');
    const state = await checkShotVideo(providerId, taskId);
    if (state.status === 'succeeded' && state.videoUrl) {
      await finishShotVideo(shot.id, state.videoUrl, { providerId, taskId, durationSec: state.durationSec });
      options.log(`镜头 #${shot.index} 生成完成`);
      return;
    }
    if (state.status === 'failed' || state.status === 'canceled') {
      const message = state.error ?? `供应商状态：${state.rawStatus ?? state.status}`;
      failShotVideo(shot.id, message);
      throw new Error(message);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}
