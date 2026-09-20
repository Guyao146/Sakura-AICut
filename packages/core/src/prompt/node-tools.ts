/**
 * 画布节点工具（⑥，对齐小云雀节点工具栏）
 *
 * 这些是纯提示词构建函数：把用户的轻量参数转成送给模型的提示词，
 * 由 pipeline 层调用，不在客户端执行。
 */

/** 光照方向 */
export const LIGHT_DIRECTIONS = ['正面光', '侧光', '逆光', '顶光', '底光', '伦勃朗光'] as const;
export type LightDirection = (typeof LIGHT_DIRECTIONS)[number];

export const LIGHT_QUALITIES = ['柔和', '硬朗', '漫射', '霓虹'] as const;
export type LightQuality = (typeof LIGHT_QUALITIES)[number];

export const LIGHT_TONES = ['暖调', '冷调', '青橙调', '黑白高反差'] as const;
export type LightTone = (typeof LIGHT_TONES)[number];

/** 智能打光：光源方向 + 质感 + 色调 */
export function buildLightingPrompt(input: {
  direction: LightDirection;
  quality?: LightQuality;
  tone?: LightTone;
}): string {
  const dirMap: Record<LightDirection, string> = {
    正面光: 'front lighting, even key light on the subject',
    侧光: 'dramatic side lighting, strong chiaroscuro, half-lit face',
    逆光: 'backlighting, rim light, silhouette glow, lens flare',
    顶光: 'top down lighting, spotlight effect, moody shadows',
    底光: 'underlighting, eerie horror-style upward glow',
    伦勃朗光: 'Rembrandt lighting, triangle highlight on cheek, classic portrait',
  };
  const qualMap: Record<LightQuality, string> = {
    柔和: 'soft diffused light',
    硬朗: 'hard directional light with sharp shadows',
    漫射: 'overcast diffused ambient light',
    霓虹: 'neon colored lighting, magenta and cyan accents',
  };
  const toneMap: Record<LightTone, string> = {
    暖调: 'warm color temperature, golden tones',
    冷调: 'cool color temperature, blue tones',
    青橙调: 'teal and orange cinematic color grading',
    '黑白高反差': 'high contrast black and white',
  };
  return [
    dirMap[input.direction],
    input.quality ? qualMap[input.quality] : '',
    input.tone ? toneMap[input.tone] : '',
    'cinematic lighting design, professional key and fill setup',
  ]
    .filter(Boolean)
    .join(', ');
}

/** 取景方向 + 景别 → 镜头调节提示词 */
export function buildCameraAnglePrompt(input: {
  angle: '平视' | '俯拍' | '仰拍' | '过肩' | '倾斜';
  shotSize?: string;
}): string {
  const angleMap: Record<typeof input.angle, string> = {
    平视: 'eye-level shot, neutral perspective',
    俯拍: 'high angle shot, looking down at the subject',
    仰拍: 'low angle shot, looking up, imposing perspective',
    过肩: 'over-the-shoulder shot, two-person framing',
    倾斜: 'dutch angle, tilted horizon, uneasy mood',
  };
  return [input.shotSize ? `${input.shotSize} framing` : '', angleMap[input.angle]]
    .filter(Boolean)
    .join(', ');
}

/** 提示词反解析：图片/视频 → 提示词（给视觉模型的指令） */
export const REVERSE_PARSE_PROMPT = `Analyze this image in detail and output a reusable text-to-image prompt in English.
Include: subject description, composition and shot size, lighting, color palette, art style, atmosphere, and camera details.
Output only the prompt, no explanation.`;

/** 全景图：720° 全景预览，可任意角度截图 */
export function buildPanoramaPrompt(basePrompt: string): string {
  return `${basePrompt}, 360 degree panoramic view, equirectangular panorama, immersive environment, seamless stitching`;
}

/** 涂鸦画笔：把圈选位置并入提示词 */
export function buildDoodlePrompt(basePrompt: string, hint: string): string {
  return `${basePrompt}. ${hint}. keep the rest of the composition unchanged, only modify the circled area`;
}
