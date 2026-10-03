'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Empty, Textarea } from '@/components/ui';
import type {
  QaReport,
  QaSummary,
  QaVerdict,
  ReplicateAnalysis,
  ScreenplayVersion,
  ShotPreviewPlan,
  VideoRedraw,
} from '@sakura/core';
import {
  REDRAW_CHARACTER_PRESETS,
  REDRAW_DIMENSION_LABELS,
  REDRAW_STYLE_PRESETS,
} from '@sakura/core';
import {
  analyzeReferenceAction,
  createRedrawAction,
  extractKeyframesAction,
  listRedrawsAction,
  planShotPreviewAction,
  processRedrawAction,
  rollbackScreenplayVersionAction,
  runShotPreviewAction,
  saveScreenplayVersionAction,
} from '@/app/actions/features';
import { getProjectQaSummaryAction, startQaReviewAction } from '@/app/actions/qa';
import { reshootShotAction } from '@/app/actions/production';

/**
 * 流程层功能面板：⑦ 智能预演 / ⑧ 剧本版本 / ⑩ 爆款复刻 / 重制转绘
 */

/* ------------------------------ ⑦ 智能预演 ------------------------------ */

export function SmartPreviewPanel({ projectId }: { projectId: string }) {
  const [plan, setPlan] = useState<ShotPreviewPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Array<{ shotId: string; ok: boolean; url?: string; error?: string }>>([]);
  const [error, setError] = useState<string | null>(null);

  const handlePlan = async () => {
    setBusy(true);
    setError(null);
    const result = await planShotPreviewAction(projectId);
    if (result.ok) setPlan(result.data!);
    else setError(result.error ?? '规划失败');
    setBusy(false);
  };

  const handleRun = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    const result = await runShotPreviewAction(projectId, plan.shotIds);
    if (result.ok) setResults(result.data!);
    else setError(result.error ?? '预演失败');
    setBusy(false);
  };

  return (
    <div className="rounded-lg border border-[#242a36] bg-[#0e1116] p-2.5">
      <div className="mb-2 flex items-center gap-1.5">
        <Badge tone="blue">⑦ 智能预演</Badge>
        <span className="text-[10px] text-slate-500">多镜头一致性 · 降低抽卡率</span>
      </div>
      <p className="mb-2 text-[11px] leading-relaxed text-slate-400">
        为一组镜头统一规划关键分镜图（首帧），锁定人物外观与场景氛围，再批量生成，保持多镜头间动作与空间逻辑一致。
      </p>
      <div className="mb-2 flex gap-1.5">
        <Button size="sm" variant="default" loading={busy} onClick={() => void handlePlan()}>
          🧠 规划预演
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!plan || busy}
          onClick={() => void handleRun()}
          title="按规划批量生成首帧图（消耗模型额度）"
        >
          ▶ 执行预演
        </Button>
      </div>
      {error ? <div className="mb-2 text-[11px] text-red-300">{error}</div> : null}
      {plan ? (
        <div className="mb-2 space-y-1.5 rounded-md border border-[#242a36] bg-[#12151c] p-2">
          <div className="text-[10px] text-slate-500">镜头数：{plan.shotIds.length}</div>
          <div className="text-[10px] text-slate-500">一致性锁定：{plan.consistencyPrompt.slice(0, 60)}…</div>
          {plan.framePrompts.slice(0, 3).map((frame) => (
            <div key={frame.shotId} className="truncate text-[10px] text-slate-400" title={frame.prompt}>
              · {frame.prompt.slice(0, 50)}…
            </div>
          ))}
        </div>
      ) : null}
      {results.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {results.map((r) => (
            <div
              key={r.shotId}
              className={
                r.ok
                  ? 'rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300'
                  : 'rounded bg-red-500/10 px-2 py-0.5 text-[10px] text-red-300'
              }
              title={r.error}
            >
              {r.ok ? '✓' : '✗'} {r.shotId.slice(0, 10)}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------ ⑧ 剧本版本 ------------------------------ */

export function ScriptVersionPanel({
  projectId,
  versions,
  currentRaw,
}: {
  projectId: string;
  versions: ScreenplayVersion[];
  currentRaw: string;
}) {
  const [draft, setDraft] = useState(currentRaw);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    const result = await saveScreenplayVersionAction(projectId, draft);
    if (!result.ok) setError(result.error ?? '落稿失败');
    setBusy(false);
  };

  const handleRollback = async (versionId: string) => {
    if (!window.confirm('回滚后当前剧本会被覆盖（会保留一条回滚记录），确定？')) return;
    setBusy(true);
    setError(null);
    const result = await rollbackScreenplayVersionAction(versionId);
    if (!result.ok) setError(result.error ?? '回滚失败');
    setBusy(false);
  };

  return (
    <div className="rounded-lg border border-[#242a36] bg-[#0e1116] p-2.5">
      <div className="mb-2 flex items-center gap-1.5">
        <Badge tone="pink">⑧ 剧本版本</Badge>
        <span className="text-[10px] text-slate-500">落稿 / 回滚 / 对比</span>
      </div>
      <Textarea
        rows={4}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="把助手生成的剧本粘贴到这里，或直接编辑当前剧本…"
        className="mb-2"
      />
      <div className="mb-3 flex justify-end">
        <Button size="sm" variant="primary" loading={busy} onClick={() => void handleSave()}>
          💾 落稿为新版本
        </Button>
      </div>
      {error ? <div className="mb-2 text-[11px] text-red-300">{error}</div> : null}
      {versions.length === 0 ? (
        <Empty text="还没有剧本版本，落稿后会显示在这里" />
      ) : (
        <div className="space-y-1.5">
          {versions.map((version) => (
            <div
              key={version.id}
              className="flex items-center gap-2 rounded-md border border-[#242a36] bg-[#12151c] px-2 py-1.5"
            >
              <span className="shrink-0 text-[11px] font-medium text-pink-300">v{version.version}</span>
              <span className="flex-1 truncate text-[11px] text-slate-300" title={version.title}>
                {version.title}
              </span>
              {version.source === 'rollback' ? <Badge tone="amber">回滚</Badge> : null}
              {version.source === 'ai' ? <Badge tone="blue">AI</Badge> : null}
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleRollback(version.id)}
                className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-slate-400 transition-colors hover:bg-white/10 hover:text-slate-200 disabled:opacity-40"
                title="回滚到这个版本"
              >
                ↩ 回滚
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ ⑩ 爆款复刻 ------------------------------ */

export function ReplicatePanel({ projectId: _projectId }: { projectId: string }) {
  const [reference, setReference] = useState('');
  const [keepStyle, setKeepStyle] = useState(true);
  const [busy, setBusy] = useState(false);
  const [analysis, setAnalysis] = useState<ReplicateAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAnalyze = async () => {
    if (!reference.trim()) return;
    setBusy(true);
    setError(null);
    const result = await analyzeReferenceAction(reference, { keepStyle });
    if (result.ok) setAnalysis(result.data!);
    else setError(result.error ?? '解析失败');
    setBusy(false);
  };

  return (
    <div className="rounded-lg border border-[#242a36] bg-[#0e1116] p-2.5">
      <div className="mb-2 flex items-center gap-1.5">
        <Badge tone="amber">⑩ 爆款复刻</Badge>
        <span className="text-[10px] text-slate-500">拆解爆款 DNA · 产出新剧本</span>
      </div>
      <Textarea
        rows={3}
        value={reference}
        onChange={(e) => setReference(e.target.value)}
        placeholder="粘贴参考视频链接或爆款文案…"
        className="mb-2"
      />
      <div className="mb-2 flex items-center justify-between">
        <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <input
            type="checkbox"
            checked={keepStyle}
            onChange={(e) => setKeepStyle(e.target.checked)}
            className="accent-pink-500"
          />
          沿用参考画风与节奏
        </label>
        <Button
          size="sm"
          variant="primary"
          loading={busy}
          disabled={!reference.trim()}
          onClick={() => void handleAnalyze()}
        >
          🔬 拆解
        </Button>
      </div>
      {error ? <div className="mb-2 text-[11px] text-red-300">{error}</div> : null}
      {analysis ? (
        <div className="space-y-2 rounded-md border border-[#242a36] bg-[#12151c] p-2 text-[11px] text-slate-300">
          {analysis.hooks.length > 0 ? (
            <div>
              <div className="text-[10px] font-medium text-amber-300">钩子</div>
              <ul className="ml-4 list-disc text-slate-400">
                {analysis.hooks.map((hook, i) => (
                  <li key={i}>{hook}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {analysis.structure ? (
            <div>
              <div className="text-[10px] font-medium text-amber-300">结构</div>
              <div className="text-slate-400">{analysis.structure}</div>
            </div>
          ) : null}
          {analysis.styleNotes ? (
            <div>
              <div className="text-[10px] font-medium text-amber-300">画风 / 配乐</div>
              <div className="text-slate-400">{analysis.styleNotes}</div>
            </div>
          ) : null}
          {analysis.outline ? (
            <div>
              <div className="text-[10px] font-medium text-amber-300">新剧本大纲</div>
              <div className="whitespace-pre-wrap text-slate-300">{analysis.outline}</div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------ 重制转绘 / 一键出海 ------------------------------ */

export function RedrawPanel({ projectId }: { projectId: string }) {
  const [sourceMediaId, setSourceMediaId] = useState('');
  const [characterPrompt, setCharacterPrompt] = useState('');
  const [stylePrompt, setStylePrompt] = useState('');
  const [scenePrompt, setScenePrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [redraws, setRedraws] = useState<VideoRedraw[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadRedraws = async () => {
    const result = await listRedrawsAction(projectId);
    if (result.ok) setRedraws(result.data!);
  };

  // 挂载时加载一次任务列表（edit 步骤面板被渲染时触发）
  useEffect(() => {
    void loadRedraws();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // 有任务进行中时轮询状态
  useEffect(() => {
    const hasRunning = redraws.some((item) => item.status === 'running' || item.status === 'pending');
    if (!hasRunning) return;
    const timer = setInterval(() => void loadRedraws(), 3000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [redraws]);

  const handleCreate = async () => {
    if (!sourceMediaId.trim()) {
      setError('请先填写原片媒体 ID（可从媒体库复制）');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await createRedrawAction({
      projectId,
      sourceMediaId,
      characterPrompt: characterPrompt || null,
      stylePrompt: stylePrompt || null,
      scenePrompt: scenePrompt || null,
    });
    if (result.ok) {
      setCharacterPrompt('');
      setStylePrompt('');
      setScenePrompt('');
      void loadRedraws();
    } else {
      setError(result.error ?? '创建重绘任务失败');
    }
    setBusy(false);
  };

  return (
    <div className="rounded-lg border border-[#242a36] bg-[#0e1116] p-2.5">
      <div className="mb-2 flex items-center gap-1.5">
        <Badge tone="green">重制转绘 / 一键出海</Badge>
        <span className="text-[10px] text-slate-500">原片换角色 / 画风 / 画幅</span>
      </div>
      <p className="mb-2 text-[11px] leading-relaxed text-slate-400">
        上传原片后指定替换维度，AI 抽取关键帧、理解构图运镜，按新设定逐帧重绘。维度：
        {Object.values(REDRAW_DIMENSION_LABELS).join(' / ')}
      </p>
      <input
        value={sourceMediaId}
        onChange={(e) => setSourceMediaId(e.target.value)}
        placeholder="原片媒体 ID（media_…）"
        className="field mb-2 w-full text-xs"
      />
      <div className="mb-2 flex flex-wrap gap-1">
        {REDRAW_CHARACTER_PRESETS.map((preset) => (
          <button
            key={preset.key}
            type="button"
            onClick={() => setCharacterPrompt(preset.prompt)}
            className="rounded-lg border border-[#333b4a] px-2 py-0.5 text-[10px] text-slate-300 transition-colors hover:bg-white/5"
          >
            👤 {preset.label}
          </button>
        ))}
      </div>
      <div className="mb-2 flex flex-wrap gap-1">
        {REDRAW_STYLE_PRESETS.map((preset) => (
          <button
            key={preset.key}
            type="button"
            onClick={() => setStylePrompt(preset.prompt)}
            className="rounded-lg border border-[#333b4a] px-2 py-0.5 text-[10px] text-slate-300 transition-colors hover:bg-white/5"
          >
            🎨 {preset.label}
          </button>
        ))}
      </div>
      {characterPrompt ? (
        <div className="mb-2 truncate rounded bg-[#12151c] px-2 py-1 text-[10px] text-cyan-300" title={characterPrompt}>
          👤 {characterPrompt.slice(0, 48)}
        </div>
      ) : null}
      {stylePrompt ? (
        <div className="mb-2 truncate rounded bg-[#12151c] px-2 py-1 text-[10px] text-cyan-300" title={stylePrompt}>
          🎨 {stylePrompt.slice(0, 48)}
        </div>
      ) : null}
      <Textarea
        rows={2}
        value={scenePrompt}
        onChange={(e) => setScenePrompt(e.target.value)}
        placeholder="场景替换描述（可选，例如：把办公室换成雨夜街头）"
        className="mb-2"
      />
      {error ? <div className="mb-2 text-[11px] text-red-300">{error}</div> : null}
      <div className="mb-3 flex justify-end">
        <Button size="sm" variant="primary" loading={busy} onClick={() => void handleCreate()}>
          ➕ 创建重绘任务
        </Button>
      </div>
      {redraws.length === 0 ? (
        <Empty text="还没有重绘任务" />
      ) : (
        <div className="space-y-1.5">
          {redraws.map((redraw) => (
            <RedrawCard
              key={redraw.id}
              redraw={redraw}
              onExtract={async () => {
                setBusy(true);
                setError(null);
                const result = await extractKeyframesAction(redraw.id);
                if (!result.ok) setError(result.error ?? '抽帧失败');
                void loadRedraws();
                setBusy(false);
              }}
              onProcess={async () => {
                setBusy(true);
                setError(null);
                const result = await processRedrawAction(redraw.id);
                if (!result.ok) setError(result.error ?? '重绘失败');
                void loadRedraws();
                setBusy(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** 单条重绘任务卡片：状态徽标 + 维度摘要 + 关键帧进度 + 操作按钮 */
function RedrawCard({
  redraw,
  onExtract,
  onProcess,
}: {
  redraw: VideoRedraw;
  onExtract: () => Promise<void>;
  onProcess: () => Promise<void>;
}) {
  const hasKeyframes = redraw.keyframes.length > 0;
  const done = redraw.keyframes.filter((frame) => frame.targetMediaId).length;
  const dims = [
    redraw.characterPrompt ? '换角色' : null,
    redraw.stylePrompt ? '换画风' : null,
    redraw.scenePrompt ? '换场景' : null,
  ].filter(Boolean);

  const tone =
    redraw.status === 'succeeded'
      ? ('green' as const)
      : redraw.status === 'running'
        ? ('blue' as const)
        : redraw.status === 'failed'
          ? ('red' as const)
          : ('default' as const);
  const statusLabel =
    redraw.status === 'succeeded'
      ? '✓ 完成'
      : redraw.status === 'running'
        ? '重绘中…'
        : redraw.status === 'failed'
          ? '失败'
          : hasKeyframes
            ? '已抽帧'
            : '待抽帧';

  return (
    <div className="rounded-md border border-[#242a36] bg-[#12151c] px-2 py-1.5">
      <div className="flex items-center gap-2">
        <Badge tone={tone}>{statusLabel}</Badge>
        <span className="flex-1 truncate text-[11px] text-slate-300" title={redraw.sourceMediaId}>
          {redraw.sourceMediaId.slice(0, 18)}
        </span>
        {dims.length > 0 ? (
          <span className="shrink-0 text-[10px] text-slate-500">{dims.join(' · ')}</span>
        ) : null}
      </div>
      {hasKeyframes ? (
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-[#0b0d12]">
            <div
              className="h-full rounded-full bg-emerald-500/60 transition-all"
              style={{ width: `${redraw.keyframes.length === 0 ? 0 : (done / redraw.keyframes.length) * 100}%` }}
            />
          </div>
          <span className="shrink-0 text-[10px] text-slate-500">
            {done}/{redraw.keyframes.length} 帧
          </span>
        </div>
      ) : null}
      {redraw.error ? (
        <div className="mt-1 truncate text-[10px] text-red-300/80" title={redraw.error}>
          {redraw.error.slice(0, 60)}
        </div>
      ) : null}
      {redraw.status !== 'succeeded' ? (
        <div className="mt-1.5 flex justify-end gap-1.5">
          {!hasKeyframes ? (
            <button
              type="button"
              onClick={() => void onExtract()}
              className="rounded px-2 py-0.5 text-[10px] text-slate-300 transition-colors hover:bg-white/10"
              title="用 ffmpeg 从原片抽取关键帧（快）"
            >
              🎞 抽帧
            </button>
          ) : null}
          {hasKeyframes && redraw.status !== 'running' ? (
            <button
              type="button"
              onClick={() => void onProcess()}
              className="rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300 transition-colors hover:bg-emerald-500/20"
              title="逐帧重绘（调图片模型，耗时；已完成的帧会跳过）"
            >
              ▶ {done > 0 ? '继续重绘' : '开始重绘'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}


/* ------------------------------ ⑨ 成片 QA ------------------------------ */

const QA_VERDICT_META: Record<QaVerdict, { label: string; tone: 'green' | 'amber' | 'red' }> = {
  pass: { label: '✓ 通过', tone: 'green' },
  warn: { label: '⚠ 有隐患', tone: 'amber' },
  fail: { label: '✗ 废片', tone: 'red' },
};

const QA_REPORT_ORDER: QaVerdict[] = ['fail', 'warn', 'pass'];

/** 成片 QA 与自动修复：ffprobe 探针 + 视觉评审，自动挡住废片 */
export function QaPanel({ projectId, running }: { projectId: string; running?: boolean }) {
  const [summary, setSummary] = useState<QaSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const result = await getProjectQaSummaryAction(projectId);
    if (result.ok && result.data) setSummary(result.data);
  };

  useEffect(() => {
    void load();
  }, [projectId]);

  // QA 任务在跑时轮询汇总，完成即刷新
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      void load();
    }, 3000);
    return () => clearInterval(timer);
  }, [running]);

  const handleStart = async (refresh: boolean) => {
    setBusy(true);
    setError(null);
    const result = await startQaReviewAction(projectId, { refresh });
    if (!result.ok) setError(result.error ?? '提交 QA 任务失败');
    setBusy(false);
    void load();
  };

  const handleReshoot = async (shotId: string) => {
    setBusy(true);
    setError(null);
    const result = await reshootShotAction(shotId);
    if (!result.ok) setError(result.error ?? '重抽失败');
    setBusy(false);
    void load();
  };

  const handleReshootAll = async () => {
    if (!summary) return;
    const failedShots = summary.reports.filter((report) => report.verdict === 'fail' && report.shotId);
    if (failedShots.length === 0) return;
    setBusy(true);
    setError(null);
    for (const report of failedShots) {
      const result = await reshootShotAction(report.shotId as string);
      if (!result.ok) {
        setError(result.error ?? '部分镜头重抽失败');
        break;
      }
    }
    setBusy(false);
    void load();
  };

  const reports = summary?.reports ?? [];
  const ordered = [...reports].sort((a, b) => QA_REPORT_ORDER.indexOf(a.verdict) - QA_REPORT_ORDER.indexOf(b.verdict));
  const failedCount = summary?.failed ?? 0;

  return (
    <div className="rounded-lg border border-[#242a36] bg-[#0e1116] p-2.5">
      <div className="mb-2 flex items-center gap-1.5">
        <Badge tone="pink">⑨ 成片 QA</Badge>
        <span className="text-[10px] text-slate-500">ffprobe 探针 + 视觉评审 · 自动挡废片</span>
      </div>
      <p className="mb-2 text-[11px] leading-relaxed text-slate-400">
        对每个生成片段做两道体检：先跑 ffprobe 探针（可解码性 / 时长 / 分辨率 / 帧率 / 黑屏），再抽首中尾三帧让视觉模型打分。未通过的片段自动踢出镜头选中位，并标记待重抽。
      </p>
      <div className="mb-2 flex flex-wrap gap-1.5">
        <Button size="sm" variant="primary" loading={busy} onClick={() => void handleStart(false)} title="只检查尚未通过的片段（省额度）">
          🧪 {running ? 'QA 检查中…' : '开始 QA 检查'}
        </Button>
        <Button size="sm" variant="default" disabled={busy || running} onClick={() => void handleStart(true)} title="强制重查全部片段（含已通过）">
          ⟳ 强制重查
        </Button>
        <Button
          size="sm"
          variant="default"
          disabled={busy || failedCount === 0}
          onClick={() => void handleReshootAll()}
          title="把所有未通过的镜头重新交给视频模型"
        >
          🔁 一键重抽（{failedCount}）
        </Button>
      </div>
      {error ? <div className="mb-2 text-[11px] text-red-300">{error}</div> : null}
      {summary && summary.total > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          <Badge tone="default">共 {summary.total}</Badge>
          <Badge tone="green">通过 {summary.passed}</Badge>
          <Badge tone="amber">隐患 {summary.warned}</Badge>
          <Badge tone="red">废片 {summary.failed}</Badge>
          {summary.skipped > 0 ? <Badge tone="blue">跳过 {summary.skipped}</Badge> : null}
        </div>
      ) : null}
      {ordered.length > 0 ? (
        <div className="space-y-1.5">
          {ordered.map((report) => (
            <QaReportCard key={report.id} report={report} busy={busy} onReshoot={handleReshoot} />
          ))}
        </div>
      ) : (
        <Empty text="还没有 QA 报告，点击「开始 QA 检查」体检已生成的片段" />
      )}
    </div>
  );
}


/** 单条 QA 报告卡片：评级徽标 + 评分 + 问题清单 + 重抽按钮 */
function QaReportCard({
  report,
  busy,
  onReshoot,
}: {
  report: QaReport;
  busy: boolean;
  onReshoot: (shotId: string) => Promise<void>;
}) {
  const meta = QA_VERDICT_META[report.verdict];
  const score = report.review?.score;
  const probe = report.probe;
  const probeLine = [
    probe.durationSec ? `${probe.durationSec.toFixed(1)}s` : null,
    probe.width && probe.height ? `${probe.width}x${probe.height}` : null,
    probe.fps ? `${probe.fps.toFixed(0)}fps` : null,
    probe.blackScreen === true ? '黑屏' : null,
    probe.hasAudio === false ? '无声' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="rounded-md border border-[#242a36] bg-[#12151c] px-2 py-1.5">
      <div className="flex items-center gap-2">
        <Badge tone={meta.tone}>{meta.label}</Badge>
        {score !== undefined && score !== null ? (
          <span
            className={`shrink-0 text-[10px] font-medium ${score >= 60 ? 'text-emerald-300' : score >= 45 ? 'text-amber-300' : 'text-red-300'}`}
          >
            {score} 分
          </span>
        ) : null}
        <span className="flex-1 truncate text-[11px] text-slate-400" title={report.mediaId}>
          {report.shotId ? `镜头片段 ${report.mediaId.slice(-8)}` : `媒体 ${report.mediaId.slice(-12)}`}
        </span>
        {report.verdict === 'fail' && report.shotId ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void onReshoot(report.shotId as string)}
            className="shrink-0 rounded bg-red-500/10 px-2 py-0.5 text-[10px] text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-50"
            title="把这个镜头重新交给视频模型生成"
          >
            🔁 重抽
          </button>
        ) : null}
      </div>
      {probeLine ? <div className="mt-1 text-[10px] text-slate-500">{probeLine}</div> : null}
      {report.issues.length > 0 ? (
        <div className="mt-1 space-y-0.5">
          {report.issues.slice(0, 3).map((issue, index) => (
            <div key={index} className="truncate text-[10px] text-slate-400" title={issue}>
              · {issue}
            </div>
          ))}
        </div>
      ) : null}
      {report.review?.summary ? (
        <div className="mt-1 truncate text-[10px] text-slate-500" title={report.review.summary}>
          {report.review.summary}
        </div>
      ) : null}
    </div>
  );
}
