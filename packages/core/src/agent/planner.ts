import type { AgentStep, PlanDraft } from '../types/agent';
import type { ChatMessage } from '../ai/types';
import { AGENT_PLANNER_SYSTEM_PROMPT } from '../prompt/assistant-prompts';
import { extractJson, renderTemplate } from '../utils/text';
import { createId } from '../utils/id';
import { planDraftSchema, parseWithSchema } from '../pipeline/schema';
import { buildToolCatalog, findAgentTool, isKnownTool } from './tools';
import type { ProjectSnapshot } from '../pipeline/steps';

/**
 * 自动规划 Agent —— 规划器
 * 负责：把项目快照 + 用户目标 → 送给 LLM → 解析出可执行的步骤计划
 */

export interface PlannerInput {
  goal: string;
  snapshot: ProjectSnapshot;
  /** 用户之前的回答（由 ask_user 收集） */
  answers?: string[];
  /** 上一轮计划的结论，避免重复规划 */
  previousSummary?: string;
  /** 额外上下文（例如可用的运镜模板 key 列表） */
  extraContext?: string;
}

/** 把项目快照压缩成模型可读的摘要，控制 token 消耗 */
export function summarizeSnapshot(snapshot: ProjectSnapshot): string {
  const { brief, screenplay, assets = [], shots = [], timeline } = snapshot;
  const lines: string[] = [];
  lines.push(
    `【项目设定】名称：${brief.name}；题材：${brief.genres.join('、') || '未设定'}；风格：${brief.style}；画幅：${brief.aspectRatio}；目标时长：${brief.targetDurationSec} 秒；语言：${brief.language}`,
  );

  if (screenplay) {
    lines.push(
      `【剧本】标题：${screenplay.title}；梗概：${screenplay.synopsis || '（空）'}；人物 ${screenplay.characters.length} 人：${screenplay.characters
        .map((c) => `${c.name}(${c.role})`)
        .join('、')}；场景 ${screenplay.locations.length} 个：${screenplay.locations.map((l) => l.name).join('、')}；道具 ${screenplay.props.length} 个；节拍 ${screenplay.beats.length} 段。`,
    );
    if (screenplay.beats.length > 0) {
      lines.push(
        `【节拍】${screenplay.beats
          .slice(0, 20)
          .map((b) => `${b.index + 1}.${b.title}(${b.durationSec}s)`)
          .join(' → ')}`,
      );
    }
  } else {
    lines.push('【剧本】尚未生成');
  }

  if (assets.length > 0) {
    lines.push(
      `【资产】共 ${assets.length} 项，${assets.filter((a) => a.mediaIds.length > 0).length} 项已出图：${assets
        .slice(0, 20)
        .map((a) => `${a.name}[${a.type}${a.mediaIds.length > 0 ? '✓' : '✗'}]`)
        .join('、')}`,
    );
  } else {
    lines.push('【资产】尚未规划');
  }

  if (shots.length > 0) {
    lines.push(
      `【分镜】共 ${shots.length} 个镜头，${shots.filter((s) => s.clipMediaIds.length > 0).length} 个已生成片段，总时长约 ${shots.reduce(
        (sum, s) => sum + s.durationSec,
        0,
      )} 秒。状态：${shots
        .slice(0, 12)
        .map((s) => `#${s.index}${s.selectedMediaId ? '✓' : s.clipMediaIds.length > 0 ? '◐' : '✗'}`)
        .join(' ')}`,
    );
  } else {
    lines.push('【分镜】尚未拆解');
  }

  lines.push(
    timeline && timeline.tracks.some((t) => t.clips.length > 0)
      ? `【时间线】已有 ${timeline.tracks.reduce((sum, t) => sum + t.clips.length, 0)} 个片段，总时长 ${timeline.durationSec.toFixed(1)} 秒${timeline.renderOutputUrl ? '，已导出成片' : ''}`
      : '【时间线】尚未编排',
  );

  return lines.join('\n');
}

export function buildPlannerMessages(input: PlannerInput): ChatMessage[] {
  const system = renderTemplate(AGENT_PLANNER_SYSTEM_PROMPT, { toolCatalog: buildToolCatalog() });
  const userParts = [`【用户目标】${input.goal}`, '', '【项目当前状态】', summarizeSnapshot(input.snapshot)];
  if (input.previousSummary) userParts.push('', `【上一轮结论】${input.previousSummary}`);
  if (input.answers && input.answers.length > 0) {
    userParts.push('', `【用户对提问的回答】\n${input.answers.map((a, i) => `${i + 1}. ${a}`).join('\n')}`);
  }
  if (input.extraContext) userParts.push('', `【补充上下文】${input.extraContext}`);
  userParts.push('', '请输出 JSON 计划。');

  return [
    { role: 'system', content: system },
    { role: 'user', content: userParts.join('\n') },
  ];
}

/** 解析模型返回的计划 JSON → PlanDraft（容错 + 工具名校验） */
export function parsePlanResponse(text: string): PlanDraft {
  const raw = extractJson<Record<string, unknown>>(text);
  const draft = parseWithSchema(planDraftSchema, raw, 'Agent 计划');

  const steps = draft.steps
    .filter((step) => isKnownTool(step.tool) || isKnownTool(step.tool.toLowerCase().replace(/_/g, '.')))
    .map((step) => ({ ...step, tool: step.tool.toLowerCase().replace(/_/g, '.') }));

  if (steps.length === 0) throw new Error('Agent 计划为空或工具名全部非法');
  return { summary: draft.summary, question: draft.question, steps };
}

/** PlanDraft → AgentStep[]（补齐 id、依赖、审批标记） */
export function draftToSteps(draft: PlanDraft): AgentStep[] {
  return draft.steps.map((item, index) => {
    const meta = findAgentTool(item.tool);
    return {
      id: `step_${index + 1}`,
      index,
      title: item.title,
      rationale: item.rationale,
      tool: item.tool as AgentStep['tool'],
      args: item.args ?? {},
      // 默认串联依赖：后一步依赖前一步，保证顺序执行的可预期性
      dependsOn: index === 0 ? [] : [`step_${index}`],
      status: 'pending' as const,
      needsApproval: item.needsApproval ?? meta?.requiresApproval ?? false,
      estimatedCost: item.estimatedCost ?? null,
      result: null,
      error: null,
      startedAt: null,
      finishedAt: null,
    };
  });
}

/** 生成计划 ID */
export function newPlanId(): string {
  return `plan_${createId(12)}`;
}

/**
 * 手工构建「标准制片流程」计划：LLM 不可用或用户选择「一键走完流程」时的降级方案
 */
export function fallbackPlan(goal: string, snapshot: ProjectSnapshot): AgentStep[] {
  const draft: PlanDraft = { summary: `按标准流程推进：${goal}`, steps: [] };

  if (!snapshot.screenplay) {
    draft.steps.push({
      title: '生成剧本结构',
      rationale: '后续资产与分镜都依赖剧本，必须先产出',
      tool: 'screenplay.generate',
      args: {},
    });
    draft.steps.push({
      title: '规划资产清单',
      rationale: '把剧本中的人物、场景、道具转成待生成资产',
      tool: 'asset.plan',
      args: {},
    });
  }
  if (!snapshot.shots || snapshot.shots.length === 0) {
    draft.steps.push({
      title: '拆解分镜镜头',
      rationale: '把节拍拆成可生成的镜头列表',
      tool: 'shot.plan',
      args: { maxShots: Math.min(60, Math.ceil(snapshot.brief.targetDurationSec / 5)) },
    });
  }
  draft.steps.push({
    title: '生成资产图',
    rationale: '先锁定人物与场景外观，保证画面一致性',
    tool: 'asset.generate',
    args: {},
  });
  draft.steps.push({
    title: '生成镜头片段',
    rationale: '按镜头生成视频素材',
    tool: 'shot.generate',
    args: {},
  });
  draft.steps.push({
    title: '构建时间线',
    rationale: '把片段铺到时间线并加转场字幕',
    tool: 'timeline.build',
    args: { transition: 'fade', includeSubtitles: true },
  });
  draft.steps.push({
    title: '汇报结果',
    rationale: '结束执行并总结产出',
    tool: 'finish',
    args: { message: '已按标准流程完成推进' },
  });

  return draftToSteps(draft);
}

