import { CANVAS_ITEM_KIND_LABELS, CANVAS_NODE_ROLE_LABELS } from '@sakura/core';
import type { CanvasAiSnapshot, CanvasItem, MediaFile } from '@sakura/core';
import { createMedia, getCanvasItem, getMedia, getProject, transaction, updateCanvasItem } from '@sakura/db';
import { queryVideoTask, runAudio, runImage, runText, submitVideo } from './ai';
import { saveMedia } from './storage';

/** 只比较内容字段：拖动、缩放、置顶不会阻止任务回填。 */
export function assertCanvasAiSnapshot(snapshot: CanvasAiSnapshot, item: CanvasItem | null): asserts item is CanvasItem {
  if (!item) throw new Error('节点已删除，无法回填 AI 结果');
  if (item.id !== snapshot.itemId || item.kind !== snapshot.kind || item.text !== snapshot.expectedText
    || (item.mediaId ?? null) !== snapshot.expectedMediaId || (item.url ?? null) !== snapshot.expectedUrl
    || (item.role ?? 'plain') !== snapshot.role || (item.refId ?? null) !== snapshot.refId) {
    throw new Error('节点内容已修改，未覆盖新内容；请基于最新内容重新提交');
  }
}

function textMessages(snapshot: CanvasAiSnapshot) {
  const purpose = snapshot.kind === 'text' ? '可直接使用的正文'
    : snapshot.kind === 'audio' ? '可直接朗读的台词或旁白，不要加入舞台说明'
      : snapshot.kind === 'image' ? '描述主体、构图、光线、色彩和风格的图片提示词'
        : '描述主体、动作、场景、镜头运动和节奏的视频提示词';
  return [
    { role: 'system' as const, content: `你是创作助手。为${CANVAS_ITEM_KIND_LABELS[snapshot.kind]}节点输出${purpose}。`
      + `节点身份：${CANVAS_NODE_ROLE_LABELS[snapshot.role]}。`
      + (snapshot.operation === 'optimize' ? '优化已有内容，保留核心含义和设定，不擅自改变人物、场景或道具。' : '根据提供的内容与要求生成完整内容。')
      + '用户要求优先，已有内容作为上下文。只输出结果，不要解释、前言或代码块。未提供媒体时不要声称看过图片、视频或听过音频。' },
    { role: 'user' as const, content: `节点已有文字：\n${snapshot.sourceText || '（空）'}\n\n用户要求：\n${snapshot.instruction || '请根据节点已有文字完成本次操作。'}` },
  ];
}

export interface CanvasAiExecutionOptions {
  isCanceled?: () => boolean;
  /** 远端视频任务持久化在队列结果中，worker 重启后继续查询而不是重复提交。 */
  videoTask?: { providerId: string; modelId: string; taskId: string };
  onVideoSubmitted?: (task: { providerId: string; modelId: string; taskId: string }) => void;
}

