import type { Asset, Character, PropItem, SceneLocation, Screenplay, Shot, StoryBeat } from '@sakura/core';
import {
  ASSET_PROMPT_SYSTEM_PROMPT,
  BUILTIN_CAMERA_MOVES,
  SCREENPLAY_SYSTEM_PROMPT,
  SHOT_SIZES,
  STORYBOARD_SYSTEM_PROMPT,
  buildAssetImagePrompt,
  createId,
  extractJson,
  imagePromptSchema,
  parseWithSchema,
  screenplaySchema,
  storyboardSchema,
} from '@sakura/core';
import {
  appendShots,
  getAsset,
  getProject,
  getScreenplay,
  loadContent,
  replaceAssets,
  replaceShots,
  updateAsset,
  upsertScreenplay,
  type AssetUpsertInput,
  type ShotInput,
} from '@sakura/db';
import { runText } from './ai';

const SHOT_SIZE_SET = new Set<string>(SHOT_SIZES as readonly string[]);

/**
 * 生成编排：把「设定 → 剧本 → 资产 → 分镜 → 片段」串起来
 * web（Server Action）与 worker（后台任务）都调用这里的函数
 */

/* ============================ 一、剧本 ============================ */

export interface GenerateScreenplayOptions {
  idea?: string;
  keepExistingCharacters?: boolean;
  temperature?: number;
  /** 额外要求，例如「多写反转」「台词更口语」 */
  extraInstructions?: string;
}

