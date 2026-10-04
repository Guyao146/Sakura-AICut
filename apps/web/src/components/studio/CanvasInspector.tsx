'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge, Button } from '@/components/ui';
import type { CanvasAiInput, CanvasItem, CanvasNodeJobState } from '@sakura/core';
import { CANVAS_ITEM_KIND_LABELS, CANVAS_NODE_ROLE_LABELS, isActiveJob } from '@sakura/core';

interface CanvasInspectorProps {
  item: CanvasItem | null;
  groupName?: string | null;
  onClose: () => void;
  onUpdate: (patch: Partial<CanvasItem>) => Promise<void>;
  onDelete: () => Promise<void>;
  onBringToFront: () => Promise<void>;
  onFocus: () => void;
  onAi: (input: CanvasAiInput) => Promise<void>;
  jobState?: CanvasNodeJobState;
  locked?: boolean;
  onSelectVariant: (mediaId: string) => Promise<void>;
}

/**
 * 节点详情侧抽屉（Inspector）
 * 点击画布节点时浮现，展示素材元数据并提供快捷操作。
 */
export function CanvasInspector({
  item,
  groupName,
  onClose,
  onUpdate,
  onDelete,
  onBringToFront,
  onFocus,
  onAi,
  jobState,
  locked,
  onSelectVariant,
}: CanvasInspectorProps) {
  const [text, setText] = useState(item?.text ?? '');
  const [instruction, setInstruction] = useState('');
  const [voice, setVoice] = useState('');
  const [durationSec, setDurationSec] = useState(5);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const submittingRef = useRef(false);
  const previous = useRef({ id: item?.id, text: item?.text ?? '' });
  useEffect(() => {
    const old = previous.current;
    setText((draft) => old.id !== item?.id || draft === old.text ? item?.text ?? '' : draft);
    if (old.id !== item?.id) { setInstruction(''); setError(''); }
    previous.current = { id: item?.id, text: item?.text ?? '' };
  }, [item?.id, item?.text]);
  if (!item) return null;
  const busy = submitting || Boolean(jobState && isActiveJob(jobState));
  const disabled = busy || locked;
  const perform = async (action: () => Promise<void>) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败，请重试'); }
    finally { submittingRef.current = false; setSubmitting(false); }
  };
  const submit = (operation: CanvasAiInput['operation']) => perform(() => onAi({
    operation, sourceText: text, instruction, voice: voice || undefined,
    durationSec: item.kind === 'video' ? durationSec : undefined,
  }));

  const w = Math.round(item.width || 0);
  const h = Math.round(item.height || 0);

  return (
    <div className="pointer-events-auto absolute right-3 top-3 z-30 max-h-[calc(100%-1.5rem)] w-72 max-w-[calc(100%-1.5rem)] overflow-y-auto rounded-xl border border-[#333b4a] bg-[#12151c]/95 p-3 shadow-2xl backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge tone={item.kind === 'text' ? 'default' : 'pink'}>{CANVAS_ITEM_KIND_LABELS[item.kind]}</Badge>
          {groupName ? <span className="text-[10px] text-pink-300/80">◈ {groupName}</span> : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-1.5 text-slate-500 transition-colors hover:bg-white/10 hover:text-slate-200"
          aria-label="关闭"
        >
          ✕
        </button>
      </div>

      <div className="mb-2">
        <label className="form-label text-[11px]" htmlFor="node-content">{item.kind === 'audio' ? '台词 / 旁白' : item.kind === 'text' ? '节点文字' : '节点提示词 / 描述'}</label>
        <textarea
          id="node-content"
          value={text}
          rows={3}
          onChange={(e) => setText(e.target.value)}
          disabled={disabled}
          className="field w-full resize-none text-xs"
          placeholder="输入内容；AI 操作会包含这里尚未保存的文字"
        />
        {text !== item.text ? <Button size="sm" variant="ghost" disabled={disabled} onClick={() => void perform(() => onUpdate({ text }))}>保存文字</Button> : null}
      </div>

      <section className="mb-3 space-y-2 rounded-lg border border-pink-400/20 p-2" aria-label="AI 优化与生成">
        <h3 className="text-xs text-pink-200">✨ AI 优化 / 生成</h3>
        <label className="form-label text-[11px]" htmlFor="node-ai-instruction">本次输入（可选）</label>
        <textarea id="node-ai-instruction" value={instruction} rows={3} disabled={disabled} maxLength={20000}
          onChange={(e) => setInstruction(e.target.value)} className="field w-full resize-none text-xs"
          placeholder="优化时填写修改要求；生成时填写新内容或提示词。留空使用上方文字。" />
        {item.kind === 'audio' ? <input aria-label="音色 ID" value={voice} disabled={disabled}
          onChange={(e) => setVoice(e.target.value)} className="field w-full text-xs" placeholder="音色 ID（留空使用接口默认）" /> : null}
        {item.kind === 'video' ? <label className="block text-[11px] text-slate-400">视频时长（秒）
          <input aria-label="视频时长" type="number" min={1} max={120} value={durationSec} disabled={disabled}
            onChange={(e) => setDurationSec(Number(e.target.value))} className="field mt-1 w-full text-xs" />
        </label> : null}
        <p className="text-[10px] leading-relaxed text-slate-500">优化结合已有文字和新要求，只修改文字，不替换媒体。生成优先使用本次输入，留空使用上方内容；按节点类型输出。不会自动读取或转写已有媒体。</p>
        <div className="flex gap-2">
          <Button size="sm" disabled={disabled || (!text.trim() && !instruction.trim())} onClick={() => void submit('optimize')}>AI 优化{item.kind === 'text' ? '文字' : item.kind === 'audio' ? '台词' : '提示词'}</Button>
          <Button size="sm" variant="primary" disabled={disabled || (!text.trim() && !instruction.trim())} onClick={() => void submit('generate')}>生成{CANVAS_ITEM_KIND_LABELS[item.kind]}</Button>
        </div>
        {busy ? <p role="status" className="text-[11px] text-sky-300">{submitting ? '正在提交…' : jobState?.label}，可在任务中心查看或取消。</p> : null}
        {jobState?.error ? <p className="text-[11px] text-red-300">{jobState.error}</p> : null}
        {error ? <p role="alert" className="text-[11px] text-red-300">{error}</p> : null}
      </section>

      {/* ⑨ 资产节点角色 */}
      {item.role && item.role !== 'plain' ? (
        <div className="mb-2">
          <Badge tone="blue">{CANVAS_NODE_ROLE_LABELS[item.role]}</Badge>
          {item.refId ? <span className="ml-2 text-[10px] text-slate-500">已关联剧本实体</span> : null}
        </div>
      ) : null}

      {/* ① 抽卡记录缩略 */}
      {(item.variants?.length ?? 0) > 0 ? (
        <div className="mb-2">
          <label className="form-label text-[11px]">抽卡记录（{item.variants!.length}）</label>
          <div className="flex flex-wrap gap-1">
            {item.variants!.slice(-24).map((variant) => (
              <button key={variant.mediaId} type="button" disabled={disabled} title={variant.prompt ?? '恢复历史结果'}
                aria-label={`恢复历史结果：${variant.prompt ?? variant.mediaId}`}
                onClick={() => void perform(() => onSelectVariant(variant.mediaId))}
                className="overflow-hidden rounded border border-[#333b4a] disabled:opacity-50">
                {item.kind === 'image' ? <img src={variant.url} alt={variant.prompt ?? '抽卡记录'} className="size-12 object-cover" />
                  : <span className="block max-w-28 truncate p-2 text-[10px] text-slate-300">{item.kind === 'video' ? '视频' : '语音'} · {variant.prompt || '历史结果'}</span>}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {item.url ? (
        <div className="mb-2">
          <label className="form-label text-[11px]">媒体地址</label>
          <div className="truncate rounded bg-[#0e1116] px-2 py-1 text-[10px] text-slate-500" title={item.url}>
            {item.url}
          </div>
        </div>
      ) : null}

      <div className="mb-3 grid grid-cols-2 gap-2 text-[11px] text-slate-400">
        <div>位置：<span className="text-slate-200">{Math.round(item.x)}, {Math.round(item.y)}</span></div>
        <div>尺寸：<span className="text-slate-200">{w}×{h}</span></div>
        <div>层级：<span className="text-slate-200">{item.z}</span></div>
        <div>分组：<span className="text-slate-200">{groupName ? '有' : '无'}</span></div>
      </div>

      <p className="mb-3 text-[10px] text-slate-500">拖拽节点四角或边框调整大小，松手自动保存。</p>

      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="default" onClick={() => void onBringToFront()}>
          ⬆ 置顶
        </Button>
        <Button size="sm" variant="ghost" onClick={onFocus}>
          🎯 定位
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={() => void onDelete()}
        >
          🗑 删除
        </Button>
      </div>
    </div>
  );
}
