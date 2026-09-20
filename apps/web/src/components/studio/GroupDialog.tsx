'use client';

import { useState } from 'react';

/**
 * ⑤ 打组底色命名：成组时选择名称与底色（场景卡片配色）
 */

export const GROUP_PALETTE = [
  '#f472b6', // 粉
  '#38bdf8', // 蓝
  '#a3e635', // 绿
  '#fbbf24', // 黄
  '#c084fc', // 紫
  '#fb7185', // 红
  '#2dd4bf', // 青
  '#94a3b8', // 灰
];

interface GroupDialogProps {
  open: boolean;
  defaultName?: string;
  onConfirm: (name: string, color: string) => void;
  onCancel: () => void;
}

export function GroupDialog({ open, defaultName, onConfirm, onCancel }: GroupDialogProps) {
  const [name, setName] = useState(defaultName ?? '');
  const [color, setColor] = useState(GROUP_PALETTE[0]!);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={() => onCancel()}
    >
      <div
        className="w-80 rounded-xl border border-[#333b4a] bg-[#12151c] p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 text-sm font-medium text-slate-200">场景成组</div>
        <div className="mb-3">
          <label className="form-label text-[11px]">场景名称</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：天台告白戏"
            className="field w-full text-xs"
          />
        </div>
        <div className="mb-4">
          <label className="form-label text-[11px]">底色</label>
          <div className="flex flex-wrap gap-1.5">
            {GROUP_PALETTE.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setColor(item)}
                className="size-7 rounded-md border-2 transition-transform hover:scale-110"
                style={{
                  backgroundColor: item,
                  borderColor: color === item ? '#ffffff' : 'transparent',
                }}
                aria-label={`底色 ${item}`}
              />
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onCancel()}
            className="rounded-lg px-3 py-1.5 text-xs text-slate-400 transition-colors hover:bg-white/5"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => onConfirm(name.trim() || '未命名场景', color)}
            className="rounded-lg bg-pink-500/90 px-3 py-1.5 text-xs text-white transition-colors hover:bg-pink-500"
          >
            成组
          </button>
        </div>
      </div>
    </div>
  );
}
