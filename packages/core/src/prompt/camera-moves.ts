import type { CameraMoveTemplate } from '../types/shot';

/**
 * 内置运镜模板库（第四步可一键套用，也可让用户在项目里新增自定义运镜）
 * prompt 为英文，直接拼接到视频模型提示词中（多数视频模型对英文运镜描述更敏感）
 */
type BuiltinCamera = Omit<CameraMoveTemplate, 'id' | 'createdAt' | 'updatedAt' | 'source' | 'tags'> & { key: string };

export const BUILTIN_CAMERA_MOVES: BuiltinCamera[] = [
  {
    key: 'static',
    name: '固定镜头',
    category: '固定',
    description: '三脚架固定，画面静止，适合情绪戏与台词戏。',
    prompt: 'static camera, locked-off shot, no camera movement, steady tripod',
    usage: '对话、独白、情绪特写',
    frameMode: 'none',
  },
  {
    key: 'slow-push-in',
    name: '缓慢推镜',
    category: '推拉',
    description: '缓慢靠近主体，强化情绪递进与代入感。',
    prompt: 'slow dolly in, gentle push toward the subject, gradual close-up, smooth movement',
    usage: '情绪升级、发现真相',
    frameMode: 'none',
  },
  {
    key: 'fast-push-in',
    name: '急速推镜',
    category: '推拉',
    description: '快速推近，制造冲击与惊吓感。',
    prompt: 'fast dolly in with quick zoom, sudden push to close-up, dramatic impact',
    usage: '惊吓、震撼瞬间',
    frameMode: 'none',
  },
  {
    key: 'pull-out',
    name: '拉镜',
    category: '推拉',
    description: '由近及远拉开，交代环境或制造孤独感。',
    prompt: 'slow dolly out, camera pulls back to reveal the environment, wide shot ending',
    usage: '结尾、交代场景全貌',
    frameMode: 'none',
  },
  {
    key: 'zoom-in',
    name: '变焦推进',
    category: '推拉',
    description: '机位不动、焦段变化，压缩空间强化表情。',
    prompt: 'smooth optical zoom in, focal length change, background compression',
    usage: '表情特写、心理暗示',
    frameMode: 'none',
  },
  {
    key: 'pan-left-right',
    name: '左右摇镜',
    category: '摇移',
    description: '水平摇摄，横向扫过场景或人物。',
    prompt: 'horizontal pan from left to right, smooth tripod pan, reveal scene gradually',
    usage: '交代空间、展示群像',
    frameMode: 'none',
  },
  {
    key: 'tilt-up-down',
    name: '上下摇镜',
    category: '摇移',
    description: '垂直摇摄，从下往上或从上往下扫过主体。',
    prompt: 'vertical tilt up along the subject, slow reveal from feet to face',
    usage: '人物出场、气势塑造',
    frameMode: 'none',
  },
  {
    key: 'tracking-follow',
    name: '跟拍',
    category: '跟随',
    description: '镜头跟随人物移动，保持主体在画面中。',
    prompt: 'tracking shot following the character, camera moves with subject, steady gimbal',
    usage: '行走、奔跑、追逐',
    frameMode: 'none',
  },
  {
    key: 'handheld-follow',
    name: '手持跟拍',
    category: '跟随',
    description: '轻微晃动的手持感，纪实与紧张氛围。',
    prompt: 'handheld follow shot with subtle shake, documentary style, dynamic movement',
    usage: '冲突、紧张场面',
    frameMode: 'none',
  },
  {
    key: 'orbit-around',
    name: '环绕运镜',
    category: '环绕',
    description: '围绕主体环绕拍摄，突出立体感与仪式感。',
    prompt: 'camera orbits around the subject, 180 degree arc, smooth circular motion',
    usage: '高光时刻、英雄登场',
    frameMode: 'none',
  },
  {
    key: 'crane-up',
    name: '升镜 / 摇臂上升',
    category: '升降',
    description: '机位升高俯视，营造宏大与释然。',
    prompt: 'crane shot rising upward, high angle reveal, epic scale',
    usage: '结局、场面调度',
    frameMode: 'none',
  },
  {
    key: 'drone-aerial',
    name: '航拍俯瞰',
    category: '升降',
    description: '高空俯拍，交代地理与规模。',
    prompt: 'aerial drone shot, high altitude, sweeping landscape reveal',
    usage: '开场、转场',
    frameMode: 'none',
  },
  {
    key: 'dolly-zoom',
    name: '希区柯克变焦',
    category: '特殊',
    description: '推轨同时反向变焦，背景扭曲，表现眩晕与心理冲击。',
    prompt: 'dolly zoom, vertigo effect, background distortion while subject stays same size',
    usage: '震惊、心理崩塌',
    frameMode: 'none',
  },
  {
    key: 'whip-pan',
    name: '甩镜转场',
    category: '特殊',
    description: '快速甩动镜头制造动势转场。',
    prompt: 'whip pan transition, fast horizontal motion blur, seamless cut',
    usage: '段落转场',
    frameMode: 'none',
  },
  {
    key: 'pov',
    name: '主观视角',
    category: '特殊',
    description: '第一人称视角推进，增强沉浸体验。',
    prompt: 'first person POV camera, immersive perspective, camera as character eyes',
    usage: '沉浸叙事、VR 感',
    frameMode: 'none',
  },
  {
    key: 'slow-motion',
    name: '升格慢动作',
    category: '特殊',
    description: '高速摄影慢放，强调瞬间细节。',
    prompt: 'slow motion, high frame rate 120fps, time dilation emphasis',
    usage: '动作高光、情感定格',
    frameMode: 'none',
  },
  {
    key: 'first-last-frame',
    name: '首尾帧过渡',
    category: '特殊',
    description: '给定首帧与尾帧，让模型补全中间的运动。',
    prompt: 'smooth transition between the provided first frame and last frame, continuous motion',
    usage: '动作衔接、变装转场',
    frameMode: 'start-end',
  },
  {
    key: 'rack-focus',
    name: '移焦',
    category: '特殊',
    description: '焦点在前后景之间转移，引导注意力。',
    prompt: 'rack focus, shallow depth of field, focus shift from foreground to background',
    usage: '揭示线索、双人对话',
    frameMode: 'none',
  },
];

/** 转成带 id 的模板对象（id 稳定，便于项目引用） */
export function builtinCameraMoves(): CameraMoveTemplate[] {
  const now = new Date(0).toISOString();
  return BUILTIN_CAMERA_MOVES.map((item) => ({
    id: `cam_${item.key}`,
    source: 'builtin' as const,
    name: item.name,
    category: item.category,
    description: item.description,
    prompt: item.prompt,
    usage: item.usage,
    frameMode: item.frameMode,
    params: item.params,
    projectId: null,
    tags: ['内置', item.category],
    createdAt: now,
    updatedAt: now,
  }));
}

export function findCameraMove(id: string): CameraMoveTemplate | undefined {
  return builtinCameraMoves().find((move) => move.id === id);
}
