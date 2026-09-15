'use client';

import { useCallback, useState } from 'react';
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  type Node,
  type NodeChange,
} from '@xyflow/react';
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

type CanvasItemKind = 'text' | 'image' | 'video' | 'audio';

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
    if (text !== item.text) await onUpdate({ text });
    setEditing(false);
  };

  const handleRightClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const menu = document.createElement('div');
    menu.className = 'fixed bg-[#1a1f2e] border border-[#333b4a] rounded-lg z-50 py-1 text-xs';
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
        'w-full text-left px-3 py-1.5 hover:bg-white/5',
        danger && 'text-red-300 hover:bg-red-500/10',
      );
      btn.onclick = async (ev: any) => {
        ev.stopPropagation();
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
        'relative rounded-lg border bg-[#12151c] p-2 shadow-md h-full w-full',
        isSelected ? 'ring-2 ring-pink-400/70' : 'border-[#333b4a]',
      )}
      onContextMenu={handleRightClick}
      onDoubleClick={() => item.kind === 'text' && setEditing(true)}
    >
      <NodeResizer minWidth={80} minHeight={60} />
      <div className="mb-1 flex items-center gap-1.5 pointer-events-none">
        <Badge tone={item.kind === 'text' ? 'default' : 'pink'}>{CANVAS_ITEM_KIND_LABELS[item.kind]}</Badge>
      </div>
      {editing ? (
        <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} onBlur={handleSaveText} className="w-full h-[calc(100%-24px)] text-xs bg-[#0e1116] border border-pink-400/40 rounded px-1 py-0.5 resize-none" />
      ) : item.kind === 'text' ? (
        <div className="text-xs text-slate-300 whitespace-pre-wrap break-words overflow-hidden">{item.text || '（空）'}</div>
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

  const nodes: Node[] = items.map((item) => ({
    id: item.id,
    data: {
      item,
      onUpdate: async (patch: Partial<CanvasItem>) => {
        const result = await updateCanvasItemAction(item.id, patch);
        if (result.ok && result.data) setItems((prev) => prev.map((it) => (it.id === item.id ? result.data! : it)));
      },
      onDelete: async () => {
        const result = await deleteCanvasItemAction(item.id);
        if (result.ok) setItems((prev) => prev.filter((it) => it.id !== item.id));
      },
      onBringToFront: async () => {
        const result = await bringCanvasItemToFrontAction(item.id);
        if (result.ok && result.data) setItems((prev) => prev.map((it) => (it.id === item.id ? result.data! : it)).sort((a, b) => a.z - b.z));
      },
      isSelected: selectedId === item.id,
    } as Record<string, unknown>,
    position: { x: item.x, y: item.y },
    style: { width: Math.max(80, item.width || 200), height: Math.max(60, item.height || 120), zIndex: item.z },
    draggable: true,
    resizable: true,
    type: 'default',
  })) as Node[];

  // 乐观更新：立即显示，后台同步
  const createItem = useCallback((kind: CanvasItemKind, x: number, y: number) => {
    const id = `cv_${Math.random().toString(36).slice(2, 14)}`;
    const newItem: CanvasItem = {
      id, projectId, kind, text: kind === 'text' ? '新文字' : '新素材',
      x, y, z: Math.max(0, ...items.map((it) => it.z)) + 1,
      width: kind === 'image' ? 300 : kind === 'video' ? 400 : 200,
      height: kind === 'image' ? 300 : kind === 'video' ? 300 : kind === 'audio' ? 60 : 100,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setItems((prev) => [...prev, newItem]);
    createCanvasItemAction(projectId, { kind, text: newItem.text, x, y, width: newItem.width, height: newItem.height, z: newItem.z })
      .then((result) => {
        if (result.ok && result.data) setItems((prev) => prev.map((it) => (it.id === id ? result.data! : it)));
      })
      .catch(() => { setItems((prev) => prev.filter((it) => it.id !== id)); });
  }, [projectId, items]);

  const handlePaneDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    createItem('text', e.clientX - rect.left, e.clientY - rect.top);
  }, [createItem]);

  const handlePaneRightClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const menu = document.createElement('div');
    menu.className = 'fixed bg-[#1a1f2e] border border-[#333b4a] rounded-lg z-50 py-1 text-xs';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
    const options: Array<{ label: string; icon: string; kind: CanvasItemKind }> = [
      { label: '文字', icon: '📝', kind: 'text' },
      { label: '图片', icon: '🖼️', kind: 'image' },
      { label: '视频', icon: '🎬', kind: 'video' },
      { label: '语音', icon: '🎵', kind: 'audio' },
    ];
    options.forEach(({ label, icon, kind }) => {
      const btn = document.createElement('button');
      btn.textContent = `${icon} ${label}`;
      btn.className = 'w-full text-left px-3 py-1.5 hover:bg-white/5';
      btn.onclick = (ev: any) => { ev.stopPropagation(); createItem(kind, x, y); menu.remove(); };
      menu.appendChild(btn);
    });
    document.body.appendChild(menu);
    setTimeout(() => {
      document.addEventListener('click', () => menu.remove(), { once: true });
    }, 0);
  }, [createItem]);

  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    for (const change of changes) {
      if (change.type === 'remove') {
        const nodeId = change.id;
        setItems((prev) => prev.filter((it) => it.id !== nodeId));
        deleteCanvasItemAction(nodeId).catch(console.error);
      }
    }
  }, []);

  return (
    <div className="relative size-full bg-[#0e1116]" onDoubleClick={handlePaneDoubleClick} onContextMenu={handlePaneRightClick}>
      <ReactFlow 
        nodes={nodes} 
        edges={[]} 
        fitView={false} 
        minZoom={0.1} 
        maxZoom={3} 
        deleteKeyCode={['Backspace', 'Delete']} 
        nodeTypes={{ default: CanvasItemNode as any }} 
        onSelectionChange={(selection) => { setSelectedId(selection.nodes.length > 0 ? selection.nodes[0]!.id : null); }} 
        onNodesChange={handleNodesChange}
        onNodeDragStop={(_, node) => { updateCanvasItemAction(node.id, { x: node.position.x, y: node.position.y }).catch(console.error); }}
      >
        <Background gap={20} color="#1f252f" size={1} />
        <Controls className="!bg-[#12151c] !text-slate-300" showInteractive={false} />
      </ReactFlow>
      {items.length === 0 && (<div className="absolute inset-0 flex items-center justify-center pointer-events-none"><Empty text="无限画布为空。双击或右键添加素材。" /></div>)}
    </div>
  );
}

export function StudioCanvasBoard({ data }: { data: StudioData }) {
  return (<ReactFlowProvider><CanvasInner data={data} projectId={data.project.id} /></ReactFlowProvider>);
}
