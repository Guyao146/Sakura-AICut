'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addEdge,
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type OnConnect,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ASSET_TYPE_LABELS } from '@sakura/core';
import { Badge, STATUS_LABELS, statusTone } from '@/components/ui';
import type { StudioData } from './types';
import {
  loadLayout,
  NOTE_COLORS,
  saveLayout,
  type NoteColor,
  type PersistedNote,
} from './canvas-storage';

/**
 * 无限画布（RunningHub / LibTV / ComfyUI 式）
 *
 * 与「五步流程」是两件事：
 * - 流程：左侧导航 + 右侧面板的线性引导（项目设定→剧本→资产→分镜→剪辑）
 * - 画布：自由二维空间，节点可拖动、可从输出端口拖到输入端口连线、
 *          双击空白添加便签、滚轮缩放、拖拽空白平移，布局持久化。
 *
 * 节点分两类：
 * - 数据节点（brief/script/asset/shot/output）：由服务端数据派生，存在与否跟数据走，
 *   用户只调整位置与连线。
 * - 便签节点（note）：纯画布对象，文本/颜色/坐标全部保存在 localStorage。
 */

type DataNodeData = {
  kind: 'brief' | 'script' | 'asset' | 'shot' | 'output';
  title: string;
  subtitle: string;
  status?: string;
  thumb?: string;
  isVideo?: boolean;
  accent: string;
  /** 数据节点在画布上的默认列（仅首次出现、无记忆坐标时使用） */
  column: number;
};
type NoteNodeData = {
  kind: 'note';
  text: string;
  color: NoteColor;
};
type CanvasNodeData = DataNodeData | NoteNodeData;

const COLUMN_X = [60, 380, 700, 1020, 1340];
const NODE_H = 120;
const ROW_GAP = 44;

