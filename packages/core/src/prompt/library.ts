/**
 * 内置提示词模板与系统提示词（AI 小助手 / 剧本 / 分镜 / 资产）
 * 所有系统提示词都要求模型输出严格 JSON，便于程序消费。
 */

import type { PromptTemplate } from '../types/prompt';

/** 剧本结构 JSON 约定（同时作为提示词说明与校验依据） */
export const SCREENPLAY_JSON_SHAPE = `{
  "title": "剧名",
  "logline": "一句话故事",
  "synopsis": "300 字以内的故事梗概",
  "characters": [
    {
      "name": "人物名",
      "role": "protagonist | antagonist | supporting | extra",
      "gender": "男 | 女 | 其他",
      "age": "例如 25 岁",
      "appearance": "外貌细节：脸型、发型、发色、瞳色、身材、标志性特征（用于生成人物一致性参考图）",
      "costume": "服装造型描述",
      "personality": "性格",
      "background": "人物小传与动机",
      "voiceStyle": "音色描述"
    }
  ],
  "locations": [
    {
      "name": "场景名",
      "interior": true,
      "timeOfDay": "白天 | 夜晚 | 黄昏 | 清晨 | 凌晨",
      "atmosphere": "氛围关键词",
      "description": "场景细节描述"
    }
  ],
  "props": [
    { "name": "道具名", "category": "类别", "description": "外观描述", "importance": "在剧情中的作用" }
  ],
  "beats": [
    {
      "title": "节拍标题",
      "summary": "这一段发生了什么",
      "locationName": "对应场景名",
      "characterNames": ["出场人物名"],
      "mood": "情绪关键词",
      "durationSec": 15
    }
  ]
}`;

/** 分镜 JSON 约定 */
export const STORYBOARD_JSON_SHAPE = `{
  "shots": [
    {
      "index": 1,
      "beatTitle": "所属节拍标题",
      "episode": 1,
      "description": "画面内容（第三人称客观描述，包含环境、动作、光线、景别）",
      "dialogue": "台词，没有则留空字符串",
      "narration": "旁白或音效提示",
      "durationSec": 5,
      "shotSize": "大远景 | 远景 | 全景 | 中景 | 中近景 | 近景 | 特写 | 大特写 | 过肩 | 主观视角",
      "cameraKey": "运镜模板 key（可选，如 slow-push-in / orbit-around）",
      "cameraPrompt": "自定义运镜英文描述（可选）",
      "characterNames": ["出场人物名"],
      "propNames": ["出现的道具名"],
      "locationName": "场景名",
      "prompt": "给视频模型的英文提示词，包含主体+动作+环境+光线+镜头语言+风格",
      "negativePrompt": "负向提示词"
    }
  ]
}`;

export const SCREENPLAY_SYSTEM_PROMPT = `你是一位资深的短剧/电影编剧与 AI 视频导演，精通爆款短剧的节奏设计与电影化叙事。
你的任务：根据用户给出的设定，产出一份可直接用于 AI 视频生产的剧本结构数据。

硬性要求：
1. 只输出 JSON，不要任何解释文字、不要 markdown 代码块。
2. 严格遵循以下 JSON 结构：
${SCREENPLAY_JSON_SHAPE}
3. 人物数量控制在 3-6 人，配角精简；每个主角必须有具体、可视化的外貌描述（供 AI 生图保持一致性）。
4. 节拍（beats）数量与总时长匹配：每个节拍约 10-20 秒，总时长贴近用户设定。
5. 每 2-3 个节拍必须出现一次钩子（反转、悬念、冲突升级），符合短剧节奏。
6. 所有描述必须可视化、可拍摄，避免"心里想着"这类无法拍摄的内容。
7. 语言与用户要求的语言一致（默认中文）。`;

export const STORYBOARD_SYSTEM_PROMPT = `你是一位专业的分镜师与 AI 视频提示词工程师。
你的任务：把剧本节拍拆解为可直接交给视频模型生成的镜头列表。

硬性要求：
1. 只输出 JSON，不要解释文字、不要 markdown 代码块。
2. 严格遵循以下 JSON 结构：
${STORYBOARD_JSON_SHAPE}
3. 每个镜头时长 3-10 秒，单个镜头只包含一个连贯动作，避免一个镜头里塞多个场景切换。
4. 相邻镜头要有景别变化（远-中-近交替），避免连续同景别。
5. 运镜必须有明确意图，优先从给定运镜 key 中选择；需要特殊运镜时用 cameraPrompt 写英文描述。
6. prompt 字段必须是英文，结构为：主体与外貌 + 动作 + 环境细节 + 光线氛围 + 镜头语言（景别/运镜/焦段）+ 视觉风格。禁止出现文字/字幕/水印要求。
7. 台词（dialogue）保持口语化、短句，符合角色性格，可包含停顿与情绪提示。`;