export async function runCanvasAi(snapshot: CanvasAiSnapshot, options: CanvasAiExecutionOptions = {}) {
  const checkCanceled = () => { if (options.isCanceled?.()) throw new Error('任务已取消'); };
  checkCanceled();
  const item = getCanvasItem(snapshot.itemId);
  assertCanvasAiSnapshot(snapshot, item);
  const project = getProject(item.projectId);
  if (!project) throw new Error('项目不存在');
  if (!snapshot.sourceText.trim() && !snapshot.instruction.trim()) throw new Error('请输入要求或节点文字');

  if (snapshot.operation === 'optimize' || snapshot.kind === 'text') {
    const result = await runText({ messages: textMessages(snapshot), temperature: 0.7, maxTokens: 4096 });
    const text = result.text.trim();
    if (!text) throw new Error('文本模型未返回内容，已保留原节点');
    checkCanceled();
    transaction(() => {
      checkCanceled();
      assertCanvasAiSnapshot(snapshot, getCanvasItem(item.id));
      updateCanvasItem(item.id, { text });
    });
    return { text };
  }

  // 直接生成媒体时，新文字优先；未输入则使用节点已有提示词/台词，不额外消耗文本模型额度。
  const prompt = snapshot.instruction.trim() || snapshot.sourceText.trim();
  const common = { prompt, negativePrompt: project.brief.negativePrompt,
    aspectRatio: snapshot.aspectRatio ?? project.brief.aspectRatio, seed: project.brief.seed };
  let source: string;
  let providerId: string;
  let model: string | undefined;
  let width: number | undefined;
  let height: number | undefined;
  let durationSec: number | undefined;
  let mime: string | undefined;
  if (snapshot.kind === 'image') {
    const result = await runImage({ ...common, count: 1 });
    const image = result.images[0];
    source = image?.url || image?.b64 || '';
    providerId = result.providerId;
    model = result.model;
    width = image?.width;
    height = image?.height;
  } else if (snapshot.kind === 'audio') {
    const result = await runAudio({ input: prompt, voice: snapshot.voice || undefined, format: 'mp3' });
    source = result.url || result.b64 || '';
    providerId = result.providerId;
    model = result.model;
    durationSec = result.durationSec;
    mime = 'audio/mpeg';
  } else {
    const video = await generateVideo(snapshot, common, options, () => {
      checkCanceled();
      assertCanvasAiSnapshot(snapshot, getCanvasItem(item.id));
    });
    source = video.url;
    providerId = video.providerId;
    model = video.modelId;
    durationSec = video.durationSec;
  }
  if (!source) throw new Error('模型未返回媒体内容，已保留原节点');
  checkCanceled();
  assertCanvasAiSnapshot(snapshot, getCanvasItem(item.id));
  const saved = await saveMedia(item.projectId, snapshot.kind, source, { mime });
  checkCanceled();
  return transaction(() => {
    checkCanceled();
    const current = getCanvasItem(item.id);
    assertCanvasAiSnapshot(snapshot, current);
    const media: MediaFile = createMedia({ projectId: item.projectId, kind: snapshot.kind as 'image' | 'video' | 'audio',
      ...saved, prompt, providerId, model: model ?? null, width, height, durationSec,
      ownerType: 'canvas', ownerId: item.id });
    const variants = [...(current.variants ?? [])];
    if (current.mediaId && current.url) variants.push({ mediaId: current.mediaId, url: current.url,
      prompt: getMedia(current.mediaId)?.prompt ?? current.text, createdAt: current.updatedAt });
    updateCanvasItem(item.id, { text: prompt, mediaId: media.id, url: media.url, variants: variants.slice(-24) });
    return { mediaId: media.id };
  });
}

async function generateVideo(
  snapshot: CanvasAiSnapshot,
  common: { prompt: string; negativePrompt?: string; aspectRatio: string; seed?: number },
  options: CanvasAiExecutionOptions,
  checkCanceled: () => void,
) {
  let task = options.videoTask;
  if (!task) {
    const submitted = await submitVideo({ ...common, durationSec: snapshot.durationSec ?? 5 });
    task = { providerId: submitted.providerId, modelId: submitted.modelId, taskId: submitted.handle.taskId };
    if (submitted.handle.immediate) return { ...task, ...submitted.handle.immediate };
    options.onVideoSubmitted?.(task);
  }
  const configured = Number(process.env.ASYNC_TASK_TIMEOUT ?? 1800);
  const timeoutMs = (Number.isFinite(configured) && configured > 0 ? configured : 1800) * 1000;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    checkCanceled();
    if (Date.now() > deadline) throw new Error('视频任务超时，请在任务中心重试');
    const state = await queryVideoTask(task.providerId, task.taskId);
    checkCanceled();
    if (state.status === 'succeeded') {
      if (!state.videoUrl) throw new Error('视频任务完成但未返回视频地址');
      return { ...task, url: state.videoUrl, durationSec: state.durationSec };
    }
    if (state.status === 'failed' || state.status === 'canceled') throw new Error(state.error || '视频任务失败或已取消');
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}