export async function generateScreenplay(
  projectId: string,
  options: GenerateScreenplayOptions = {},
): Promise<Screenplay> {
  const project = getProject(projectId);
  if (!project) throw new Error(`项目不存在：${projectId}`);
  const existing = getScreenplay(projectId);
  const brief = project.brief;

  const userPrompt = [
    `项目名称：${brief.name}`,
    `题材：${brief.genres.join('、') || '自由发挥'}`,
    `视觉风格：${brief.style}`,
    `画幅：${brief.aspectRatio}`,
    `目标总时长：${brief.targetDurationSec} 秒（共 ${brief.episodeCount} 集）`,
    `语言：${brief.language}`,
    brief.audience ? `目标受众：${brief.audience}` : '',
    brief.logline ? `已有的一句话故事：${brief.logline}` : '',
    options.idea ? `故事创意与要求：${options.idea}` : '请自行构思一个完整、有钩子的故事。',
    options.keepExistingCharacters && existing
      ? `保留以下人物设定（可补充细节但不要改名）：${JSON.stringify(
          existing.characters.map((c) => ({ name: c.name, role: c.role, appearance: c.appearance })),
        )}`
      : '',
    options.extraInstructions ?? '',
  ]
    .filter(Boolean)
    .join('\n');

  const { text } = await runText({
    messages: [
      { role: 'system', content: SCREENPLAY_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    json: true,
    temperature: options.temperature ?? 0.85,
    maxTokens: 8000,
  });

  const draft = parseWithSchema(screenplaySchema, extractJson(text), '剧本');

  const characters: Character[] = draft.characters.map((item) => ({
    id: `cha_${createId(10)}`,
    name: item.name,
    aliases: item.aliases ?? [],
    role: item.role,
    gender: item.gender as Character['gender'],
    age: item.age,
    appearance: item.appearance,
    costume: item.costume,
    personality: item.personality,
    background: item.background,
    voiceStyle: item.voiceStyle,
    assetId: null,
  }));

  const locations: SceneLocation[] = draft.locations.map((item) => ({
    id: `loc_${createId(10)}`,
    name: item.name,
    interior: item.interior,
    timeOfDay: item.timeOfDay as SceneLocation['timeOfDay'],
    atmosphere: item.atmosphere,
    description: item.description,
    assetId: null,
  }));

  const props: PropItem[] = draft.props.map((item) => ({
    id: `prp_${createId(10)}`,
    name: item.name,
    category: item.category,
    description: item.description,
    importance: item.importance,
    assetId: null,
  }));

  const beats: StoryBeat[] = draft.beats.map((beat, index) => {
    const location = locations.find((loc) => loc.name === beat.locationName);
    return {
      id: `beat_${createId(10)}`,
      index,
      title: beat.title,
      summary: beat.summary,
      locationId: location?.id ?? null,
      characterIds: characters.filter((c) => beat.characterNames.includes(c.name)).map((c) => c.id),
      mood: beat.mood,
      durationSec: beat.durationSec,
    };
  });

  return upsertScreenplay(projectId, {
    title: draft.title,
    logline: draft.logline,
    synopsis: draft.synopsis,
    characters,
    locations,
    props,
    beats,
    raw: text,
    source: 'ai',
  });
}

/* ============================ 二、资产规划 ============================ */

/** 依据剧本生成资产清单（纯结构化推导，零模型成本） */
export function planAssetsFromScreenplay(projectId: string, options: { instructions?: string } = {}): Asset[] {
  const content = loadContent(projectId);
  const screenplay = content.screenplay;
  if (!screenplay) throw new Error('请先生成或填写剧本，再进行资产规划');

  const style = content.project.brief.style;
  const inputs: AssetUpsertInput[] = [];

  for (const character of screenplay.characters) {
    inputs.push({
      type: 'character',
      name: character.name,
      refId: character.id,
      description: `${character.gender} · ${character.age} · ${character.personality}`,
      prompt: buildAssetImagePrompt({
        type: 'character',
        name: character.name,
        description: [character.appearance, character.costume ? `wearing ${character.costume}` : '']
          .filter(Boolean)
          .join(', '),
        style,
        view: 'three-view',
        extraPrompt: options.instructions,
      }),
      negativePrompt: content.project.brief.negativePrompt,
      tags: ['人物', character.role],
      variants: 2,
    });
  }

  for (const location of screenplay.locations) {
    inputs.push({
      type: 'location',
      name: location.name,
      refId: location.id,
      description: `${location.interior ? '内景' : '外景'} · ${location.timeOfDay} · ${location.atmosphere}`,
      prompt: buildAssetImagePrompt({
        type: 'location',
        name: location.name,
        description: location.description,
        style,
        aspectRatio: content.project.brief.aspectRatio,
        extraPrompt: options.instructions,
      }),
      negativePrompt: content.project.brief.negativePrompt,
      tags: ['场景'],
      variants: 1,
    });
  }

  for (const prop of screenplay.props) {
    inputs.push({
      type: 'prop',
      name: prop.name,
      refId: prop.id,
      description: `${prop.category} · ${prop.importance}`,
      prompt: buildAssetImagePrompt({
        type: 'prop',
        name: prop.name,
        description: prop.description,
        style,
        extraPrompt: options.instructions,
      }),
      negativePrompt: content.project.brief.negativePrompt,
      tags: ['道具'],
      variants: 1,
    });
  }

  if (inputs.length === 0) throw new Error('剧本中没有可规划的人物 / 场景 / 道具');
  return replaceAssets(projectId, inputs, { keepGenerated: true });
}

/** 用文本模型优化单个资产的提示词 */
export async function refineAssetPrompt(assetId: string): Promise<Asset> {
  const asset = getAsset(assetId);
  if (!asset) throw new Error(`资产不存在：${assetId}`);
  const project = getProject(asset.projectId);
  const screenplay = getScreenplay(asset.projectId);
  const refNote =
    asset.type === 'character'
      ? screenplay?.characters.find((c) => c.id === asset.refId)
      : asset.type === 'location'
        ? screenplay?.locations.find((l) => l.id === asset.refId)
        : screenplay?.props.find((p) => p.id === asset.refId);

  const { text } = await runText({
    messages: [
      { role: 'system', content: ASSET_PROMPT_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          `资产类型：${asset.type}`,
          `名称：${asset.name}`,
          `设定：${asset.description}`,
          refNote ? `剧本原始设定：${JSON.stringify(refNote)}` : '',
          `项目视觉风格：${project?.brief.style ?? ''}`,
          `画幅：${project?.brief.aspectRatio ?? ''}`,
          `当前提示词：${asset.prompt}`,
          '请在保留设定不变的前提下优化提示词。',
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ],
    json: true,
    temperature: 0.6,
  });

  const parsed = parseWithSchema(imagePromptSchema, extractJson(text), '资产提示词');
  return updateAsset(assetId, {
    prompt: parsed.prompt,
    negativePrompt: parsed.negativePrompt || asset.negativePrompt,
  });
}

/* ============================ 三、分镜 ============================ */

export interface PlanShotsOptions {
  maxShots?: number;
  cameraPreference?: string;
  replaceExisting?: boolean;
  temperature?: number;
}

export async function planShotsFromScreenplay(projectId: string, options: PlanShotsOptions = {}): Promise<Shot[]> {
  const content = loadContent(projectId);
  const screenplay = content.screenplay;
  if (!screenplay) throw new Error('请先生成或填写剧本，再进行分镜拆解');

  const estimated = Math.max(
    1,
    options.maxShots ?? Math.ceil(content.project.brief.targetDurationSec / 5),
  );
  const cameraKeys = BUILTIN_CAMERA_MOVES.map((move) => `${move.key}(${move.name})`).join('、');

  const beatDigest = screenplay.beats
    .map(
      (beat, index) =>
        `${index + 1}. ${beat.title}｜${beat.summary}｜场景：${
          screenplay.locations.find((l) => l.id === beat.locationId)?.name ?? '未指定'
        }｜出场：${beat.characterIds
          .map((id) => screenplay.characters.find((c) => c.id === id)?.name)
          .filter(Boolean)
          .join('/')}｜情绪：${beat.mood}｜约 ${beat.durationSec} 秒`,
    )
    .join('\n');

  const userPrompt = [
    `项目：${content.project.brief.name}（${content.project.brief.genres.join('、')}，${content.project.brief.style}）`,
    `画幅：${content.project.brief.aspectRatio}，目标总时长 ${content.project.brief.targetDurationSec} 秒`,
    `镜头数量上限：${estimated} 个`,
    `可用运镜 key：${cameraKeys}`,
    options.cameraPreference ? `运镜偏好：${options.cameraPreference}` : '',
    '',
    '人物设定：',
    screenplay.characters
      .map((c) => `- ${c.name}（${c.role}）：${c.appearance}；服装：${c.costume}`)
      .join('\n'),
    '',
    '场景设定：',
    screenplay.locations
      .map((l) => `- ${l.name}：${l.description}（${l.interior ? '内景' : '外景'}，${l.timeOfDay}）`)
      .join('\n'),
    '',
    '道具：',
    screenplay.props.map((p) => `- ${p.name}：${p.description}`).join('\n') || '（无）',
    '',
    '剧情节拍：',
    beatDigest,
    '',
    '请输出分镜 JSON（shots 数组）。',
  ]
    .filter((line) => line !== undefined)
    .join('\n');

  const { text } = await runText({
    messages: [
      { role: 'system', content: STORYBOARD_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    json: true,
    temperature: options.temperature ?? 0.7,
    maxTokens: 8000,
  });

  const draft = parseWithSchema(storyboardSchema, extractJson(text), '分镜');

  const inputs: Array<Omit<ShotInput, 'index'>> = draft.shots.map((item) => {
    const beat = screenplay.beats.find((b) => b.title === item.beatTitle);
    const location = item.locationName
      ? screenplay.locations.find((l) => l.name === item.locationName)
      : beat?.locationId
        ? screenplay.locations.find((l) => l.id === beat.locationId)
        : undefined;
    const cameraId = item.cameraKey ? `cam_${item.cameraKey.replace(/^cam_/, '')}` : null;
    const shotSize = SHOT_SIZE_SET.has(item.shotSize) ? (item.shotSize as ShotInput['shotSize']) : '中景';

    return {
      beatId: beat?.id ?? null,
      episode: item.episode,
      description: item.description,
      dialogue: item.dialogue || null,
      narration: item.narration || null,
      durationSec: Math.max(3, Math.min(item.durationSec, 12)),
      shotSize,
      cameraTemplateId: cameraId,
      cameraPrompt: item.cameraPrompt ?? null,
      characterIds: screenplay.characters.filter((c) => item.characterNames.includes(c.name)).map((c) => c.id),
      propIds: screenplay.props.filter((p) => item.propNames.includes(p.name)).map((p) => p.id),
      locationId: location?.id ?? null,
      prompt: item.prompt || item.description,
      negativePrompt: item.negativePrompt || content.project.brief.negativePrompt || null,
      firstFrameMediaId: null,
      lastFrameMediaId: null,
      clipMediaIds: [],
      selectedMediaId: null,
      status: 'pending' as const,
      error: null,
    };
  });

  if (inputs.length === 0) throw new Error('模型未返回任何镜头，请重试或调整剧本');
  return options.replaceExisting
    ? replaceShots(projectId, inputs as ShotInput[])
    : appendShots(projectId, inputs as ShotInput[]);
}
