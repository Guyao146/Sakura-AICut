'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  useEdgesState,
  useNodesState,
  useReactFlow,
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
}

function CanvasItemNode({ data, selected }: { data: CanvasItemNodeData; selected?: boolean }) {
  const { item, onUpdate, onDelete, onBringToFront } = data;
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
        selected ? 'ring-2 ring-pink-400/70' : 'border-[#333b4a]',
      )}
      onContextMenu={handleRightClick}
      onDoubleClick={(e) => {
        // 双击节点本身才编辑文字，阻止冒泡到画布避免误创建节点
        e.stopPropagation();
        if (item.kind === 'text') setEditing(true);
      }}
    >
      <Handle type="target" position={Position.Left} className="!w-2.5 !h-2.5 !bg-pink-400 !border-none !opacity-60 hover:!opacity-100" />
      <Handle type="source" position={Position.Right} className="!w-2.5 !h-2.5 !bg-pink-400 !border-none !opacity-60 hover:!opacity-100" />
      <NodeResizer minWidth={80} minHeight={60} isVisible={selected} />
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



// 稳定的类型映射：放在组件外部，避免每次渲染重建导致节点闪烁/卡顿
const NODE_TYPES = { default: CanvasItemNode as any };
const EDGE_TYPES = { default: undefined as any };