function DataNode({ data, selected }: NodeProps) {
  const node = data as unknown as DataNodeData;
  return (
    <div
      className={`w-[210px] rounded-xl border bg-[#12151c] p-2.5 shadow-lg transition-shadow ${
        selected ? 'ring-2 ring-sky-400/70' : ''
      }`}
      style={{ borderColor: selected ? '#38bdf8' : `${node.accent}55` }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!size-2.5 !border-2 !border-[#0e1116]"
        style={{ background: node.accent }}
      />
      <div className="flex items-center gap-2">
        <span
          className="inline-block size-2 shrink-0 rounded-full"
          style={{ background: node.accent }}
        />
        <span className="truncate text-[12px] font-medium text-slate-100">{node.title}</span>
        {node.status ? (
          <Badge tone={statusTone(node.status)}>{STATUS_LABELS[node.status] ?? node.status}</Badge>
        ) : null}
      </div>
      {node.thumb ? (
        <div className="mt-1.5 h-[64px] overflow-hidden rounded bg-black/40">
          {node.isVideo ? (
            <video
              src={node.thumb}
              muted
              loop
              autoPlay
              playsInline
              className="size-full object-cover"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={node.thumb} alt={node.title} className="size-full object-cover" />
          )}
        </div>
      ) : null}
      <div className="mt-1 truncate text-[10.5px] text-slate-500">{node.subtitle}</div>
      <Handle
        type="source"
        position={Position.Right}
        className="!size-2.5 !border-2 !border-[#0e1116]"
        style={{ background: node.accent }}
      />
    </div>
  );
}

function NoteNode({ data, selected }: NodeProps) {
  const node = data as unknown as NoteNodeData;
  const color = NOTE_COLORS[node.color];
  return (
    <div
      className={`w-[200px] rounded-lg p-0.5 shadow-lg ${selected ? 'ring-2 ring-sky-400/70' : ''}`}
      style={{ background: `${color}26`, border: `1px solid ${color}66` }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!size-2 !border-2 !border-[#0e1116]"
        style={{ background: color }}
      />
      <textarea
        value={node.text}
        onChange={(event) => {
          (data as unknown as { __setText?: (text: string) => void }).__setText?.(
            event.target.value,
          );
        }}
        onPointerDown={(event) => event.stopPropagation()}
        placeholder="便签：记录灵感、分镜备注…"
        className="block min-h-[64px] w-full resize-y bg-transparent px-2 py-1.5 text-[11.5px] leading-relaxed text-slate-200 outline-none placeholder:text-slate-600"
        style={{ caretColor: color }}
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!size-2 !border-2 !border-[#0e1116]"
        style={{ background: color }}
      />
    </div>
  );
}

const nodeTypes = { data: DataNode, note: NoteNode };

/* --------------------------- 数据 → 节点/连线 ---------------------------- */

function defaultPosition(column: number, indexInColumn: number): { x: number; y: number } {
  const columnX = COLUMN_X[column] ?? COLUMN_X[0];
  return { x: columnX, y: 60 + indexInColumn * (NODE_H + ROW_GAP) };
}

function buildDataNodes(data: StudioData): Node[] {
  const nodes: Node[] = [];
  const counters = new Map<number, number>();

  const push = (id: string, nodeData: DataNodeData): void => {
    const indexInColumn = counters.get(nodeData.column) ?? 0;
    counters.set(nodeData.column, indexInColumn + 1);
    nodes.push({
      id,
      type: 'data',
      position: defaultPosition(nodeData.column, indexInColumn),
      data: nodeData as unknown as Record<string, unknown>,
      draggable: true,
    });
  };

  const brief = data.project.brief;
  push('brief', {
    kind: 'brief',
    column: 0,
    accent: '#f472b6',
    title: '项目设定',
    subtitle: `${brief.name || '未命名'} · ${brief.genres.join('/') || '未选题材'}`,
  });

  push('script', {
    kind: 'script',
    column: 1,
    accent: '#60a5fa',
    title: '剧本',
    subtitle: data.screenplay
      ? `${data.screenplay.characters.length} 人物 · ${data.screenplay.beats.length} 节拍 · ${data.screenplay.locations.length} 场景`
      : '尚未创建剧本',
  });

  data.assets.forEach((asset) => {
    let thumb: string | undefined;
    for (const mediaId of asset.mediaIds) {
      const media = data.media[mediaId];
      if (media?.url) {
        thumb = media.url;
        break;
      }
    }
    push(`asset:${asset.id}`, {
      kind: 'asset',
      column: 2,
      accent: '#34d399',
      title: asset.name,
      subtitle: `${ASSET_TYPE_LABELS[asset.type]} · ${asset.mediaIds.length} 张图`,
      status: asset.status,
      thumb,
    });
  });

  data.shots.forEach((shot) => {
    const thumbMedia =
      data.media[shot.selectedMediaId ?? ''] ?? data.media[shot.clipMediaIds[0] ?? ''];
    push(`shot:${shot.id}`, {
      kind: 'shot',
      column: 3,
      accent: '#fbbf24',
      title: `镜头 ${shot.index} · ${shot.shotSize}`,
      subtitle: shot.description.slice(0, 26) || '空镜头',
      status: shot.status,
      thumb: thumbMedia?.url,
      isVideo: thumbMedia?.kind === 'video',
    });
  });

  const clipCount = data.timeline?.tracks.reduce((sum, track) => sum + track.clips.length, 0) ?? 0;
  push('output', {
    kind: 'output',
    column: 4,
    accent: '#a78bfa',
    title: '成片输出',
    subtitle: data.timeline?.renderOutputUrl
      ? '已导出成片'
      : clipCount > 0
        ? `${clipCount} 个片段待导出`
        : '尚无时间线',
    status: data.timeline?.renderOutputUrl ? 'ready' : undefined,
  });

  return nodes;
}

/**
 * 数据节点之间默认的流向连线（仅在首次、用户未编排时提供起点）
 * 节点 id 使用真实主键（asset:<uuid> / shot:<uuid>），不能写死 'first'。
 */
function defaultEdges(data: StudioData): Edge[] {
  const firstAsset = data.assets[0];
  const firstShot = data.shots[0];
  const candidate: Edge[] = [{ id: 'e_brief_script', source: 'brief', target: 'script' }];
  if (firstAsset) {
    candidate.push({ id: 'e_script_assets', source: 'script', target: `asset:${firstAsset.id}` });
    if (firstShot) {
      candidate.push({
        id: 'e_assets_shots',
        source: `asset:${firstAsset.id}`,
        target: `shot:${firstShot.id}`,
      });
    }
  }
  if (firstShot) {
    candidate.push({ id: 'e_shots_output', source: `shot:${firstShot.id}`, target: 'output' });
  }
  return candidate.map((edge) => ({
    ...edge,
    markerEnd: { type: MarkerType.ArrowClosed, color: '#475569' },
    style: { stroke: '#475569', strokeWidth: 1.5 },
  }));
}

function edgeStyle(edge: Edge): Edge {
  return {
    ...edge,
    markerEnd: edge.markerEnd ?? { type: MarkerType.ArrowClosed, color: '#7c8aa5' },
    style: edge.style ?? { stroke: '#7c8aa5', strokeWidth: 1.5 },
  };
}

/* ------------------------------ 添加节点面板 ------------------------------ */

function AddNodePanel({
  x,
  y,
  onAddNote,
  onClose,
}: {
  x: number;
  y: number;
  onAddNote: (color: NoteColor) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as globalThis.Node)) onClose();
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute z-50 w-[180px] rounded-lg border border-[#2b3240] bg-[#12151c] p-1.5 shadow-2xl"
      style={{ left: x, top: y }}
    >
      <div className="px-1.5 pb-1 text-[10px] text-slate-500">添加节点</div>
      {(Object.keys(NOTE_COLORS) as NoteColor[]).map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => onAddNote(color)}
          className="flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-left text-[12px] text-slate-200 hover:bg-white/5"
        >
          <span
            className="inline-block size-3 rounded"
            style={{ background: NOTE_COLORS[color] }}
          />
          便签
        </button>
      ))}
    </div>
  );
}

/* ------------------------------ 画布主体 ------------------------------ */

type AddNodeMenu = { x: number; y: number; flowX: number; flowY: number } | null;

function CanvasInner({
  data,
  onSelectNode,
}: {
  data: StudioData;
  onSelectNode: (nodeId: string) => void;
}) {
  const projectId = data.project.id;
  const { screenToFlowPosition, fitView } = useReactFlow();

  const dataNodes = useMemo(() => buildDataNodes(data), [data]);
  const dataIds = useMemo(() => new Set(dataNodes.map((node) => node.id)), [dataNodes]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [menu, setMenu] = useState<AddNodeMenu>(null);
  const [hydrated, setHydrated] = useState(false);

  /* 首次挂载：用持久化布局合并数据节点 */
  useEffect(() => {
    const layout = loadLayout(projectId);
    const positionById = new Map<string, { x: number; y: number }>(
      Object.entries(layout?.positions ?? {}),
    );
    const validEdge = (edge: Edge): boolean =>
      dataIds.has(edge.source) && dataIds.has(edge.target);

    const merged: Node[] = dataNodes.map((node) => {
      const remembered = positionById.get(node.id);
      return remembered ? { ...node, position: remembered } : node;
    });

    for (const note of layout?.notes ?? []) {
      merged.push({
        id: note.id,
        type: 'note',
        position: { x: note.x, y: note.y },
        data: {
          kind: 'note',
          text: note.text,
          color: note.color,
        } as unknown as Record<string, unknown>,
        draggable: true,
      });
    }

    const savedEdges = ((layout?.edges ?? []) as Edge[]).filter(validEdge);
    setNodes(merged);
    setEdges(savedEdges.length > 0 ? savedEdges.map(edgeStyle) : defaultEdges(data));
    setHydrated(true);
    // 仅首次进入时自动取景，避免每次数据刷新都被拉回视野
    requestAnimationFrame(() => fitView({ padding: 0.18, maxZoom: 1.1 }));
    // 数据更新走下面的 effect，这里只在项目切换时重新挂载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  /* 数据节点更新（服务端刷新带来新增/删除）时，保留用户已编排的位置、便签与连线 */
  useEffect(() => {
    if (!hydrated) return;
    setNodes((prev) => {
      const positionById = new Map(prev.map((node) => [node.id, node.position]));
      const notes = prev.filter((node) => node.type === 'note');
      const merged = dataNodes.map((node) => {
        const remembered = positionById.get(node.id);
        return remembered ? { ...node, position: remembered } : node;
      });
      return [...merged, ...notes];
    });
    setEdges((prev) => prev.filter((edge) => dataIds.has(edge.source) && dataIds.has(edge.target)));
  }, [dataNodes, dataIds, hydrated, setNodes, setEdges]);

  /* 持久化：拖动结束 / 连线 / 删除 / 便签编辑时保存 */
  const persist = useCallback(() => {
    const positions: Record<string, { x: number; y: number }> = {};
    const notes: PersistedNote[] = [];
    setNodes((current) => {
      for (const node of current) {
        positions[node.id] = node.position;
        if (node.type === 'note') {
          const noteData = node.data as unknown as NoteNodeData;
          notes.push({
            id: node.id,
            text: noteData.text,
            color: noteData.color,
            x: node.position.x,
            y: node.position.y,
          });
        }
      }
      return current;
    });
    setEdges((current) => {
      saveLayout(projectId, {
        positions,
        notes,
        edges: current.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle ?? null,
          targetHandle: edge.targetHandle ?? null,
          animated: Boolean(edge.animated),
        })),
      });
      return current;
    });
  }, [projectId, setNodes, setEdges]);

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      if (connection.source === connection.target) return;
      setEdges((current) => addEdge({ ...connection, animated: true }, current).map(edgeStyle));
      void persist();
    },
    [setEdges, persist],
  );

  const onNodeDragStop = useCallback(() => void persist(), [persist]);
  const onEdgesDelete = useCallback(() => void persist(), [persist]);
  const onNodesDelete = useCallback(() => void persist(), [persist]);

  /* 双击空白处弹出添加节点面板 */
  const onPaneDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      const flowPosition = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      setMenu({
        x: event.clientX,
        y: event.clientY,
        flowX: flowPosition.x,
        flowY: flowPosition.y,
      });
    },
    [screenToFlowPosition],
  );

  const addNote = useCallback(
    (color: NoteColor) => {
      if (!menu) return;
      const id = `note:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 6)}`;
      const noteData: NoteNodeData = { kind: 'note', text: '', color };
      const setter = (text: string): void => {
        setNodes((current) =>
          current.map((node) =>
            node.id === id
              ? { ...node, data: { ...noteData, text } as unknown as Record<string, unknown> }
              : node,
          ),
        );
        void persist();
      };
      setNodes((current) =>
        current.concat({
          id,
          type: 'note',
          position: { x: menu.flowX, y: menu.flowY },
          data: { ...noteData, __setText: setter } as unknown as Record<string, unknown>,
          draggable: true,
        }),
      );
      setMenu(null);
      void persist();
    },
    [menu, setNodes, persist],
  );

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      onSelectNode(node.id);
    },
    [onSelectNode],
  );

  return (
    <div className="relative size-full" onDoubleClick={onPaneDoubleClick}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onEdgesDelete={onEdgesDelete}
        onNodesDelete={onNodesDelete}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={handleNodeClick}
        minZoom={0.15}
        maxZoom={2.5}
        fitView={false}
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={['Backspace', 'Delete']}
        multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
        panOnDrag={true}
        zoomOnScroll={true}
        zoomOnDoubleClick={false}
      >
        <Background gap={26} color="#20262f" />
        <Controls className="!bg-[#12151c] !text-slate-300" showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          className="!bg-[#0e1116]"
          maskColor="rgba(0,0,0,0.65)"
          nodeColor={(node) => {
            const nodeData = node.data as unknown as CanvasNodeData;
            return nodeData.kind === 'note' ? NOTE_COLORS[nodeData.color] : nodeData.accent;
          }}
        />
        <Panel position="top-left">
          <div className="rounded-lg border border-[#232a37] bg-[#12151c]/90 px-3 py-2 text-[10.5px] leading-relaxed text-slate-500 shadow-lg backdrop-blur">
            <span className="text-slate-300">无限画布</span> · 与五步流程相互独立
            <br />
            拖动节点整理布局 · 从节点右侧圆点拖到另一节点左侧可连线
            <br />
            双击空白<span className="text-sky-300">添加便签</span> · 选中后 Delete 删除 · 滚轮缩放 / 拖拽空白平移
          </div>
        </Panel>
      </ReactFlow>
      {menu ? (
        <AddNodePanel x={menu.x} y={menu.y} onAddNote={addNote} onClose={() => setMenu(null)} />
      ) : null}
    </div>
  );
}

export function StudioCanvasBoard({
  data,
  onSelectStep,
}: {
  data: StudioData;
  onSelectStep: (stage: string) => void;
}) {
  const onSelectNode = useCallback(
    (nodeId: string) => {
      if (nodeId === 'brief' || nodeId === 'script') {
        onSelectStep(nodeId);
      } else if (nodeId === 'output') {
        onSelectStep('edit');
      } else if (nodeId.startsWith('asset:')) {
        onSelectStep('assets');
      } else if (nodeId.startsWith('shot:')) {
        onSelectStep('shots');
      }
    },
    [onSelectStep],
  );

  return (
    <ReactFlowProvider>
      <CanvasInner data={data} onSelectNode={onSelectNode} />
    </ReactFlowProvider>
  );
}

