import { z } from 'zod';
import { ASPECT_RATIOS, LANGUAGE_LABELS, type AspectRatio, type Language } from '@sakura/core';

const httpUrl = z.string().max(2048).url().refine((value) => {
  const url = new URL(value);
  return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
});
export const provenanceSchema = z.object({
  producer: z.literal('SakuraSeeking'), schemaVersion: z.literal('1.0'), createdAt: z.string().datetime({ offset: true }),
  keyword: z.string().min(1).max(40), generator: z.enum(['template', 'model']), reviewRequired: z.literal(true),
  source: z.object({ id: z.string().min(1).max(100), title: z.string().min(1).max(80), sourceName: z.string().min(1).max(80),
    platform: z.string().min(1).max(40).optional(), sourceUrl: httpUrl.optional(), observedAt: z.string().datetime({ offset: true }).optional(), kind: z.enum(['demo', 'sourced']),
  }).strict(),
}).strict().superRefine((value, ctx) => {
  if (value.source.kind === 'sourced' && (!value.source.sourceUrl || !value.source.observedAt)) ctx.addIssue({ code: 'custom', message: '真实来源必须包含 URL 和采集时间' });
  if (value.source.observedAt && Date.parse(value.source.observedAt) > Date.now() + 300_000) ctx.addIssue({ code: 'custom', message: '采集时间不可位于未来' });
});
export const openProjectSchema = z.object({ name: z.string().trim().min(1).max(120), brief: z.object({
  logline: z.string().max(500).optional(), genres: z.array(z.string().min(1).max(80)).max(20).optional(), style: z.string().max(200).optional(),
  aspectRatio: z.enum(Object.keys(ASPECT_RATIOS) as [AspectRatio, ...AspectRatio[]]).optional(),
  language: z.enum(Object.keys(LANGUAGE_LABELS) as [Language, ...Language[]]).optional(),
  targetDurationSec: z.number().int().min(1).max(2400).optional(), episodeCount: z.number().int().min(1).max(999).optional(),
  audience: z.string().max(500).optional(), notes: z.string().max(8000).optional(), provenance: provenanceSchema.optional(),
}).strict().optional() }).strict();
/** 剧本草稿导入：只接收原文、梗概与镜头节拍；人物/场景/道具由制作端人工补全 */
export const openScreenplaySchema = z.object({
  title: z.string().trim().min(1).max(120),
  logline: z.string().max(500).optional(),
  synopsis: z.string().max(6000).optional(),
  raw: z.string().min(1).max(32_000),
  scenes: z.array(z.object({
    durationSec: z.number().int().min(1).max(600),
    visual: z.string().min(1).max(800),
    narration: z.string().min(1).max(1200),
  }).strict()).min(1).max(20).optional(),
}).strict();