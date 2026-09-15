'use client';

import { useCallback, useState } from 'react';
import { Background, Controls, ReactFlow, ReactFlowProvider, type Node } from '@xyflow/react';
import { NodeResizer } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import clsx from 'clsx';
import { Empty, Badge } from '@/components/ui';
import type { StudioData } from './types';
import {
  createCanvasItemAction,
  updateCanvasItemAction,
  deleteCanvasItemAction,
  bringCanvasItemToFrontAction,
} from '@/app/actions/canvas';
import type { CanvasItem } from '@sakura/core';
import { CANVAS_ITEM_KIND_LABELS } from '@sakura/core';

interface CanvasItemNodeData {
  item: CanvasItem;
  onUpdate: (patch: Partial<CanvasItem>) => Promise<void>;
  onDelete: () => Promise<void>;
  onBringToFront: () => Promise<void>;
  isSelected: boolean;
}

function CanvasItemNode({ data }: { data: CanvasItemNodeData }) {
  const { item, onUpdate, onDelete, onBringToFront, isSelected } = data;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);

  const handleSaveText = async () => {
    if (text !== item.text) {
      await onUpdate({ text });
    }
    setEditing(false);
  };

  const handleRightClick = (e: React.MouseEvent) => {
    e.preventDefault();
    const menu = document.createElement('div');
    menu.className = 'fixed bg-[#1a1f2e] border border-[#333b4a] rounded-lg shadow-xl z-50 py-1 text-xs';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;

    const options = [
      { label: '编辑', action: () => item.kind === 'text' && setEditing(true), hide: item.kind !== 'text' },
      { label: '置顶', action: onBringToFront },
      { label: '删除', action: onDelete, danger: true },
    ];

    options.forEach(({ label, action, danger, hide }: any) => {
      if (hide) return;
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.className = clsx(
        'w-full text-left px-3 py-1.5 hover:bg-white/5 transition-colors',
        danger && 'text-red-300 hover:bg-red-500/10',
      );
      btn.onclick = async () => {
        await action();
        menu.remove();
      };
      menu.appendChild(btn);
    });

    document.body.appendChild(menu);
    setTimeout(() => {
      document.addEventListener('click', () => menu.remove(), { once: true });
    }, 0);
  };

  return (
    <div
      className={clsx(
        'relative rounded-lg border bg-[#12151c] p-2 shadow-md transition-all h-full w-full overflow-hidden',
        isSelected ? 'ring-2 ring-pink-400/70 border-pink-400/60' : 'border-[#333b4a]',
      )}
      onContextMenu={handleRightClick}
      onDoubleClick={() => item.kind === 'text' && setEditing(true)}
    >
      <NodeResizer minWidth={80} minHeight={60} />
      <div className="mb-1 flex items-center justify-between gap-1.5 pointer-events-none">
        <Badge tone={item.kind === 'text' ? 'default' : 'pink'}>{CANVAS_ITEM_KIND_LABELS[item.kind]}</Badge>
      </div>
      {editing ? (
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={handleSaveText}
          className="w-full h-[calc(100%-24px)] text-xs bg-[#0e1116] border border-pink-400/40 rounded px-1.5 py-1 text-slate-200 resize-none"
        />
      ) : item.kind === 'text' ? (
        <div className="text-xs text-slate-300 whitespace-pre-wrap break-words overflow-hidden leading-relaxed">
          {item.text || '（空）'}
        </div>
      ) : item.kind === 'image' && item.url ? (
        <img src={item.url} alt={item.text} className="w-full h-auto rounded object-cover" />
      ) : item.kind === 'video' && item.url ? (
        <video src={item.url} className="w-full h-auto rounded object-cover" />
      ) : item.kind === 'audio' && item.url ? (
        <audio src={item.url} controls className="w-full text-xs" />
      ) : (
        <div className="text-[11px] text-slate-500">{item.text}</div>
      )}
    </div>
  );
}



function CanvasInner({ data, projectId }: { data: StudioData; projectId: string }) {
  const [items, setItems] = useState<CanvasItem[]>(data.canvasItems);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const nodes: Node[] = items.map((item) => ({
    id: item.id,
    data: {
      item,
      onUpdate: async (patch: Partial<CanvasItem>) => {
        setLoading(true);
        try {
          const result = await updateCanvasItemAction(item.id, patch);
          if (result.ok && result.data) {
            setItems((prev) => prev.map((it) => (it.id === item.id ? result.data! : it)));
          }
        } finally {
          setLoading(false);
        }
      },
      onDelete: async () => {
        setLoading(true);
        try {
          const result = await deleteCanvasItemAction(item.id);
          if (result.ok) {
            setItems((prev) => prev.filter((it) => it.id !== item.id));
          }
        } finally {
          setLoading(false);
        }
      },
      onBringToFront: async () => {
        setLoading(true);
        try {
          const result = await bringCanvasItemToFrontAction(item.id);
          if (result.ok && result.data) {
            setItems((prev) => prev.map((it) => (it.id === item.id ? result.data! : it)).sort((a, b) => a.z - b.z));
          }
        } finally {
          setLoading(false);
        }
      },
      isSelected: selectedId === item.id,
    } as Record<string, unknown>,
    position: { x: item.x, y: item.y },
    style: { width: Math.max(80, item.width || 200), height: Math.max(60, item.height || 120), zIndex: item.z },
    draggable: true,
    resizable: true,
    type: 'default',
  })) as Node[];

  const handlePaneDoubleClick = useCallback(
    async (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setLoading(true);
      try {
        const result = await createCanvasItemAction(projectId, {
          kind: 'text',
          text: '新文字',
          x,
          y,
          width: 200,
          height: 100,
          z: Math.max(0, ...items.map((it) => it.z)) + 1,
        });
        if (result.ok && result.data) {
          setItems((prev) => [...prev, result.data!]);
        }
      } finally {
        setLoading(false);
      }
    },
    [projectId, items],
  );

  return (
    <div className="relative size-full bg-[#0e1116]" onDoubleClick={handlePaneDoubleClick}>
      <ReactFlow
        nodes={nodes}
        edges={[]}
        fitView={false}
        minZoom={0.1}
        maxZoom={3}
        deleteKeyCode={['Backspace', 'Delete']}
        nodeTypes={{ default: CanvasItemNode as any }}
        onSelectionChange={(selection) => {
          setSelectedId(selection.nodes.length > 0 ? selection.nodes[0]!.id : null);
        }}
      >
        <Background gap={20} color="#1f252f" size={1} />
        <Controls className="!bg-[#12151c] !text-slate-300" showInteractive={false} />
      </ReactFlow>
      {items.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Empty text="无限画布为空。双击添加文字便签。" />
        </div>
      )}
    </div>
  );
}

export function StudioCanvasBoard({ data }: { data: StudioData }) {
  return (
    <ReactFlowProvider>
      <CanvasInner data={data} projectId={data.project.id} />
    </ReactFlowProvider>
  );
}
