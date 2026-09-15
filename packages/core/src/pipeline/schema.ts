import { z } from 'zod';

/**
 * 模型结构化输出的校验 Schema（zod v4）
 * 用于校验「剧本 JSON」「分镜 JSON」「资产计划 JSON」等由 LLM 返回的数据
 */

export const characterSchema = z.object({
  name: z.string().min(1),
  role: z.enum(['protagonist', 'antagonist', 'supporting', 'extra']).default('supporting'),
  gender: z.string().default('未知'),
  age: z.string().default('未知'),
  appearance: z.string().default(''),
  costume: z.string().default(''),
  personality: z.string().default(''),
  background: z.string().default(''),
  voiceStyle: z.string().optional(),
  aliases: z.array(z.string()).optional(),
});

export const locationSchema = z.object({
  name: z.string().min(1),
  interior: z.boolean().default(false),
  timeOfDay: z.string().default('不限'),
  atmosphere: z.string().default(''),
  description: z.string().default(''),
});

export const propSchema = z.object({
  name: z.string().min(1),
  category: z.string().default('其它'),
  description: z.string().default(''),
  importance: z.string().default(''),
});

export const beatSchema = z.object({
  title: z.string().min(1),
  summary: z.string().default(''),
  locationName: z.string().optional(),
  characterNames: z.array(z.string()).default([]),
  mood: z.string().default(''),
  durationSec: z.coerce.number().positive().default(15),
});

export const screenplaySchema = z.object({
  title: z.string().default('未命名剧本'),
  logline: z.string().default(''),
  synopsis: z.string().default(''),
  characters: z.array(characterSchema).min(1),
  locations: z.array(locationSchema).default([]),
  props: z.array(propSchema).default([]),
  beats: z.array(beatSchema).min(1),
});

export const shotSchema = z.object({
  index: z.coerce.number().int().nonnegative().optional(),
  beatTitle: z.string().optional(),
  episode: z.coerce.number().int().positive().default(1),
  description: z.string().min(1),
  dialogue: z.string().optional().default(''),
  narration: z.string().optional().default(''),
  durationSec: z.coerce.number().positive().max(30).default(5),
  shotSize: z.string().default('中景'),
  cameraKey: z.string().optional(),
  cameraPrompt: z.string().optional(),
  characterNames: z.array(z.string()).default([]),
  propNames: z.array(z.string()).default([]),
  locationName: z.string().optional(),
  prompt: z.string().default(''),
  negativePrompt: z.string().optional().default(''),
});

export const storyboardSchema = z.object({
  shots: z.array(shotSchema).min(1),
});

/** Agent 规划 JSON */
export const planDraftSchema = z.object({
  summary: z.string().default(''),
  question: z.string().optional(),
  steps: z
    .array(
      z.object({
        title: z.string().min(1),
        rationale: z.string().default(''),
        tool: z.string().min(1),
        args: z.record(z.string(), z.unknown()).default({}),
        needsApproval: z.boolean().optional(),
        estimatedCost: z.string().optional(),
      }),
    )
    .min(1),
});

/** 资产计划（Agent / 第三步使用） */
export const assetPlanSchema = z.object({
  assets: z
    .array(
      z.object({
        type: z.enum(['character', 'location', 'prop', 'style', 'other']).default('character'),
        name: z.string().min(1),
        description: z.string().default(''),
        prompt: z.string().default(''),
        negativePrompt: z.string().optional().default(''),
        variants: z.coerce.number().int().min(1).max(6).default(1),
      }),
    )
    .min(1),
});

/** 图片提示词生成结果 */
export const imagePromptSchema = z.object({
  prompt: z.string().min(1),
  negativePrompt: z.string().optional().default(''),
});

export type ScreenplayDraft = z.infer<typeof screenplaySchema>;
export type StoryboardDraft = z.infer<typeof storyboardSchema>;
export type AssetPlanDraft = z.infer<typeof assetPlanSchema>;

/** 校验并返回带默认值的对象；失败时抛出可读错误 */
export function parseWithSchema<T extends z.ZodTypeAny>(schema: T, data: unknown, label: string): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`${label} 数据校验失败：${issues}`);
  }
  return result.data;
}
