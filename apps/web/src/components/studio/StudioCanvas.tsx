'use client';

import { useMemo } from 'react';
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { PIPELINE_STEPS } from '@sakura/core';
import { Badge, Progress, STATUS_LABELS, statusTone } from '@/components/ui';
import type { StudioData } from './types';

/**
 * 无限画布：五步主线节点 + 第三步资产节点 + 第四步镜头节点
 */

interface StepNodeData {
  title: string;
  subtitle: string;
  percent: number;
  done: boolean;
  stats: string;
  index: number;
  accent: string;
}
interface AssetNodeData {
  name: string;
  type: string;
  status: string;
  thumb?: string;
}
interface ShotNodeData {
  index: number;
  shotSize: string;
  status: string;
  description: string;
  thumb?: string;
}

function StepNode({ data }: NodeProps) {
  const node = data as unknown as StepNodeData;
  return (
    <div
      className="w-[220px] rounded-xl border bg-[#12151c] p-3 shadow-lg"
      style={{ borderColor: node.done ? '#34d39955' : `${node.accent}55` }}
    >
      <Handle type="target" position={Position.Top} className="!bg-slate-500" />
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] text-slate-500">第 {node.index} 步</span>
        <span className="text-[11px] text-slate-400">{node.percent}%</span>
      </div>
      <div className="text-[13px] font-medium text-slate-100">{node.title}</div>
      <div className="mt-0.5 text-[11px] text-slate-500">{node.subtitle}</div>
      <div className="mt-2">
        <Progress value={node.percent} />
      </div>
      <div className="mt-1.5 text-[11px] text-slate-500">{node.stats}</div>
      <Handle type="source" position={Position.Bottom} className="!bg-slate-500" />
    </div>
  );
}

function AssetNode({ data }: NodeProps) {
  const node = data as unknown as AssetNodeData;
  return (
    <div className="w-[136px] rounded-lg border border-[#2b3240] bg-[#12151c] p-1.5">
      <Handle type="target" position={Position.Left} className="!bg-slate-600" />
      <div className="mb-1 h-[76px] overflow-hidden rounded bg-black/40">
        {node.thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={node.thumb} alt={node.name} className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center text-[10px] text-slate-600">待生成</div>
        )}
      </div>
      <div className="truncate text-[11px] text-slate-200">{node.name}</div>
      <div className="mt-0.5 flex items-center justify-between">
        <span className="text-[10px] text-slate-500">{node.type}</span>
        <Badge tone={statusTone(node.status)}>{STATUS_LABELS[node.status] ?? node.status}</Badge>
      </div>
    </div>
  );
}

function ShotNode({ data }: NodeProps) {
  const node = data as unknown as ShotNodeData;
  return (
    <div className="w-[152px] rounded-lg border border-[#2b3240] bg-[#12151c] p-1.5">
      <Handle type="target" position={Position.Left} className="!bg-slate-600" />
      <div className="mb-1 h-[82px] overflow-hidden rounded bg-black/40">
        {node.thumb ? (
          <video src={node.thumb} muted className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center text-[10px] text-slate-600">未生成</div>
        )}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-slate-200">
          #{node.index} {node.shotSize}
        </span>
        <Badge tone={statusTone(node.status)}>{STATUS_LABELS[node.status] ?? node.status}</Badge>
      </div>
      <div className="mt-0.5 truncate text-[10px] text-slate-500">{node.description}</div>
      <Handle type="source" position={Position.Right} className="!bg-slate-600" />
    </div>
  );
}

const nodeTypes = { step: StepNode, asset: AssetNode, shot: ShotNode };

function buildGraph(data: StudioData): { nodes: Node[]; edges: Edge[] } {
  const stepX = 40;
  const progressByStage = new Map(data.progress.map((item) => [item.stage, item]));

  const stepNodes: Node[] = PIPELINE_STEPS.map((step, index) => {
    const progress = progressByStage.get(step.stage);
    return {
      id: `step_${step.key}`,
      type: 'step',
      position: { x: stepX, y: index * 210 },
      data: {
        index: step.index,
        title: step.title,
        subtitle: step.subtitle,
        percent: progress?.percent ?? 0,
        done: progress?.done ?? false,
        stats: progress?.stats ?? '',
        accent: step.accent,
      },
    } as Node;
  });

  const edges: Edge[] = PIPELINE_STEPS.slice(1).map((step, index) => ({
    id: `edge_${index}`,
    source: `step_${PIPELINE_STEPS[index]?.key}`,
    target: `step_${step.key}`,
    animated: true,
    style: { stroke: '#3b4354' },
  }));

  const assetNodes: Node[] = data.assets.map((asset, index) => ({
    id: `asset_${asset.id}`,
    type: 'asset',
    position: { x: stepX + 320 + (index % 4) * 152, y: 560 + Math.floor(index / 4) * 150 },
    data: {
      name: asset.name,
      type: asset.type,
      status: asset.status,
      thumb: asset.mediaIds[0] ? data.media[asset.mediaIds[0]]?.url : undefined,
    },
  }));

  const shotNodes: Node[] = data.shots.map((shot, index) => ({
    id: `shot_${shot.id}`,
    type: 'shot',
    position: { x: stepX + 320 + (index % 4) * 168, y: 880 + Math.floor(index / 4) * 160 },
    data: {
      index: shot.index,
      shotSize: shot.shotSize,
      status: shot.status,
      description: shot.description,
      thumb: data.media[shot.selectedMediaId ?? shot.clipMediaIds[0] ?? '']?.url,
    },
  }));

  for (const node of assetNodes) {
    edges.push({ id: `e_step3_${node.id}`, source: 'step_assets', target: node.id, style: { stroke: '#2f6f4f' } });
  }
  for (const node of shotNodes) {
    edges.push({ id: `e_step4_${node.id}`, source: 'step_shots', target: node.id, style: { stroke: '#7a6a2f' } });
  }

  return { nodes: [...stepNodes, ...assetNodes, ...shotNodes], edges };
}

export function StudioCanvasBoard({ data, onSelectStep }: { data: StudioData; onSelectStep: (stage: string) => void }) {
  const graph = useMemo(() => buildGraph(data), [data]);

  return (
    <ReactFlowProvider>
      <ReactFlow
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node) => {
          if (node.id.startsWith('step_')) onSelectStep(node.id.replace('step_', ''));
          else if (node.id.startsWith('asset_')) onSelectStep('assets');
          else if (node.id.startsWith('shot_')) onSelectStep('shots');
        }}
      >
        <Background gap={24} color="#1c2129" />
        <Controls className="!bg-[#12151c] !text-slate-300" showInteractive={false} />
        <MiniMap pannable zoomable className="!bg-[#0e1116]" maskColor="rgba(0,0,0,0.6)" />
      </ReactFlow>
    </ReactFlowProvider>
  );
}

