'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import type { AgentChatTurn, AgentPlan } from '@sakura/core';
import { Badge, Button, Card, Empty, Textarea } from '@/components/ui';
import { answerPlanAction, approvePlanAction, cancelPlanAction, startAgentPlanAction } from '@/app/actions/agent';

/**
 * 自动规划 Agent 面板：目标 → 计划 → 逐步确认执行
 */

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
    const result = await fn();
    if (!result.ok) setError(result.error ?? '执行失败');
    else {
      router.refresh();
      onRefresh();
    }
    setBusy(false);
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
              plan.status
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
        <div className="mt-2 flex gap-2">
          <Button
            variant="primary"
            loading={busy || running}
            disabled={!goal.trim()}
            onClick={() => exec(() => startAgentPlanAction(projectId, goal, mode === 'action'))}
          >
            启动 Agent
          </Button>
          {plan ? (
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

  return (
    <Card title="执行计划" extra={<span className="text-[11px] text-slate-500">{plan.steps.length} 步</span>}>
      <div className="mb-2 text-[11px] leading-relaxed text-slate-500">{plan.summary}</div>

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
                {step.status === 'running' ? '执行中…' : step.status}
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
