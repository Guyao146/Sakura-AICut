'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import type { AgentChatTurn, AgentPlan, AgentPlanStatus, AgentStepStatus } from '@sakura/core';
import { Badge, Button, Card, Empty, Progress, Textarea } from '@/components/ui';
import { answerPlanAction, approvePlanAction, cancelPlanAction, startAgentPlanAction } from '@/app/actions/agent';

/**
 * 自动规划 Agent 面板：目标 → 计划 → 逐步确认执行
 */

/** 计划状态中文化 */
const PLAN_STATUS_LABELS: Record<AgentPlanStatus, string> = {
  planning: '规划中',
  waiting_approval: '待确认',
  running: '执行中',
  paused: '已暂停',
  completed: '已完成',
  failed: '失败',
  canceled: '已取消',
};

const STEP_STATUS_LABELS: Record<AgentStepStatus, string> = {
  pending: '待执行',
  queued: '排队中',
  running: '执行中',
  succeeded: '已完成',
  failed: '失败',
  canceled: '已取消',
  waiting_approval: '待确认',
  skipped: '已跳过',
};

/** 目标预设：不知道怎么描述时直接点 */
const GOAL_PRESETS = [
  '帮我做成 90 秒竖屏短剧：先出剧本，再出资产与分镜，最后拼好时间线',
  '只出剧本和角色资产，分镜我自己来',
  '从分镜一路到时间线合成，并完成配音',
  '把画布上有提示词的节点全部生成图片',
];

