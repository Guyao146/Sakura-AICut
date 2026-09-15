import type { PipelineStage } from '../types/project';
import type { Screenplay } from '../types/screenplay';
import type { Shot } from '../types/shot';
import type { Asset } from '../types/asset';
import type { Timeline } from '../types/timeline';

/**
 * 五步流程定义：顺序、校验规则、画布节点布局
 */

export interface StepDefinition {
  stage: PipelineStage;
  index: number;
  key: string;
  title: string;
  subtitle: string;
  description: string;
  /** 该步骤要完成的产出 */
  deliverables: string[];
  /** 画布节点尺寸与间距（用于 React Flow 自动布局） */
  layout: { x: number; y: number; width: number; height: number };
  accent: string;
}

export const PIPELINE_STEPS: StepDefinition[] = [
  {
    stage: 'brief',
    index: 1,
    key: 'brief',
    title: '项目设定',
    subtitle: '名称 / 题材 / 风格 / 画幅',
    description: '确定项目名称、题材类型、视觉风格、画幅与目标时长，作为后续所有生成的统一基准。',
    deliverables: ['项目名称', '题材与风格', '画幅与时长'],
    layout: { x: 0, y: 0, width: 320, height: 200 },
    accent: '#f472b6',
  },
  {
    stage: 'script',
    index: 2,
    key: 'script',
    title: '剧本创作',
    subtitle: '大纲 / 人物 / 场景 / 节拍',
    description: '手写剧本或用右侧 AI 小助手生成；产出人物小传、场景清单、道具清单与分节拍剧情。',
    deliverables: ['故事梗概', '人物小传', '场景与道具', '剧情节拍'],
    layout: { x: 0, y: 280, width: 320, height: 200 },
    accent: '#60a5fa',
  },
  {
    stage: 'assets',
    index: 3,
    key: 'assets',
    title: '资产生成',
    subtitle: '人物 / 场景 / 物品 参考图',
    description: '根据剧本自动规划资产并生成人物三视图、场景概念图、道具特写，锁定角色一致性。',
    deliverables: ['人物三视图', '场景概念图', '道具特写'],
    layout: { x: 0, y: 560, width: 320, height: 200 },
    accent: '#34d399',
  },
  {
    stage: 'shots',
    index: 4,
    key: 'shots',
    title: '分镜片段',
    subtitle: '镜头 / 运镜 / 视频片段',
    description: '拆解镜头，选择内置运镜模板或自定义运镜提示词，逐镜生成视频片段。',
    deliverables: ['镜头列表', '运镜设定', '视频片段'],
    layout: { x: 0, y: 840, width: 320, height: 200 },
    accent: '#fbbf24',
  },
  {
    stage: 'edit',
    index: 5,
    key: 'edit',
    title: '在线剪辑',
    subtitle: '时间线 / 转场 / 导出',
    description: '把选中的片段排入时间线，调整顺序、时长、变速、转场配乐，导出成片。',
    deliverables: ['时间线', '转场与配乐', '导出成片'],
    layout: { x: 0, y: 1120, width: 320, height: 200 },
    accent: '#a78bfa',
  },
];

export function getStep(stage: PipelineStage): StepDefinition | undefined {
  return PIPELINE_STEPS.find((step) => step.stage === stage);
}

export function stepByIndex(index: number): StepDefinition | undefined {
  return PIPELINE_STEPS.find((step) => step.index === index);
}

/** 项目快照：用于计算进度与给 Agent 提供上下文 */
export interface ProjectSnapshot {
  stage: PipelineStage;
  brief: { name: string; genres: string[]; style: string; aspectRatio: string; targetDurationSec: number; language: string };
  screenplay?: Screenplay | null;
  assets?: Asset[];
  shots?: Shot[];
  timeline?: Timeline | null;
}

export interface StepProgress {
  stage: PipelineStage;
  index: number;
  title: string;
  /** 0-100 */
  percent: number;
  done: boolean;
  /** 展示用统计 */
  stats: string;
}

/** 计算每一步的完成度，用于左侧步骤条与画布节点状态 */
export function computeProgress(snapshot: ProjectSnapshot): StepProgress[] {
  const brief = snapshot.brief;
  const screenplay = snapshot.screenplay;
  const assets = snapshot.assets ?? [];
  const shots = snapshot.shots ?? [];
  const timeline = snapshot.timeline;

  const briefFields = [brief.name, brief.genres?.length ? 'y' : '', brief.style, brief.aspectRatio, brief.targetDurationSec ? 'y' : ''];
  const briefPercent = Math.round((briefFields.filter(Boolean).length / briefFields.length) * 100);

  const scriptPercent = screenplay
    ? Math.min(
        100,
        (screenplay.characters.length > 0 ? 30 : 0) +
          (screenplay.locations.length > 0 ? 20 : 0) +
          (screenplay.beats.length > 0 ? 30 : 0) +
          (screenplay.synopsis ? 20 : 0),
      )
    : 0;

  const assetTotal = assets.length;
  const assetDone = assets.filter((a) => a.mediaIds.length > 0).length;
  const assetsPercent = assetTotal === 0 ? 0 : Math.round((assetDone / assetTotal) * 100);

  const shotTotal = shots.length;
  const shotDone = shots.filter((s) => s.selectedMediaId || s.clipMediaIds.length > 0).length;
  const shotsPercent = shotTotal === 0 ? 0 : Math.round((shotDone / shotTotal) * 100);

  const editPercent = timeline && timeline.tracks.some((t) => t.clips.length > 0) ? (timeline.renderOutputUrl ? 100 : 70) : 0;

  return [
    { stage: 'brief', index: 1, title: '项目设定', percent: briefPercent, done: briefPercent >= 80, stats: `${brief.genres.join('/') || '未选题材'}` },
    {
      stage: 'script',
      index: 2,
      title: '剧本创作',
      percent: scriptPercent,
      done: scriptPercent >= 80,
      stats: screenplay ? `${screenplay.characters.length} 人物 · ${screenplay.beats.length} 节拍` : '暂无剧本',
    },
    {
      stage: 'assets',
      index: 3,
      title: '资产生成',
      percent: assetsPercent,
      done: assetTotal > 0 && assetDone === assetTotal,
      stats: `${assetDone}/${assetTotal} 张资产就绪`,
    },
    {
      stage: 'shots',
      index: 4,
      title: '分镜片段',
      percent: shotsPercent,
      done: shotTotal > 0 && shotDone === shotTotal,
      stats: `${shotDone}/${shotTotal} 镜已成片`,
    },
    {
      stage: 'edit',
      index: 5,
      title: '在线剪辑',
      percent: editPercent,
      done: Boolean(timeline?.renderOutputUrl),
      stats: timeline ? `${timeline.tracks.reduce((sum, t) => sum + t.clips.length, 0)} 个片段` : '暂无时间线',
    },
  ];
}

/** 推断当前应该停留在哪一步（用于「继续创作」按钮） */
export function inferStage(progress: StepProgress[]): PipelineStage {
  const firstNotDone = progress.find((p) => !p.done);
  return firstNotDone?.stage ?? 'done';
}
