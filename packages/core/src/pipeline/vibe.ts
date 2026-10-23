import { z } from 'zod';
import { ASPECT_RATIOS } from '../types/common';
import type { ProjectBrief, VibeProtocolMeta, VibeScript } from '../types/project';

export const VIBE_DEFAULT_FPS = 24;
export const VIBE_MAX_FRAMES = 3600;
export const VIBE_MAX_DURATION = 150;
export const VIBE_MAX_CODE_LENGTH = 256_000;
export const VIBE_STYLES = ['动态图形', '几何叙事', '文字动画', '水墨意境', '霓虹粒子'] as const;

export const vibeTopicSchema = z.string().trim().min(1, '请填写创作主题').max(500);
export const vibeInstructionsSchema = z.string().trim().max(2000).default('');
export const vibeCreateSchema = z.object({
  name: z.string().trim().max(120).default(''),
  topic: vibeTopicSchema,
  style: z.string().trim().min(1).max(120).default(VIBE_STYLES[0]),
  aspectRatio: z.enum(['9:16', '16:9', '1:1', '4:3', '3:4', '21:9']).default('9:16'),
  targetDurationSec: z.number().int().min(3).max(VIBE_MAX_DURATION).default(30),
}).strict();

export const vibeScriptSchema = z.object({
  shots: z.array(z.object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    index: z.number().int().min(1),
    durationSec: z.number().min(0.1).max(60),
    visualDescription: z.string().trim().min(1).max(3000),
    narration: z.string().max(500).default(''),
    cameraMotion: z.string().max(120).optional(),
    mood: z.string().max(120).optional(),
  }).strict()).min(1).max(40),
}).strict().superRefine((script, ctx) => {
  if (new Set(script.shots.map((shot) => shot.id)).size !== script.shots.length) {
    ctx.addIssue({ code: 'custom', path: ['shots'], message: '场次 ID 不能重复' });
  }
  if (script.shots.some((shot, i) => shot.index !== i + 1)) {
    ctx.addIssue({ code: 'custom', path: ['shots'], message: '场次序号必须从 1 连续递增' });
  }
  if (vibeScriptDuration(script) > VIBE_MAX_DURATION) {
    ctx.addIssue({ code: 'custom', path: ['shots'], message: `总时长不能超过 ${VIBE_MAX_DURATION} 秒` });
  }
});
export type VibeScriptDraft = z.infer<typeof vibeScriptSchema>;

export const vibeDubbingSchema = z.object({
  enabled: z.boolean().default(false),
  voice: z.string().trim().max(120).default(''),
  speed: z.number().min(0.25).max(4).default(1),
  volume: z.number().min(0.1).max(2).default(1),
  pitch: z.number().int().min(-12).max(12).default(0),
  music: z.object({
    mediaId: z.string().regex(/^med_[a-zA-Z0-9_-]+$/),
    name: z.string().trim().min(1).max(200),
    volume: z.number().min(0).max(1).default(0.2),
    loop: z.boolean().default(true),
  }).strict().optional(),
}).strict();

export const vibeJobPayloadSchema = z.object({
  revision: z.number().int().nonnegative(),
  topic: vibeTopicSchema.optional(),
  instructions: vibeInstructionsSchema,
  // 兼容旧队列字段：只继续生成代码，不再自动导出。
  autoRender: z.boolean().default(false),
  autoCode: z.boolean().default(false),
  confirmedRevision: z.number().int().nonnegative().optional(),
}).strict();
export type VibeJobPayload = z.infer<typeof vibeJobPayloadSchema>;

export const vibeMetaSchema = z.object({
  durationSec: z.number().positive().max(VIBE_MAX_DURATION),
  fps: z.number().int().min(1).max(60),
  width: z.number().int().min(64).max(2560).multipleOf(2),
  height: z.number().int().min(64).max(2560).multipleOf(2),
}).strict().refine((meta) => meta.width * meta.height <= 2_764_800, '画面像素数超过上限')
  .refine((meta) => Math.ceil(meta.durationSec * meta.fps - 1e-8) <= VIBE_MAX_FRAMES, '总帧数超过上限，不能截断导出');

export function vibeScriptDuration(script: VibeScript | null): number {
  return script ? script.shots.reduce((sum, shot) => sum + shot.durationSec, 0) : 0;
}

export function vibeMetaFor(brief: ProjectBrief, script: VibeScript): VibeProtocolMeta {
  const aspect = ASPECT_RATIOS[brief.aspectRatio];
  if (!aspect) throw new Error('不支持的画幅比例');
  return vibeMetaSchema.parse({
    width: aspect.width, height: aspect.height, fps: VIBE_DEFAULT_FPS,
    durationSec: vibeScriptDuration(vibeScriptSchema.parse(script)),
  });
}

/** 元信息来自不可信页面；拒绝越界，而非静默截断或更改帧率。 */
export function planVibeFrames(input: VibeProtocolMeta): { times: number[]; fps: number } {
  const meta = vibeMetaSchema.parse(input);
  const count = Math.ceil(meta.durationSec * meta.fps - 1e-8);
  return { times: Array.from({ length: count }, (_, i) => i / meta.fps), fps: meta.fps };
}

export function extractHtmlDocument(text: string): string {
  const trimmed = text.trim();
  const source = trimmed.replace(/^```(?:html)?\s*\n?/i, '').replace(/\n?```\s*$/, '').trim();
  const start = source.search(/<!doctype\s+html\s*>|<html[\s>]/i);
  const end = source.toLowerCase().lastIndexOf('</html>');
  return start >= 0 && end >= start ? source.slice(start, end + 7) : source;
}

/** 仅作格式与大小检查；执行安全由浏览器沙箱、网络隔离与超时共同保证。 */
export function assertProtocolStub(code: string): void {
  if (typeof code !== 'string' || code.length > VIBE_MAX_CODE_LENGTH) throw new Error('动画代码过大');
  if (!/^\s*(?:<!doctype\s+html\s*>\s*)?<html[\s>]/i.test(code) || !/<\/html>\s*$/i.test(code)) {
    throw new Error('请提供完整的 HTML 文档');
  }
  if (!code.includes('__vibeSeek') || !code.includes('__vibeMeta')) {
    throw new Error('页面必须包含寻帧函数 __vibeSeek 与元信息 __vibeMeta');
  }
}
