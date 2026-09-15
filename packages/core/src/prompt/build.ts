import type { AspectRatio } from '../types/common';
import type { Character, SceneLocation } from '../types/screenplay';
import type { AssetType } from '../types/asset';
import type { Shot } from '../types/shot';
import { joinPrompt } from '../utils/text';

/**
 * 提示词拼装器：把结构化数据（人物卡/场景卡/镜头）拼成送给模型的提示词
 * 规则统一放在这里，保证「资产图」与「镜头视频」的画风一致
 */

const STYLE_SUFFIX: Record<string, string> = {
  写实电影感:
    'cinematic realism, photorealistic, shot on ARRI Alexa, 35mm anamorphic lens, shallow depth of field, natural color grading, subtle film grain, high dynamic range',
  日系赛璐璐动漫:
    'japanese cel-shaded anime style, clean line art, vivid flat colors, dramatic rim lighting, key visual quality, detailed background art',
  国风工笔:
    'chinese gongbi painting style, fine ink lines, mineral pigment colors, elegant gold and jade palette, traditional costume details, misty layered composition',
  '3D 皮克斯质感':
    'stylized 3D animation render, pixar-like character design, subsurface scattering skin, soft studio lighting, vibrant colors, octane render quality',
  国潮水墨:
    'modern chinese ink wash illustration, splash ink texture, negative space composition, red and black accents, poetic atmosphere',
  赛博朋克霓虹:
    'cyberpunk aesthetic, neon signage, rain-slicked streets, high contrast magenta and cyan lighting, volumetric fog, blade runner mood',
  美漫硬朗线条:
    'american comic style, bold ink outlines, high contrast cel shading, dynamic composition, halftone texture, graphic novel quality',
  '复古胶片 35mm':
    'vintage 35mm film look, kodak portra color science, visible grain, halation on highlights, soft contrast, nostalgic tone',
  唯美韩剧柔光:
    'korean drama cinematography, dreamy soft focus, pastel color grading, gentle backlight, airy atmosphere, romantic mood',
  黑白纪实:
    'black and white documentary photography, high contrast monochrome, available light, gritty realism, street photography feel',
};

export function styleSuffix(style: string | undefined): string {
  if (!style) return STYLE_SUFFIX['写实电影感'] ?? '';
  return STYLE_SUFFIX[style] ?? style;
}

/** 画幅 → 构图提示 */
export function framingHint(aspectRatio: AspectRatio | string): string {
  switch (aspectRatio) {
    case '9:16':
      return 'vertical 9:16 composition, centered subject, background upper and lower negative space for subtitles';
    case '16:9':
      return 'horizontal 16:9 cinematic composition, rule of thirds, wide framing';
    case '21:9':
      return 'ultra wide 21:9 anamorphic composition, epic scale, cinematic letterbox framing';
    case '1:1':
      return 'square 1:1 composition, centered subject';
    case '4:3':
      return '4:3 classic composition, balanced framing';
    case '3:4':
      return '3:4 portrait composition, subject centered vertically';
    default:
      return 'balanced cinematic composition';
  }
}

export function characterDescriptor(character: Character): string {
  return `${character.name} (${character.gender}, ${character.age}), ${character.appearance}, wearing ${character.costume}`;
}

export function locationDescriptor(location: SceneLocation): string {
  return `${location.name}, ${location.interior ? 'interior' : 'exterior'}, ${location.timeOfDay}, ${location.description}, atmosphere: ${location.atmosphere}`;
}

