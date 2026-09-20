'use client';

import clsx from 'clsx';
import { Badge, Button } from '@/components/ui';
import type { CanvasItem } from '@sakura/core';
import { CANVAS_ITEM_KIND_LABELS, CANVAS_NODE_ROLE_LABELS } from '@sakura/core';

interface CanvasInspectorProps {
  item: CanvasItem | null;
  groupName?: string | null;
  onClose: () => void;
  onUpdate: (patch: Partial<CanvasItem>) => Promise<void>;
  onDelete: () => Promise<void>;
  onBringToFront: () => Promise<void>;
  onFocus: () => void;
}

/**
 * 节点详情侧抽屉（libTV / 小云雀式 Inspector）
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
}: CanvasInspectorProps) {
  if (!item) return null;

  const w = Math.round(item.width || 0);
  const h = Math.round(item.height || 0);

  return (
    <div className="pointer-events-auto absolute right-3 top-3 z-30 w-64 rounded-xl border border-[#333b4a] bg-[#12151c]/95 p-3 shadow-2xl backdrop-blur">
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
        <label className="form-label text-[11px]">文本 / 标题</label>
        <textarea
          defaultValue={item.text}
          key={item.id}
          rows={3}
          onBlur={(e) => {
            if (e.target.value !== item.text) void onUpdate({ text: e.target.value });
          }}
          className="field w-full resize-none text-xs"
          placeholder="输入文本内容，可输入 @ 引用素材…"
        />
      </div>

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
            {item.variants!.slice(-6).map((variant) => (
              <img
                key={variant.mediaId}
                src={variant.url}
                alt={variant.prompt ?? '抽卡记录'}
                title={variant.prompt ?? ''}
                className="size-12 rounded border border-[#333b4a] object-cover"
              />
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
