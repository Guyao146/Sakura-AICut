import type { MediaFile } from '@sakura/core';
import {
  buildCameraAnglePrompt,
  buildLightingPrompt,
  REVERSE_PARSE_PROMPT,
} from '@sakura/core';
import { createMedia, getCanvasItem, getProject, updateCanvasItem } from '@sakura/db';
import { runImage, runText } from './ai';
import { saveMedia } from './storage';

/**
 * 画布节点工具（⑥，对齐小云雀节点工具栏）
 *
 * 反解析 / 智能打光 / 镜头调节 / 全景 / 涂鸦 —— 都以现有节点为输入，
 * 生成新图片或新文本后回填到节点（保留抽卡记录）。
 */

interface NodeToolContext {
  /** 项目 ID */
  projectId: string;
  /** 画面比例 */
  aspectRatio?: string;
  /** 种子 */
  seed?: number;
}

/** 把生成结果回填到节点（归档旧结果到抽卡记录） */
function applyToNode(
  itemId: string,
  media: MediaFile,
  extra: { kind?: 'image'; text?: string } = {},
) {
  const item = getCanvasItem(itemId);
  const variants = (item?.variants ?? []).slice();
  if (item?.mediaId && item.url) {
    variants.push({
      mediaId: item.mediaId,
      url: item.url,
      prompt: item.text,
      createdAt: item.updatedAt ?? new Date().toISOString(),
    });
  }
  return updateCanvasItem(itemId, {
    kind: 'image',
    mediaId: media.id,
    url: media.url,
    variants: variants.slice(-24),
    ...extra,
  });
}

async function saveImageMedia(
  context: NodeToolContext,
  source: string,
  prompt: string,
  itemId: string,
  width?: number | null,
  height?: number | null,
): Promise<MediaFile> {
  const saved = await saveMedia(context.projectId, 'image', source, {
    filename: source.startsWith('http') ? undefined : `node_${itemId.slice(0, 12)}.png`,
  });
  return createMedia({
    projectId: context.projectId,
    kind: 'image',
    url: saved.url,
    path: saved.path,
    mime: saved.mime,
    fileSize: saved.fileSize,
    width: width ?? null,
    height: height ?? null,
    prompt,
    model: null,
    providerId: null,
    seed: null,
    ownerType: 'canvas',
    ownerId: itemId,
  });
}

/** 提示词反解析：图片 → 可复用提示词（写入节点文本） */
export async function reverseParseNodeImage(itemId: string): Promise<{ prompt: string }> {
  const item = getCanvasItem(itemId);
  if (!item) throw new Error(`画布素材不存在：${itemId}`);
  if (!item.url) throw new Error('该节点没有图片，无法反解析');

  const project = getProject(item.projectId);
  if (!project) throw new Error('项目不存在');

  const result = await runText({
    messages: [
      { role: 'system', content: REVERSE_PARSE_PROMPT },
      {
        role: 'user',
        content: '请分析这张图并输出可复用的提示词。',
        images: [item.url],
      },
    ],
    temperature: 0.4,
    maxTokens: 800,
  });

  const prompt = result.text.trim();
  updateCanvasItem(itemId, { text: prompt });
  return { prompt };
}

/** 智能打光：给节点图片重新打光 */
export async function relightNode(
  itemId: string,
  lighting: {
    direction: Parameters<typeof buildLightingPrompt>[0]['direction'];
    quality?: Parameters<typeof buildLightingPrompt>[0]['quality'];
    tone?: Parameters<typeof buildLightingPrompt>[0]['tone'];
  },
  context: NodeToolContext = { projectId: '' },
): Promise<MediaFile> {
  const item = getCanvasItem(itemId);
  if (!item) throw new Error(`画布素材不存在：${itemId}`);
  const projectId = context.projectId || item.projectId;
  const project = getProject(projectId);
  if (!project) throw new Error('项目不存在');

  const lightingPrompt = buildLightingPrompt(lighting);
  const result = await runImage({
    prompt: `${item.text}. ${lightingPrompt}`,
    negativePrompt: project.brief.negativePrompt,
    aspectRatio: context.aspectRatio ?? project.brief.aspectRatio,
    count: 1,
    seed: context.seed ?? project.brief.seed,
  });
  if (result.images.length === 0) throw new Error('图片模型未返回任何图片');
  const image = result.images[0]!;
  const source = image.url ?? image.b64;
  if (!source) throw new Error('图片模型返回的内容为空');

  const media = await saveImageMedia(
    { ...context, projectId },
    source,
    `${item.text}. ${lightingPrompt}`,
    itemId,
    image.width,
    image.height,
  );
  applyToNode(itemId, media);
  return media;
}

/** 镜头调节：改取景角度 / 景别 */
export async function adjustNodeCameraAngle(
  itemId: string,
  angle: '平视' | '俯拍' | '仰拍' | '过肩' | '倾斜',
  shotSize: string,
  context: NodeToolContext = { projectId: '' },
): Promise<MediaFile> {
  const item = getCanvasItem(itemId);
  if (!item) throw new Error(`画布素材不存在：${itemId}`);
  const projectId = context.projectId || item.projectId;
  const project = getProject(projectId);
  if (!project) throw new Error('项目不存在');

  const anglePrompt = buildCameraAnglePrompt({ angle, shotSize });
  const result = await runImage({
    prompt: `${item.text}. ${anglePrompt}`,
    negativePrompt: project.brief.negativePrompt,
    aspectRatio: context.aspectRatio ?? project.brief.aspectRatio,
    count: 1,
    seed: context.seed ?? project.brief.seed,
  });
  if (result.images.length === 0) throw new Error('图片模型未返回任何图片');
  const image = result.images[0]!;
  const source = image.url ?? image.b64;
  if (!source) throw new Error('图片模型返回的内容为空');

  const media = await saveImageMedia(
    { ...context, projectId },
    source,
    `${item.text}. ${anglePrompt}`,
    itemId,
    image.width,
    image.height,
  );
  applyToNode(itemId, media);
  return media;
}