/** 资产图提示词（第三步） */
export function buildAssetImagePrompt(input: {
  type: AssetType;
  name: string;
  description?: string;
  extraPrompt?: string;
  style?: string;
  aspectRatio?: AspectRatio | string;
  view?: 'three-view' | 'expression' | 'multi-angle' | 'keyframe' | 'reference';
}): string {
  const { type, name, description, extraPrompt, style, aspectRatio = '1:1', view = 'reference' } = input;
  const viewHint: Record<string, string> = {
    'three-view':
      'character design sheet, front view, side view, back view, full body, neutral pose, clean grey background',
    expression: 'expression sheet, 6 headshots in one image showing different emotions, same character identity',
    'multi-angle': 'multi angle reference sheet, 4 views of the same subject, consistent design',
    keyframe: 'cinematic keyframe, medium shot, storytelling composition',
    reference: 'reference sheet, clear presentation of the subject',
  };

  if (type === 'character') {
    return joinPrompt([
      viewHint[view],
      name,
      description,
      'consistent facial features, consistent costume design across views',
      extraPrompt,
      framingHint(aspectRatio),
      styleSuffix(style),
      'no text, no watermark, no logo',
    ]);
  }
  if (type === 'location') {
    return joinPrompt([
      view === 'keyframe' ? 'cinematic keyframe of the location' : 'wide establishing shot',
      name,
      description,
      'detailed environment design, consistent architecture across angles',
      extraPrompt,
      framingHint(aspectRatio),
      styleSuffix(style),
      'no people, no text, no watermark',
    ]);
  }
  return joinPrompt([
    'product shot, centered, floating on dark gradient background',
    name,
    description,
    'macro detail, material and texture visible, rim lighting',
    extraPrompt,
    framingHint(aspectRatio),
    styleSuffix(style),
    'no text, no watermark',
  ]);
}

/** 分镜首帧图提示词（用于图生视频的首帧） */
export function buildShotImagePrompt(input: {
  shot: Pick<Shot, 'description' | 'shotSize' | 'prompt' | 'dialogue'>;
  characters?: Character[];
  location?: SceneLocation | null;
  style?: string;
  aspectRatio?: AspectRatio | string;
  referenceNotes?: string[];
}): string {
  const { shot, characters = [], location, style, aspectRatio = '9:16', referenceNotes = [] } = input;
  const sizeMap: Record<string, string> = {
    大远景: 'extreme wide shot',
    远景: 'wide shot',
    全景: 'full shot',
    中景: 'medium shot',
    中近景: 'medium close-up',
    近景: 'close-up',
    特写: 'close-up, detailed face',
    大特写: 'extreme close-up',
    过肩: 'over the shoulder shot',
    主观视角: 'first person POV',
  };
  return joinPrompt([
    sizeMap[shot.shotSize] ?? 'medium shot',
    shot.description,
    characters.length > 0 ? `characters: ${characters.map(characterDescriptor).join('; ')}` : '',
    location ? `location: ${locationDescriptor(location)}` : '',
    shot.prompt,
    ...referenceNotes,
    framingHint(aspectRatio),
    styleSuffix(style),
    'consistent character identity, cinematic lighting, no text, no watermark, no subtitles',
  ]);
}

/** 镜头视频提示词（第四步） */
export function buildShotVideoPrompt(input: {
  shot: Pick<Shot, 'description' | 'shotSize' | 'prompt' | 'dialogue' | 'narration' | 'durationSec'>;
  cameraPrompt?: string | null;
  characters?: Character[];
  location?: SceneLocation | null;
  style?: string;
  aspectRatio?: AspectRatio | string;
  extraNotes?: string[];
  hasFirstFrame?: boolean;
}): string {
  const {
    shot,
    cameraPrompt,
    characters = [],
    location,
    style,
    aspectRatio = '9:16',
    extraNotes = [],
    hasFirstFrame = false,
  } = input;

  return joinPrompt([
    hasFirstFrame ? 'animate the provided first frame, keep subject identity consistent' : '',
    shot.prompt || shot.description,
    characters.length > 0 ? `characters: ${characters.map(characterDescriptor).join('; ')}` : '',
    location ? `environment: ${locationDescriptor(location)}` : '',
    cameraPrompt ? `camera: ${cameraPrompt}` : '',
    `duration ${shot.durationSec} seconds, single continuous action, no scene change`,
    shot.narration ? `sound hint: ${shot.narration}` : '',
    ...extraNotes,
    framingHint(aspectRatio),
    styleSuffix(style),
    'natural physics, stable identity, no text, no watermark, no subtitles, no logo',
  ]);
}

