'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  createCanvasEdgeAction,
  deleteCanvasEdgeAction,
  groupItemsAction,
  ungroupItemsAction,
  autoLayoutCanvasAction,
  applyCanvasTemplateAction,
  importShotsToCanvasAction,
  importCanvasJsonAction,
  generateCanvasItemsAction,
} from '@/app/actions/canvas';
import { CanvasInspector } from './CanvasInspector';
import type { CanvasItem, CanvasGroup } from '@sakura/core';
import { CANVAS_ITEM_KIND_LABELS, CANVAS_TEMPLATES } from '@sakura/core';

type CanvasItemKind = 'text' | 'image' | 'video' | 'audio';

interface CanvasItemNodeData {
  item: CanvasItem;
  groupId?: string | null;
  onUpdate: (patch: Partial<CanvasItem>) => Promise<void>;
  onDelete: () => Promise<void>;
  onBringToFront: () => Promise<void>;
  onGenerate?: (itemIds: string[]) => void;
  onGroup?: () => void;
  onUngroup?: () => void;
}

function CanvasItemNode({ data, selected }: { data: CanvasItemNodeData; selected?: boolean }) {
  const { item, groupId, onUpdate, onDelete, onBringToFront, onGenerate, onGroup, onUngroup } = data;
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
      { label: '✨ 生成图片', action: () => onGenerate?.([item.id]), hide: !item.text.trim() || !onGenerate },
      { label: '置顶', action: onBringToFront },
      { label: groupId ? '解组' : '成组（需多选）', action: groupId ? () => onUngroup?.() : () => onGroup?.(), hide: !groupId && !onGroup },
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
        {groupId ? <span className="text-[10px] text-pink-300/80">◈ 已分组</span> : null}
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



/** 分组背景节点：场景卡片，垫在素材下方 */
function GroupNode({ data }: { data: { item: CanvasItem; groupColor?: string } }) {
  const { item, groupColor } = data;
  return (
    <div
      className="relative rounded-2xl border-2 border-dashed h-full w-full p-3"
      style={{ borderColor: (groupColor ?? '#f472b6') + '55', backgroundColor: (groupColor ?? '#f472b6') + '0d' }}
    >
      <div
        className="absolute -top-3 left-4 rounded-full px-3 py-0.5 text-[11px] font-medium text-white"
        style={{ backgroundColor: groupColor ?? '#f472b6' }}
      >
        🎬 {item.text}
      </div>
    </div>
  );
}

// 稳定的类型映射：放在组件外部，避免每次渲染重建导致节点闪烁/卡顿
const NODE_TYPES = { default: CanvasItemNode as any, group: GroupNode as any };
const EDGE_TYPES = { default: undefined as any };

function CanvasInner({ data, projectId }: { data: StudioData; projectId: string }) {
  const [items, setItems] = useState<CanvasItem[]>(data.canvasItems);
  const [groups, setGroups] = useState<CanvasGroup[]>(data.canvasGroups);
  const [itemGroups, setItemGroups] = useState<Record<string, string>>(data.itemGroups);
  const { screenToFlowPosition, fitView, setCenter } = useReactFlow();

  // 服务端数据变化时（如 worker 生成完成后 router.refresh()）合并内容字段：
  // kind/url/mediaId/text 跟随服务端，坐标/尺寸保留本地值，避免和拖动状态打架。
  useEffect(() => {
    const serverById = new Map(data.canvasItems.map((it) => [it.id, it]));
    setItems((prev) => {
      let changed = false;
      const next = prev.map((local) => {
        const remote = serverById.get(local.id);
        if (!remote) return local;
        if (
          remote.kind === local.kind &&
          remote.url === local.url &&
          remote.mediaId === local.mediaId &&
          remote.text === local.text
        ) {
          return local;
        }
        changed = true;
        return { ...local, kind: remote.kind, url: remote.url, mediaId: remote.mediaId, text: remote.text };
      });
      // 服务端新增的节点（如导入布局）直接追加
      const added = data.canvasItems.filter((it) => !prev.some((p) => p.id === it.id));
      if (!changed && added.length === 0) return prev;
      return added.length > 0 ? [...next, ...added] : next;
    });
  }, [data.canvasItems]);

  /* ------------------------------ 画布内 AI 生成 ------------------------------ */

  // 生成中标记，用于禁用按钮 & 节点显示"生成中"
  const [generating, setGenerating] = useState(false);

  const handleGenerateImages = useCallback(
    async (itemIds: string[]) => {
      if (itemIds.length === 0) return;
      setGenerating(true);
      try {
        const result = await generateCanvasItemsAction(projectId, itemIds);
        if (!result.ok) {
          alert(result.error ?? '提交生成失败');
        }
      } finally {
        setGenerating(false);
      }
    },
    [projectId],
  );

  const buildNodes = useCallback(
    (): Node[] =>
      items.map((item) => ({
        id: item.id,
        data: {
          item,
          groupId: itemGroups[item.id] ?? null,
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
          onGenerate: (ids: string[]) => void handleGenerateImages(ids),
          onGroup: () => setSelectedIds((prev) => (prev.includes(item.id) ? prev : [...prev, item.id])),
          onUngroup: async () => {
            const gid = itemGroups[item.id];
            if (!gid) return;
            await ungroupItemsAction(projectId, gid);
            setGroups((prev) => prev.filter((g) => g.id !== gid));
            setItemGroups((prev) => {
              const next = { ...prev };
              delete next[item.id];
              return next;
            });
          },
        } as Record<string, unknown>,
        position: { x: item.x, y: item.y },
        style: { width: Math.max(80, item.width || 200), height: Math.max(60, item.height || 120), zIndex: item.z },
        draggable: true,
        type: 'default',
      })) as Node[],
    [items, itemGroups, handleGenerateImages],
  );

  // 关键：nodes 由 ReactFlow 自管状态，拖动时实时更新位置，不会被 items 旧值覆盖
  const [rfNodes, setRfNodes, onRfNodesChange] = useNodesState(buildNodes());
  const [rfEdges, setRfEdges, onRfEdgesChange] = useEdgesState<Edge>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // 从数据库初始连线
  useEffect(() => {
    setRfEdges(
      data.canvasEdges.map((edge) => ({
        id: edge.id,
        source: edge.sourceId,
        target: edge.targetId,
        animated: true,
        style: { stroke: '#f472b6', strokeWidth: 2 },
        label: edge.label || undefined,
      })),
    );
  }, [data.canvasEdges, setRfEdges]);

  // 分组背景节点（垫在素材下方）
  const groupNodes: Node[] = groups.map((group) => ({
    id: group.id,
    data: {
      item: {
        id: group.id,
        projectId,
        kind: 'text',
        text: group.name,
        x: group.x,
        y: group.y,
        width: group.width,
        height: group.height,
        z: group.z,
      } as CanvasItem,
      isGroup: true,
      groupColor: group.color,
    },
    position: { x: group.x, y: group.y },
    style: { width: group.width, height: group.height, zIndex: group.z },
    draggable: false,
    selectable: false,
    type: 'group',
  }));

  const allNodes = [...groupNodes, ...rfNodes];

  // 节点数量或内容变化（新建/删除/生成完成）时重建，拖动中的位置由 ReactFlow 内部维护
  const itemContentKey = items
    .map((it) => `${it.id}:${it.kind}:${it.url ?? ''}:${it.mediaId ?? ''}:${it.text.slice(0, 40)}`)
    .join('|');
  useEffect(() => {
    setRfNodes(buildNodes());
  }, [items.length, itemContentKey, setRfNodes, buildNodes]);

  // 拖入连线（持久化到数据库）
  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      // 乐观更新：立即显示连线
      const tempId = `temp_edge_${Date.now()}`;
      setRfEdges((eds) =>
        addEdge({ ...connection, id: tempId, animated: true, style: { stroke: '#f472b6', strokeWidth: 2 } } as Edge, eds),
      );
      createCanvasEdgeAction(projectId, connection.source, connection.target)
        .then((result) => {
          if (result.ok && result.data) {
            // 用真实 id 替换临时 id
            setRfEdges((eds) => eds.map((e) => (e.id === tempId ? { ...e, id: result.data!.id } : e)));
          } else {
            setRfEdges((eds) => eds.filter((e) => e.id !== tempId));
          }
        })
        .catch(() => {
          setRfEdges((eds) => eds.filter((e) => e.id !== tempId));
        });
    },
    [projectId, setRfEdges],
  );

  // 一键整理
  const handleAutoLayout = useCallback(async () => {
    const result = await autoLayoutCanvasAction(projectId);
    if (result.ok && result.data) {
      setItems(result.data);
      // 只更新已有节点的位置，保留 data 等其他字段
      const posMap = new Map(result.data.map((item) => [item.id, { x: item.x, y: item.y }]));
      setRfNodes((prev) =>
        prev.map((node) => {
          const pos = posMap.get(node.id);
          return pos ? { ...node, position: pos } : node;
        }),
      );
    }
  }, [projectId, setRfNodes]);

  // 应用画布模板
  const handleApplyTemplate = useCallback(
    async (templateId: string) => {
      const result = await applyCanvasTemplateAction(projectId, templateId);
      if (result.ok && result.data) {
        setItems((prev) => [...prev, ...result.data!]);
      }
    },
    [projectId],
  );

  // 从分镜批量导入
  const handleImportShots = useCallback(async () => {
    const shots = data.shots;
    if (!shots || shots.length === 0) {
      alert('当前项目还没有分镜，请先在第四步生成分镜');
      return;
    }
    const mediaMap: Record<string, { kind: string; url: string }> = {};
    for (const shot of shots) {
      if (shot.selectedMediaId && data.media[shot.selectedMediaId]) {
        const m = data.media[shot.selectedMediaId];
        mediaMap[shot.selectedMediaId] = { kind: m.kind, url: m.url };
      }
    }
    const result = await importShotsToCanvasAction(
      projectId,
      shots.map((shot) => ({
        shotId: shot.id,
        index: shot.index,
        description: shot.description,
        dialogue: shot.dialogue,
        durationSec: shot.durationSec,
        shotSize: shot.shotSize,
        selectedMediaId: shot.selectedMediaId,
      })),
      mediaMap,
    );
    if (result.ok && result.data) {
      setItems((prev) => [...prev, ...result.data!]);
    }
  }, [projectId, data.shots, data.media]);

  /* ------------------------------ 对齐 / 分布 ------------------------------ */

  // 把选中节点同步到目标位置（同时更新本地 items 与数据库）
  const applyPositions = useCallback(
    (updates: Array<{ id: string; x: number; y: number }>) => {
      // 乐观更新 ReactFlow 节点位置
      setRfNodes((prev) =>
        prev.map((node) => {
          const u = updates.find((it) => it.id === node.id);
          return u ? { ...node, position: { x: u.x, y: u.y } } : node;
        }),
      );
      // 更新本地 items
      setItems((prev) =>
        prev.map((it) => {
          const u = updates.find((x) => x.id === it.id);
          return u ? { ...it, x: u.x, y: u.y } : it;
        }),
      );
      // 持久化
      for (const u of updates) {
        updateCanvasItemAction(u.id, { x: u.x, y: u.y }).catch(console.error);
      }
    },
    [setRfNodes],
  );

  const getSelectedItems = useCallback(() => items.filter((it) => selectedIds.includes(it.id)), [items, selectedIds]);

  const alignLeft = useCallback(() => {
    const sel = getSelectedItems();
    if (sel.length < 2) return;
    const minX = Math.min(...sel.map((it) => it.x));
    applyPositions(sel.map((it) => ({ id: it.id, x: minX, y: it.y })));
  }, [getSelectedItems, applyPositions]);

  const alignTop = useCallback(() => {
    const sel = getSelectedItems();
    if (sel.length < 2) return;
    const minY = Math.min(...sel.map((it) => it.y));
    applyPositions(sel.map((it) => ({ id: it.id, x: it.x, y: minY })));
  }, [getSelectedItems, applyPositions]);

  const distributeH = useCallback(() => {
    const sel = [...getSelectedItems()].sort((a, b) => a.x - b.x);
    if (sel.length < 3) return;
    const first = sel[0]!;
    const last = sel[sel.length - 1]!;
    const totalW = sel.reduce((sum, it) => sum + Math.max(80, it.width), 0);
    const gap = (last.x + last.width - first.x - totalW) / (sel.length - 1);
    let cursor = first.x;
    applyPositions(sel.map((it) => {
      const pos = { id: it.id, x: Math.round(cursor), y: it.y };
      cursor += Math.max(80, it.width) + gap;
      return pos;
    }));
  }, [getSelectedItems, applyPositions]);

  const distributeV = useCallback(() => {
    const sel = [...getSelectedItems()].sort((a, b) => a.y - b.y);
    if (sel.length < 3) return;
    const first = sel[0]!;
    const last = sel[sel.length - 1]!;
    const totalH = sel.reduce((sum, it) => sum + Math.max(60, it.height), 0);
    const gap = (last.y + last.height - first.y - totalH) / (sel.length - 1);
    let cursor = first.y;
    applyPositions(sel.map((it) => {
      const pos = { id: it.id, x: it.x, y: Math.round(cursor) };
      cursor += Math.max(60, it.height) + gap;
      return pos;
    }));
  }, [getSelectedItems, applyPositions]);

  /* ------------------------------ 画布锁定 & 搜索 ------------------------------ */

  const [locked, setLocked] = useState(false);
  const [search, setSearch] = useState('');

  const matchSet = useMemo(() => {
    if (!search.trim()) return null;
    const q = search.trim().toLowerCase();
    return new Set(
      items
        .filter((it) => (it.text || '').toLowerCase().includes(q) || it.kind.toLowerCase().includes(q))
        .map((it) => it.id),
    );
  }, [items, search]);

  // 搜索时非匹配节点淡化
  const visibleNodes = useMemo(() => {
    if (!matchSet) return allNodes;
    return allNodes.map((node) =>
      matchSet.has(node.id) ? node : { ...node, style: { ...node.style, opacity: 0.15 } },
    );
  }, [allNodes, matchSet]);

  /* ------------------------------ 画布快照导出/导入 ------------------------------ */

  /* ------------------------------ 节点详情抽屉 ------------------------------ */

  // 单选时显示 Inspector；多选时隐藏
  const inspectorItem = selectedIds.length === 1 ? items.find((it) => it.id === selectedIds[0]) ?? null : null;

  const handleFocusItem = useCallback(() => {
    if (!inspectorItem) return;
    setCenter(inspectorItem.x + (inspectorItem.width || 200) / 2, inspectorItem.y + (inspectorItem.height || 120) / 2, {
      zoom: 1,
      duration: 400,
    });
  }, [inspectorItem, setCenter]);

  const handleInspectorUpdate = useCallback(
    async (patch: Partial<CanvasItem>) => {
      if (!inspectorItem) return;
      const result = await updateCanvasItemAction(inspectorItem.id, patch);
      if (result.ok && result.data) {
        setItems((prev) => prev.map((it) => (it.id === inspectorItem.id ? result.data! : it)));
      }
    },
    [inspectorItem],
  );

  const handleInspectorDelete = useCallback(async () => {
    if (!inspectorItem) return;
    const target = inspectorItem;
    setSelectedIds([]);
    setItems((prev) => prev.filter((it) => it.id !== target.id));
    setRfNodes((prev) => prev.filter((n) => n.id !== target.id));
    await deleteCanvasItemAction(target.id).catch(console.error);
  }, [inspectorItem, setRfNodes]);

  const handleInspectorFront = useCallback(async () => {
    if (!inspectorItem) return;
    const result = await bringCanvasItemToFrontAction(inspectorItem.id);
    if (result.ok && result.data) {
      setItems((prev) => prev.map((it) => (it.id === inspectorItem.id ? result.data! : it)).sort((a, b) => a.z - b.z));
    }
  }, [inspectorItem]);

  const handleExportJson = useCallback(() => {
    // 连线用 items 数组下标存储，导入时可跨项目还原
    const indexById = new Map(items.map((it, idx) => [it.id, idx]));
    const snapshot = {
      version: 1,
      projectId,
      exportedAt: new Date().toISOString(),
      items: items.map((it) => ({
        kind: it.kind,
        text: it.text,
        url: it.url,
        x: it.x,
        y: it.y,
        width: it.width,
        height: it.height,
      })),
      edges: data.canvasEdges
        .map((e) => [indexById.get(e.sourceId), indexById.get(e.targetId)])
        .filter(([s, t]) => s !== undefined && t !== undefined),
    };
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `canvas-${projectId}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [projectId, items, data.canvasEdges]);

  // 导入画布快照 JSON
  const importInputRef = useRef<HTMLInputElement>(null);
  const handleImportJson = useCallback(() => {
    importInputRef.current?.click();
  }, []);

  const handleImportFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const snapshot = JSON.parse(text);
        const result = await importCanvasJsonAction(projectId, snapshot);
        if (result.ok && result.data) {
          setItems((prev) => [...prev, ...result.data!]);
        } else {
          alert(result.error ?? '导入失败：JSON 格式不正确');
        }
      } catch {
        alert('导入失败：无法解析该 JSON 文件');
      }
      // 重置 input 以便重复导入同一文件
      e.target.value = '';
    },
    [projectId],
  );

  const handleGroupSelected = useCallback(async () => {
    if (selectedIds.length < 2) {
      alert('请先框选（Ctrl+拖拽）至少 2 个素材再成组');
      return;
    }
    const name = window.prompt('场景名称', `场景 ${groups.length + 1}`);
    if (name === null) return;
    const result = await groupItemsAction(projectId, selectedIds, name || '未命名场景');
    if (result.ok && result.data) {
      setGroups((prev) => [...prev, result.data!]);
      const gid = result.data.id;
      setItemGroups((prev) => {
        const next = { ...prev };
        for (const id of selectedIds) next[id] = gid;
        return next;
      });
      setSelectedIds([]);
    }
  }, [projectId, selectedIds, groups.length]);

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
        nodes={visibleNodes}
        edges={rfEdges}
        fitView={false}
        nodesDraggable={!locked}
        nodesConnectable={!locked}
        elementsSelectable={!locked}
        zoomOnScroll={!locked}
        panOnScroll={!locked}
        minZoom={0.1}
        maxZoom={3}
        snapToGrid
        snapGrid={[16, 16]}
        deleteKeyCode={['Backspace', 'Delete']}
        multiSelectionKeyCode={['Meta', 'Control']}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodesChange={handleNodesChange}
        onEdgesChange={(changes) => {
          onRfEdgesChange(changes);
          // 连线删除时同步数据库
          for (const change of changes) {
            if (change.type === 'remove') {
              deleteCanvasEdgeAction(change.id).catch(console.error);
            }
          }
        }}
        onSelectionChange={(selection) => {
          setSelectedIds(selection.nodes.map((n) => n.id));
        }}
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

      {/* 画布工具栏 */}
      <div className="absolute left-3 top-3 z-20 flex flex-col gap-1.5 rounded-xl border border-[#333b4a] bg-[#12151c]/90 p-1.5 backdrop-blur">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => void handleGroupSelected()}
            disabled={selectedIds.length < 2 || locked}
            className="rounded-lg px-2.5 py-1 text-[11px] text-slate-300 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            title="框选多个素材后打包成场景卡片"
          >
            🎬 成组{selectedIds.length > 1 ? ` (${selectedIds.length})` : ''}
          </button>
          <button
            type="button"
            onClick={() =>
              void handleGenerateImages(
                selectedIds.length > 0 ? selectedIds : items.filter((it) => it.kind === 'text' && it.text.trim()).map((it) => it.id),
              )
            }
            disabled={locked || generating}
            className="rounded-lg px-2.5 py-1 text-[11px] text-amber-300 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            title={selectedIds.length > 0 ? '为选中的节点生成图片（文字 → 图片）' : '把画布上的文字节点批量生成图片'}
          >
            {generating ? '⏳ 生成中…' : '✨ 生成图片'}
            {selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}
          </button>
          <button
            type="button"
            onClick={() => void handleAutoLayout()}
            disabled={locked}
            className="rounded-lg px-2.5 py-1 text-[11px] text-slate-300 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ✨ 一键整理
          </button>
          <button
            type="button"
            onClick={() => void handleImportShots()}
            disabled={locked}
            className="rounded-lg px-2.5 py-1 text-[11px] text-slate-300 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            title="把第四步的分镜批量铺到画布"
          >
            🎞 导入分镜
          </button>
          <button
            type="button"
            onClick={() => void handleExportJson()}
            className="rounded-lg px-2.5 py-1 text-[11px] text-slate-300 transition-colors hover:bg-white/10"
            title="导出画布布局为 JSON 备份"
          >
            ⬇ 导出布局
          </button>
          <button
            type="button"
            onClick={handleImportJson}
            disabled={locked}
            className="rounded-lg px-2.5 py-1 text-[11px] text-slate-300 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            title="从 JSON 快照恢复布局"
          >
            ⬆ 导入布局
          </button>
          <div className="mx-0.5 w-px bg-[#333b4a]" />
          {CANVAS_TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => void handleApplyTemplate(template.id)}
              disabled={locked}
              title={template.description}
              className="rounded-lg px-2.5 py-1 text-[11px] text-pink-300/90 transition-colors hover:bg-pink-500/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              📐 {template.name}
            </button>
          ))}
        </div>
        {/* 第二行：对齐分布 + 锁定 + 搜索 */}
        <div className="flex flex-wrap items-center gap-1.5">
          {selectedIds.length >= 2 ? (
            <>
              <span className="text-[10px] text-slate-500">{selectedIds.length} 项</span>
              <button type="button" onClick={alignLeft} title="左对齐" className="rounded-lg px-2 py-1 text-[11px] text-slate-300 transition-colors hover:bg-white/10">⇤ 左</button>
              <button type="button" onClick={alignTop} title="顶对齐" className="rounded-lg px-2 py-1 text-[11px] text-slate-300 transition-colors hover:bg-white/10">⤒ 顶</button>
              <button type="button" onClick={distributeH} disabled={selectedIds.length < 3} title="水平均匀分布（≥3 项）" className="rounded-lg px-2 py-1 text-[11px] text-slate-300 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40">⇹ 水平分布</button>
              <button type="button" onClick={distributeV} disabled={selectedIds.length < 3} title="垂直均匀分布（≥3 项）" className="rounded-lg px-2 py-1 text-[11px] text-slate-300 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40">⇶ 垂直分布</button>
              <div className="mx-0.5 w-px bg-[#333b4a]" />
            </>
          ) : null}
          <button
            type="button"
            onClick={() => setLocked((v) => !v)}
            className={clsx(
              'rounded-lg px-2.5 py-1 text-[11px] transition-colors',
              locked ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30' : 'text-slate-300 hover:bg-white/10',
            )}
            title={locked ? '画布已锁定（只读），点击解锁' : '锁定画布（防误操作）'}
          >
            {locked ? '🔒 已锁定' : '🔓 锁定'}
          </button>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="🔍 搜索素材…"
            className="w-32 rounded-lg border border-[#333b4a] bg-[#0e1116] px-2 py-1 text-[11px] text-slate-200 placeholder:text-slate-600 focus:border-pink-400/40 focus:outline-none"
          />
        </div>
      </div>

      {locked && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center">
          <span className="rounded-full bg-amber-500/15 px-4 py-1 text-[11px] text-amber-300 backdrop-blur">
            🔒 画布已锁定 — 只读模式，点击工具栏「已锁定」解锁
          </span>
        </div>
      )}

      <CanvasInspector
        item={inspectorItem}
        groupName={inspectorItem ? (groups.find((g) => g.id === itemGroups[inspectorItem.id])?.name ?? null) : null}
        onClose={() => setSelectedIds([])}
        onUpdate={handleInspectorUpdate}
        onDelete={handleInspectorDelete}
        onBringToFront={handleInspectorFront}
        onFocus={handleFocusItem}
      />

      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => void handleImportFile(e)}
      />

      {items.length === 0 && (<div className="absolute inset-0 flex items-center justify-center pointer-events-none"><Empty text="无限画布为空。双击或右键添加素材。" /></div>)}
    </div>
  );
}

export function StudioCanvasBoard({ data }: { data: StudioData }) {
  return (<ReactFlowProvider><CanvasInner data={data} projectId={data.project.id} /></ReactFlowProvider>);
}