function CanvasInner({ data, projectId }: { data: StudioData; projectId: string }) {
  const [items, setItems] = useState<CanvasItem[]>(data.canvasItems);
  const { screenToFlowPosition, fitView } = useReactFlow();

  const buildNodes = useCallback(
    (): Node[] =>
      items.map((item) => ({
        id: item.id,
        data: {
          item,
          onUpdate: async (patch: Partial<CanvasItem>) => {
            const result = await updateCanvasItemAction(item.id, patch);
            if (result.ok && result.data) setItems((prev) => prev.map((it) => (it.id === item.id ? result.data! : it)));
          },
          onDelete: async () => {
            const result = await deleteCanvasItemAction(item.id);
            if (result.ok) {
              setItems((prev) => prev.filter((it) => it.id !== item.id));
              setRfNodes((prev) => prev.filter((n) => n.id !== item.id));
            }
          },
          onBringToFront: async () => {
            const result = await bringCanvasItemToFrontAction(item.id);
            if (result.ok && result.data) setItems((prev) => prev.map((it) => (it.id === item.id ? result.data! : it)).sort((a, b) => a.z - b.z));
          },
        } as Record<string, unknown>,
        position: { x: item.x, y: item.y },
        style: { width: Math.max(80, item.width || 200), height: Math.max(60, item.height || 120), zIndex: item.z },
        draggable: true,
        type: 'default',
      })) as Node[],
    [items],
  );

  // 关键：nodes 由 ReactFlow 自管状态，拖动时实时更新位置，不会被 items 旧值覆盖
  const [rfNodes, setRfNodes, onRfNodesChange] = useNodesState(buildNodes());
  const [rfEdges, setRfEdges, onRfEdgesChange] = useEdgesState<Edge>([]);

  // 仅在节点数量变化（新建/删除）时重建，拖动中的位置由 ReactFlow 内部维护
  useEffect(() => {
    setRfNodes(buildNodes());
  }, [items.length, setRfNodes, buildNodes]);

  // 拖入连线
  const onConnect = useCallback(
    (connection: Connection) =>
      setRfEdges((eds) => addEdge({ ...connection, animated: true, style: { stroke: '#f472b6', strokeWidth: 2 } } as Edge, eds)),
    [setRfEdges],
  );

  // 乐观更新：立即显示，后台同步
  const createItem = useCallback(
    (kind: CanvasItemKind, x: number, y: number, init?: { url?: string; text?: string }) => {
      const id = `cv_${Math.random().toString(36).slice(2, 14)}`;
      const label = init?.text || (kind === 'text' ? '新文本' : '新素材');
      const newItem: CanvasItem = {
        id, projectId, kind, text: label, url: init?.url || '',
        x, y, z: Math.max(0, ...items.map((it) => it.z)) + 1,
        width: kind === 'image' ? 300 : kind === 'video' ? 400 : 200,
        height: kind === 'image' ? 300 : kind === 'video' ? 300 : kind === 'audio' ? 60 : 100,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setItems((prev) => [...prev, newItem]);
      createCanvasItemAction(projectId, { kind, text: newItem.text, url: newItem.url, x, y, width: newItem.width, height: newItem.height, z: newItem.z })
        .then((result) => {
          if (result.ok && result.data) setItems((prev) => prev.map((it) => (it.id === id ? result.data! : it)));
        })
        .catch(() => { setItems((prev) => prev.filter((it) => it.id !== id)); });
    },
    [projectId, items],
  );

  const handlePaneDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // 用 screenToFlowPosition 适配画布缩放/平移，否则缩放后创建位置偏移
    const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    createItem('text', pos.x - 100, pos.y - 50);
  }, [createItem, screenToFlowPosition]);

  // 从媒体库/本地文件拖入画布
  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const payload = e.dataTransfer.getData('application/json');
      if (!payload) return;
      try {
        const media = JSON.parse(payload) as { kind: string; url: string; name?: string };
        const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        const kind: CanvasItemKind = media.kind === 'video' ? 'video' : media.kind === 'audio' ? 'audio' : 'image';
        createItem(kind, pos.x - 150, pos.y - 100, { url: media.url, text: media.name ?? '' });
      } catch {
        /* 非法拖入数据忽略 */
      }
    },
    [createItem, screenToFlowPosition],
  );

  const handlePaneRightClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const x = pos.x, y = pos.y;
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
  }, [createItem, screenToFlowPosition]);

  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    // 委托给 ReactFlow 内置处理器：拖动中实时更新位置、处理删除、尺寸变化
    onRfNodesChange(changes);
    for (const change of changes) {
      if (change.type === 'remove') {
        const nodeId = change.id;
        setItems((prev) => prev.filter((it) => it.id !== nodeId));
        deleteCanvasItemAction(nodeId).catch(console.error);
      } else if (change.type === 'dimensions' && change.dimensions && change.resizing === false) {
        // 缩放结束时同步尺寸到本地状态与数据库
        const nodeId = change.id;
        const w = Math.max(80, change.dimensions.width);
        const h = Math.max(60, change.dimensions.height);
        setItems((prev) => prev.map((it) => (it.id === nodeId ? { ...it, width: w, height: h } : it)));
        updateCanvasItemAction(nodeId, { width: w, height: h }).catch(console.error);
      }
    }
  }, [onRfNodesChange]);

  return (
    <div
      className="relative size-full bg-[#0e1116]"
      onDoubleClick={handlePaneDoubleClick}
      onContextMenu={handlePaneRightClick}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        fitView={false}
        minZoom={0.1}
        maxZoom={3}
        snapToGrid
        snapGrid={[16, 16]}
        deleteKeyCode={['Backspace', 'Delete']}
        multiSelectionKeyCode={['Meta', 'Control']}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodesChange={handleNodesChange}
        onEdgesChange={onRfEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={(_, node) => {
          setItems((prev) => prev.map((it) => (it.id === node.id ? { ...it, x: node.position.x, y: node.position.y } : it)));
          updateCanvasItemAction(node.id, { x: node.position.x, y: node.position.y }).catch(console.error);
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} color="#1f252f" size={1} />
        <Controls className="!bg-[#12151c] !text-slate-300" showInteractive={false} />
        <MiniMap
          className="!bg-[#12151c]"
          maskColor="rgba(10,12,18,0.7)"
          nodeColor={(n) => ((n.data as any)?.item?.kind === 'video' ? '#f472b6' : '#3b4356')}
          pannable
          zoomable
        />
      </ReactFlow>
      {items.length === 0 && (<div className="absolute inset-0 flex items-center justify-center pointer-events-none"><Empty text="无限画布为空。双击或右键添加素材。" /></div>)}
    </div>
  );
}

export function StudioCanvasBoard({ data }: { data: StudioData }) {
  return (<ReactFlowProvider><CanvasInner data={data} projectId={data.project.id} /></ReactFlowProvider>);
}