export function AgentPanel({
  projectId,
  plan: initialPlan,
  turns: initialTurns,
  mode,
  running,
  onRefresh,
}: {
  projectId: string;
  plan: AgentPlan | null;
  turns: AgentChatTurn[];
  /** 计划模式：每步等确认；行动模式：全自动执行 */
  mode: 'plan' | 'action';
  running: boolean;
  onRefresh: () => void;
}) {
  const router = useRouter();
  const [goal, setGoal] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<AgentPlan | null>(initialPlan);
  const [turns, setTurns] = useState<AgentChatTurn[]>(initialTurns);

  useEffect(() => {
    setPlan(initialPlan);
    setTurns(initialTurns);
  }, [initialPlan, initialTurns]);

  async function exec(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    try {
      const result = await fn();
      if (!result.ok) setError(result.error ?? '执行失败');
      else {
        router.refresh();
        onRefresh();
      }
    } catch (cause) {
      // Server Action 走网络，断网 / 超时也要给出可读原因，而不是静默卡住
      setError(cause instanceof Error ? cause.message : '网络异常，请稍后重试');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <Card
        title="自动规划 Agent"
        extra={
          <Badge tone={running ? 'blue' : plan ? 'pink' : 'default'}>
            {running ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="agent-badge-running inline-block size-1.5 rounded-full bg-sky-300" />
                执行中
              </span>
            ) : plan ? (
              PLAN_STATUS_LABELS[plan.status] ?? plan.status
            ) : (
              '待启动'
            )}
          </Badge>
        }
      >
        {/* 计划模式 / 行动模式 说明条 */}
        <div className="mb-3 rounded-lg border border-[#242a36] bg-[#0e1116] p-2">
          <div className="flex items-center gap-2 text-[11px]">
            <span className={clsx('font-medium', mode === 'plan' ? 'text-sky-300' : 'text-amber-300')}>
              {mode === 'plan' ? '🧭 计划模式' : '⚡ 行动模式'}
            </span>
          </div>
          <div className="mt-1 text-[11px] leading-relaxed text-slate-500">
            {mode === 'plan'
              ? '先出完整计划，每个步骤执行前等你确认，安全可控。'
              : '全自动执行不再逐步确认，速度更快，会直接消耗额度。'}
          </div>
        </div>

        <Textarea
          rows={3}
          value={goal}
          placeholder="例如：帮我做成 90 秒竖屏短剧：先出剧本，再出资产与分镜，最后拼好时间线"
          onChange={(event) => setGoal(event.target.value)}
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {GOAL_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setGoal(preset)}
              className="max-w-full truncate rounded-full border border-[#2b3240] px-2.5 py-1 text-[10px] text-slate-400 transition-colors hover:border-pink-400/40 hover:text-slate-200"
              title={preset}
            >
              {preset.length > 14 ? `${preset.slice(0, 14)}…` : preset}
            </button>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <Button
            variant="primary"
            loading={busy || running}
            disabled={!goal.trim()}
            onClick={() => exec(() => startAgentPlanAction(projectId, goal, mode === 'action'))}
          >
            启动 Agent
          </Button>
          {plan && !['completed', 'failed', 'canceled'].includes(plan.status) ? (
            <Button loading={busy} variant="ghost" onClick={() => exec(() => cancelPlanAction(plan.id))}>
              取消计划
            </Button>
          ) : null}
        </div>
        {error ? (
          <div className="mt-2 rounded-md border border-red-500/30 bg-red-500/10 p-2 text-[11px] text-red-300">
            {error}
          </div>
        ) : null}
      </Card>

      {plan ? <PlanSteps plan={plan} busy={busy} answer={answer} setAnswer={setAnswer} exec={exec} /> : null}

      {turns.length > 0 ? (
        <Card title="执行轨迹">
          <div className="max-h-[240px] space-y-1.5 overflow-y-auto pr-1">
            {turns.map((turn) => (
              <div key={turn.id} className="rounded-lg bg-white/5 p-2 text-[11px] leading-relaxed text-slate-300">
                <span className="mr-1 text-slate-500">
                  {turn.role === 'user' ? '我' : turn.role === 'tool' ? `工具 ${turn.toolName ?? ''}` : 'Agent'}：
                </span>
                {turn.content}
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <Card title="执行轨迹">
          <Empty text="还没有计划。描述目标后点击「启动 Agent」。" />
        </Card>
      )}
    </div>
  );
}

/** 计划步骤列表 + 确认区 */
function PlanSteps({
  plan,
  busy,
  answer,
  setAnswer,
  exec,
}: {
  plan: AgentPlan;
  busy: boolean;
  answer: string;
  setAnswer: (value: string) => void;
  exec: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const toneByStatus: Record<string, 'green' | 'red' | 'blue' | 'default' | 'amber'> = {
    succeeded: 'green',
    failed: 'red',
    running: 'blue',
    waiting_approval: 'amber',
  };

  // 步骤进度：完成数 / 总数，让「还差几步」一目了然
  const finished = plan.steps.filter((step) => step.status === 'succeeded').length;
  const percent = plan.steps.length > 0 ? Math.round((finished / plan.steps.length) * 100) : 0;

  return (
    <Card title="执行计划" extra={<span className="text-[11px] text-slate-500">{plan.steps.length} 步 · {percent}%</span>}>
      <div className="mb-2 text-[11px] leading-relaxed text-slate-500">{plan.summary}</div>
      {plan.steps.length > 0 ? (
        <div className="mb-3 flex items-center gap-2">
          <Progress value={percent} />
          <span className="shrink-0 text-[10px] text-slate-500">{finished}/{plan.steps.length}</span>
        </div>
      ) : null}

      {plan.question ? (
        <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2">
          <div className="text-[11px] text-amber-200">Agent 需要你确认：</div>
          <div className="mt-1 whitespace-pre-wrap text-[12px] text-amber-100">{plan.question}</div>
          <Textarea
            rows={2}
            className="mt-2"
            value={answer}
            placeholder="补充你的设定或直接回答"
            onChange={(event) => setAnswer(event.target.value)}
          />
          <Button
            className="mt-2"
            size="sm"
            variant="primary"
            loading={busy}
            onClick={() => exec(() => answerPlanAction(plan.id, answer))}
          >
            提交回答并继续
          </Button>
        </div>
      ) : null}

      <div className="space-y-1.5">
        {plan.steps.map((step) => (
          <div
            key={step.id}
            className={clsx(
              'rounded-lg border p-2 transition-colors duration-300',
              step.status === 'succeeded'
                ? 'border-emerald-500/30 bg-emerald-500/5'
                : step.status === 'failed'
                  ? 'border-red-500/30 bg-red-500/5'
                  : step.status === 'running'
                    ? 'agent-step-running border-sky-500/40 bg-sky-500/5'
                    : 'border-[#242a36] bg-[#0e1116]',
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-[12px] text-slate-200">
                {step.status === 'running' ? (
                  <span className="agent-badge-running text-sky-300">⚡</span>
                ) : null}
                {step.index + 1}. {step.title}
              </span>
              <Badge tone={toneByStatus[step.status] ?? 'default'}>
                {STEP_STATUS_LABELS[step.status] ?? step.status}
              </Badge>
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">{step.rationale}</div>
            <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-600">
              <span>工具：{step.tool}</span>
              {step.estimatedCost ? <span>· {step.estimatedCost}</span> : null}
            </div>
            {step.error ? <div className="mt-1 text-[10px] text-red-400">{step.error}</div> : null}
          </div>
        ))}
      </div>

      {plan.status === 'waiting_approval' && !plan.question ? (
        <Button className="mt-3" variant="primary" loading={busy} onClick={() => exec(() => approvePlanAction(plan.id))}>
          确认并继续执行
        </Button>
      ) : null}
    </Card>
  );
}
