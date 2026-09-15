import type { AgentToolMeta, AgentToolName } from '../types/agent';

/**
 * Agent 工具注册表（元信息）
 * 真正的执行逻辑在 worker 的 tools 实现中，这里只描述「Agent 能做什么」，
 * 供规划器生成提示词、供前端展示确认弹窗。
 */
export const AGENT_TOOLS: AgentToolMeta[] = [
  {
    name: 'agent.ask_user',
    label: '向用户提问',
    description: '关键信息缺失时向用户提问（一轮问完），并在收到回答后再重新规划。',
    requiresApproval: false,
    argsSchema: { question: 'string 需要用户回答的问题（可包含多个子问题）' },
  },
  {
    name: 'project.update_brief',
    label: '更新项目设定',
    description: '写入项目名称、题材、风格、画幅、时长、语言等设定。',
    requiresApproval: false,
    argsSchema: {
      name: 'string 可选，项目名称',
      genres: 'string[] 可选，题材',
      style: 'string 可选，视觉风格',
      aspectRatio: 'string 可选，9:16 / 16:9 等',
      targetDurationSec: 'number 可选，目标总时长（秒）',
      language: 'string 可选，zh-CN / en-US',
      logline: 'string 可选，一句话故事',
      notes: 'string 可选，补充要求',
    },
  },
  {
    name: 'screenplay.generate',
    label: '生成剧本结构',
    description: '调用文本模型生成完整剧本 JSON（人物、场景、道具、节拍）并写入项目。',
    requiresApproval: false,
    argsSchema: {
      idea: 'string 可选，故事创意；不填则依据项目设定自动创作',
      keepExistingCharacters: 'boolean 可选，是否保留已有的人物设定',
    },
  },
  {
    name: 'screenplay.update',
    label: '修改剧本内容',
    description: '按指令局部修改剧本（增删人物、调整节拍、改写台词等）。',
    requiresApproval: false,
    argsSchema: {
      instruction: 'string 必填，修改要求',
      target: 'string 可选，characters / locations / props / beats 之一',
    },
  },
  {
    name: 'asset.plan',
    label: '规划资产清单',
    description: '依据剧本生成需要产出的资产清单（人物三视图、场景图、道具图）及其提示词。',
    requiresApproval: false,
    argsSchema: { instructions: 'string 可选，额外要求（例如「主角要两套造型」）' },
  },
  {
    name: 'asset.generate',
    label: '批量生成资产图',
    description: '为指定资产调用图片模型生成参考图（较贵，需要确认）。',
    requiresApproval: true,
    argsSchema: {
      assetNames: 'string[] 可选，仅生成指定资产；不填则生成全部待生成资产',
      variants: 'number 可选，每个资产生成张数，默认 1',
      regenerate: 'boolean 可选，是否覆盖已生成的图，默认 false',
    },
  },
  {
    name: 'shot.plan',
    label: '拆解分镜镜头',
    description: '把剧本节拍拆成镜头列表（景别、运镜、台词、时长、提示词）。',
    requiresApproval: false,
    argsSchema: {
      maxShots: 'number 可选，镜头数上限（默认按总时长 / 5 秒估算）',
      cameraPreference: 'string 可选，运镜偏好，例如「多用推镜与环绕」',
      replaceExisting: 'boolean 可选，是否覆盖已有镜头（默认 false，会追加）',
    },
  },
  {
    name: 'shot.generate',
    label: '批量生成镜头片段',
    description: '为指定镜头调用视频模型生成视频片段（最贵，需要确认）。',
    requiresApproval: true,
    argsSchema: {
      shotIndexes: 'number[] 可选，指定镜头序号；不填则生成全部未完成镜头',
      regenerate: 'boolean 可选，已生成的是否重做，默认 false',
      withFirstFrame: 'boolean 可选，是否先生成首帧图再图生视频（更稳更贵），默认 true',
    },
  },
  {
    name: 'timeline.build',
    label: '构建时间线',
    description: '把已选中的镜头片段按顺序铺到时间线，自动加淡入淡出转场。',
    requiresApproval: false,
    argsSchema: {
      transition: 'string 可选，fade / dissolve / none，默认 fade',
      transitionDuration: 'number 可选，转场时长（秒），默认 0.4',
      includeSubtitles: 'boolean 可选，是否生成台词字幕轨，默认 true',
    },
  },
  {
    name: 'timeline.render',
    label: '渲染导出成片',
    description: '用 ffmpeg 渲染时间线并导出 mp4（消耗 CPU，需要确认）。',
    requiresApproval: true,
    argsSchema: {
      preset: 'string 可选，vertical-1080p / horizontal-1080p',
      includeSubtitles: 'boolean 可选，是否烧录字幕',
    },
  },
  {
    name: 'prompt.lookup',
    label: '查询提示词模板',
    description: '在提示词库中按关键词检索可用模板。',
    requiresApproval: false,
    argsSchema: { query: 'string 必填，检索关键词', category: 'string 可选，模板分类' },
  },
  {
    name: 'finish',
    label: '完成并汇报',
    description: '结束执行并给出总结。',
    requiresApproval: false,
    argsSchema: { message: 'string 必填，给用户的总结' },
  },
];

export function findAgentTool(name: string): AgentToolMeta | undefined {
  return AGENT_TOOLS.find((tool) => tool.name === name);
}

export function isKnownTool(name: string): name is AgentToolName {
  return AGENT_TOOLS.some((tool) => tool.name === name);
}

/** 生成给规划器看的工具清单文本 */
export function buildToolCatalog(): string {
  return AGENT_TOOLS.map((tool) => {
    const args = Object.entries(tool.argsSchema)
      .map(([key, desc]) => `      - ${key}: ${desc}`)
      .join('\n');
    return `- ${tool.name}（${tool.label}）${tool.requiresApproval ? ' [需要用户确认]' : ''}\n    ${tool.description}\n    参数：\n${args}`;
  }).join('\n');
}
