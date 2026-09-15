import type { PromptTemplate } from '../types/prompt';

/**
 * 内置提示词模板（用户可在「提示词库」中复制后改造为自定义模板）
 */
type BuiltinPrompt = Omit<PromptTemplate, 'id' | 'createdAt' | 'updatedAt' | 'source' | 'useCount' | 'projectId'> & {
  key: string;
};

export const BUILTIN_PROMPT_TEMPLATES: BuiltinPrompt[] = [
  {
    key: 'short-drama-hook',
    category: 'screenplay',
    name: '短剧黄金三秒开头',
    description: '生成抓人的开场钩子，适配抖音/快手短剧节奏。',
    capability: 'text',
    tags: ['短剧', '钩子', '开场'],
    variables: [
      { key: 'genre', label: '题材', example: '都市逆袭' },
      { key: 'protagonist', label: '主角设定', example: '被裁员的外卖员' },
      { key: 'conflict', label: '核心冲突', example: '意外继承公司却遭夺权' },
    ],
    template: `你是爆款短剧编剧。请为「{{genre}}」题材写 3 个黄金三秒开场钩子。
主角设定：{{protagonist}}
核心冲突：{{conflict}}

每个钩子要求：
1. 第一句话就是冲突或反转，禁止铺垫。
2. 3 秒内必须出现视觉冲击（打脸、意外、身份揭露）。
3. 用一句台词 + 一个画面动作描述呈现。
输出格式：序号 + 台词 + 【画面】描述 + 埋下的悬念。`,
  },
  {
    key: 'beat-outline',
    category: 'screenplay',
    name: '节拍表拆解（{{duration}} 秒）',
    description: '把故事拆成符合目标时长的剧情节拍表。',
    capability: 'text',
    tags: ['节拍', '结构'],
    variables: [
      { key: 'story', label: '故事梗概', example: '外卖员继承集团后复仇' },
      { key: 'duration', label: '总时长（秒）', defaultValue: '90' },
      { key: 'style', label: '风格', defaultValue: '写实电影感' },
    ],
    template: `把下面的故事拆解成节拍表，总时长 {{duration}} 秒，视觉风格 {{style}}。
故事：{{story}}

每个节拍包含：标题 / 发生了什么（30 字内）/ 场景 / 出场人物 / 情绪关键词 / 预估秒数。
要求每 2-3 个节拍有一次反转或情绪升级，最后 15 秒必须收束到高潮与结局。`,
  },
  {
    key: 'character-sheet',
    category: 'character',
    name: '人物三视图提示词',
    description: '生成保持角色一致性的三视图提示词。',
    capability: 'image',
    tags: ['人物', '一致性', '三视图'],
    variables: [
      { key: 'name', label: '人物名', example: '林越' },
      { key: 'appearance', label: '外貌', example: '25岁，短发，冷峻眼神' },
      { key: 'costume', label: '服装', example: '黑色西装' },
      { key: 'style', label: '风格', defaultValue: '写实电影感' },
    ],
    template: `character design sheet of {{name}}, {{appearance}}, wearing {{costume}}, front view, side view, back view, full body, neutral pose, clean grey background, consistent facial features, detailed costume, soft studio lighting, {{style}}, high detail, no text, no watermark`,
  },
  {
    key: 'character-expression',
    category: 'character',
    name: '人物表情集提示词',
    description: '为角色生成情绪表情参考。',
    capability: 'image',
    tags: ['人物', '表情'],
    variables: [
      { key: 'name', label: '人物名' },
      { key: 'appearance', label: '外貌' },
      { key: 'style', label: '风格', defaultValue: '写实电影感' },
    ],
    template: `expression sheet of {{name}}, {{appearance}}, 6 headshots in one image: happy, angry, sad, surprised, calm, nervous, same character identity, clean background, soft lighting, {{style}}, no text`,
  },
  {
    key: 'location-establishing',
    category: 'location',
    name: '场景全景提示词',
    description: '生成场景概念图/全景图。',
    capability: 'image',
    tags: ['场景', '全景'],
    variables: [
      { key: 'location', label: '场景描述', example: '深夜的天台' },
      { key: 'mood', label: '氛围', defaultValue: '压抑、孤独' },
      { key: 'style', label: '风格', defaultValue: '写实电影感' },
    ],
    template: `wide establishing shot of {{location}}, {{mood}}, detailed environment, cinematic composition, volumetric light, {{style}}, ultra detailed, no people, no text, no watermark`,
  },
  {
    key: 'prop-shot',
    category: 'prop',
    name: '道具特写提示词',
    description: '生成关键道具展示图。',
    capability: 'image',
    tags: ['道具'],
    variables: [
      { key: 'prop', label: '道具描述', example: '刻着樱花纹的银质怀表' },
      { key: 'style', label: '风格', defaultValue: '写实电影感' },
    ],
    template: `product shot of {{prop}}, centered, floating on dark gradient background, macro detail, material texture visible, rim lighting, {{style}}, no text, no watermark`,
  },
  {
    key: 'shot-video-base',
    category: 'video',
    name: '镜头视频提示词骨架',
    description: '视频模型通用提示词结构，配合运镜模板使用。',
    capability: 'video',
    tags: ['视频', '提示词骨架'],
    variables: [
      { key: 'subject', label: '主体与外貌' },
      { key: 'action', label: '动作' },
      { key: 'environment', label: '环境' },
      { key: 'lighting', label: '光线' },
      { key: 'camera', label: '运镜（英文）' },
      { key: 'style', label: '风格' },
    ],
    template: `{{subject}}, {{action}}, {{environment}}, {{lighting}}, {{camera}}, {{style}}, consistent character identity, natural motion, film grain, no text, no watermark`,
  },
  {
    key: 'negative-standard',
    category: 'negative',
    name: '通用负向提示词',
    description: '画面质量与合规通用负向词。',
    capability: 'image',
    tags: ['负向'],
    variables: [],
    template:
      'lowres, blurry, jpeg artifacts, watermark, signature, text, subtitles, logo, extra fingers, extra limbs, deformed hands, bad anatomy, disfigured face, duplicate character, flickering, distorted face, cartoon artifacts',
  },
  {
    key: 'style-suffix-realism',
    category: 'style',
    name: '风格后缀 · 写实电影感',
    description: '追加到图片/视频提示词尾部，统一画面风格。',
    capability: 'image',
    tags: ['风格'],
    variables: [],
    template:
      'cinematic realism, shot on ARRI Alexa, 35mm anamorphic lens, shallow depth of field, natural color grading, film grain, high dynamic range, photorealistic',
  },
  {
    key: 'style-suffix-anime',
    category: 'style',
    name: '风格后缀 · 日系赛璐璐动漫',
    description: '追加到图片/视频提示词尾部，统一画面风格。',
    capability: 'image',
    tags: ['风格'],
    variables: [],
    template:
      'japanese cel-shaded anime style, clean line art, vivid flat colors, dramatic lighting, key visual quality, studio anime production, detailed background art',
  },
  {
    key: 'style-suffix-guofeng',
    category: 'style',
    name: '风格后缀 · 国风工笔',
    description: '追加到图片/视频提示词尾部，统一画面风格。',
    capability: 'image',
    tags: ['风格'],
    variables: [],
    template:
      'chinese gongbi painting style, ink wash texture, elegant gold and jade palette, traditional costume details, misty layered composition, refined brushwork',
  },
  {
    key: 'camera-custom-hint',
    category: 'camera',
    name: '自定义运镜描述公式',
    description: '写自定义运镜英文提示词时的公式模板。',
    capability: 'video',
    tags: ['运镜', '公式'],
    variables: [
      { key: 'speed', label: '速度', defaultValue: 'slow' },
      { key: 'move', label: '运动方式', defaultValue: 'dolly in' },
      { key: 'subject', label: '目标主体', defaultValue: 'the character face' },
    ],
    template: `{{speed}} {{move}} toward {{subject}}, smooth stabilized movement, consistent framing, cinematic camera language`,
  },
];

export function builtinPromptTemplates(): PromptTemplate[] {
  const now = new Date(0).toISOString();
  return BUILTIN_PROMPT_TEMPLATES.map((item) => ({
    id: `tpl_${item.key}`,
    source: 'builtin' as const,
    category: item.category,
    name: item.name,
    description: item.description,
    template: item.template,
    variables: item.variables,
    capability: item.capability,
    tags: item.tags,
    useCount: 0,
    projectId: null,
    createdAt: now,
    updatedAt: now,
  }));
}
