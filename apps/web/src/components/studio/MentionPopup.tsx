'use client';

import { useEffect, useRef, useState } from 'react';
import type { Asset, Screenplay } from '@sakura/core';

/**
 * ② @ 素材引用（对齐小云雀抽卡记录旁的 @ 引用能力）
 *
 * 在文本类节点里输入 @ 时弹出候选浮层：项目资产 / 剧本人物 / 场景 / 道具。
 * 选中后把「@名称」插入文本，并返回被引用实体，供调用方做联动（如高亮、批量替换提示词）。
 */

export interface Mentionable {
  id: string;
  name: string;
  kind: 'asset' | 'character' | 'location' | 'prop';
  url?: string | null;
}

interface MentionPopupProps {
  query: string;
  items: Mentionable[];
  onSelect: (item: Mentionable) => void;
  onClose: () => void;
  /** 浮层锚点（屏幕坐标） */
  anchor: { x: number; y: number };
}

const KIND_ICONS: Record<Mentionable['kind'], string> = {
  asset: '🖼️',
  character: '👤',
  location: '🏞️',
  prop: '📦',
};

export function MentionPopup({ query, items, onSelect, onClose, anchor }: MentionPopupProps) {
  const filtered = items
    .filter((item) => item.name.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 8);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', handler);
    return () => window.removeEventListener('pointerdown', handler);
  }, [onClose]);

  if (filtered.length === 0) {
    return (
      <div
        ref={ref}
        className="fixed z-50 min-w-[180px] rounded-lg border border-[#333b4a] bg-[#1a1f2e] p-2 text-[11px] text-slate-500 shadow-xl shadow-black/50"
        style={{ left: anchor.x, top: anchor.y }}
      >
        没有匹配「{query}」的素材
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[180px] overflow-hidden rounded-lg border border-[#333b4a] bg-[#1a1f2e] py-1 text-xs shadow-xl shadow-black/50"
      style={{ left: anchor.x, top: anchor.y }}
    >
      {filtered.map((item) => (
        <button
          key={`${item.kind}:${item.id}`}
          type="button"
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-slate-200 transition-colors hover:bg-white/5"
          onClick={() => onSelect(item)}
        >
          <span>{KIND_ICONS[item.kind]}</span>
          <span className="truncate">{item.name}</span>
          {item.url ? (
            <img src={item.url} alt="" className="ml-auto size-6 rounded object-cover" />
          ) : null}
        </button>
      ))}
    </div>
  );
}

/** 从项目数据构造 @ 候选列表 */
export function buildMentionables(input: {
  assets: Asset[];
  media: Record<string, { url?: string }>;
  screenplay: Screenplay | null;
}): Mentionable[] {
  const items: Mentionable[] = [];
  for (const asset of input.assets) {
    const coverId = asset.mediaIds[0];
    items.push({
      id: asset.id,
      name: asset.name,
      kind: 'asset',
      url: coverId ? input.media[coverId]?.url : undefined,
    });
  }
  if (input.screenplay) {
    for (const character of input.screenplay.characters) {
      items.push({ id: character.id, name: character.name, kind: 'character' });
    }
    for (const location of input.screenplay.locations) {
      items.push({ id: location.id, name: location.name, kind: 'location' });
    }
    for (const prop of input.screenplay.props) {
      items.push({ id: prop.id, name: prop.name, kind: 'prop' });
    }
  }
  return items;
}

/**
 * 监听文本输入中的 @ 触发：
 * 返回当前 @ 查询（null 表示未激活）与锚点坐标。
 */
export function useMentionTrigger(
  text: string,
  caret: number,
): { query: string | null; anchor: { x: number; y: number } | null } {
  const [state, setState] = useState<{ query: string | null; anchor: { x: number; y: number } | null }>(
    { query: null, anchor: null },
  );

  useEffect(() => {
    const before = text.slice(0, caret);
    const atMatch = before.match(/@([^\s@]{0,20})$/);
    if (!atMatch) {
      setState({ query: null, anchor: null });
      return;
    }
    // 简单锚点：无法精确拿到 textarea 光标坐标时，用固定偏移
    setState({ query: atMatch[1] ?? '', anchor: null });
  }, [text, caret]);

  return state;
}
