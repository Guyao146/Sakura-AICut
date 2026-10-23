import type { Job, JobType, MediaFile, VibeProject } from '@sakura/core';
import {
  assertProtocolStub, isActiveJob, vibeCreateSchema, vibeDubbingSchema, vibeJobPayloadSchema,
  vibeScriptSchema, vibeTopicSchema,
} from '@sakura/core';
import {
  createJob, createProject, createVibeProject, getMedia, getProject, getVibeProject, listJobs,
  transaction, updateProject, updateVibeProject,
} from '@sakura/db';
import { routeFor } from './ai';
import { resolveMediaPath } from './storage';

type VibeJobType = Extract<JobType, `vibe.${string}`>;

export function requireVibeMusic(projectId: string, mediaId: string): MediaFile {
  const media = getMedia(mediaId);
  if (!media || media.projectId !== projectId || media.kind !== 'audio' || media.ownerType !== 'upload'
    || !media.path?.startsWith(`media/${projectId}/`) || media.path.split(/[\\/]/).includes('..')
    || !resolveMediaPath(media.path)) throw new Error('背景音乐不存在或不属于当前项目，请重新上传');
  return media;
}

export function requireVibeProject(projectId: string): VibeProject {
  if (getProject(projectId)?.mode !== 'vibe') throw new Error('项目不存在或不是 Vibe 项目');
  const vibe = getVibeProject(projectId);
  if (!vibe) throw new Error('Vibe 数据不存在');
  return vibe;
}

export function assertVibeIdle(projectId: string): VibeProject {
  const vibe = requireVibeProject(projectId);
  if (listJobs({ projectId, status: ['pending', 'queued', 'running'], limit: -1 })
    .some((job) => job.type.startsWith('vibe.') && isActiveJob(job))) {
    throw new Error('当前项目已有 Vibe 任务，请等待完成或先取消');
  }
  return vibe;
}

const clearOutput = { outputMediaId: null, outputUrl: null, renderedAt: null, renderError: null } as const;

/** 入队与占用同一事务；任务保存版本号，取消、编辑后的旧结果不能落库。 */
export function enqueueVibeJob(projectId: string, type: VibeJobType, input: {
  topic?: string; instructions?: string; autoRender?: boolean; autoCode?: boolean; confirmedRevision?: number;
} = {}): Job {
  if (!['vibe.generate', 'vibe.code', 'vibe.revise', 'vibe.render'].includes(type)) throw new Error('不支持的 Vibe 任务');
  if (type !== 'vibe.render') routeFor('text');
  return transaction(() => {
    const vibe = assertVibeIdle(projectId);
    const payload = vibeJobPayloadSchema.parse({ ...input, revision: vibe.revision + 1 });
    if (type === 'vibe.generate') payload.topic = vibeTopicSchema.parse(input.topic ?? vibe.topic);
    if (type !== 'vibe.generate') vibeScriptSchema.parse(vibe.script);
    if (type === 'vibe.revise' && !payload.instructions) throw new Error('请填写调整要求');
    if (type === 'vibe.render') {
      if (vibe.dubbing.music) requireVibeMusic(projectId, vibe.dubbing.music.mediaId);
      assertProtocolStub(vibe.code ?? '');
      if (input.confirmedRevision !== vibe.revision) throw new Error('请预览并确认当前版本后再导出');
      if (vibe.dubbing.enabled) {
        const route = routeFor('audio');
        if (!route.adapter.audio) throw new Error('当前语音模型不支持配音，请在设置中更换');
        const range = route.adapter.audioSpeedRange;
        if (range && (vibe.dubbing.speed < range.min || vibe.dubbing.speed > range.max)) {
          throw new Error(`当前语音接口的语速范围为 ${range.min}–${range.max}，请修改音频设置后重新确认`);
        }
        if (!vibe.script?.shots.some((shot) => shot.narration.trim())) throw new Error('请先在脚本中填写配音旁白');
      }
    }
    const job = createJob({
      type, projectId, payload, targetType: 'project', targetId: projectId,
      maxAttempts: 1, priority: 5,
      stageLabel: type === 'vibe.render' ? '已确认，排队导出成片' : '排队生成动画草稿',
    });
    updateVibeProject(projectId, {
      ...clearOutput, revision: payload.revision, activeJobId: job.id,
      renderStatus: 'queued',
      ...(type === 'vibe.generate' ? { topic: payload.topic, script: null } : {}),
      ...(['vibe.generate', 'vibe.code'].includes(type) ? { code: null, codeUpdatedAt: null } : {}),
    }, { revision: vibe.revision });
    updateProject(projectId, { status: 'in_progress', stage: 'script', lastExportUrl: null });
    return job;
  });
}

/** 新建即入队，生成可预览草稿；最终成片须用户确认。 */
export function createVibeAndEnqueue(input: unknown): { id: string; job: Job } {
  const parsed = vibeCreateSchema.parse(input);
  routeFor('text');
  return transaction(() => {
    const { topic, ...brief } = parsed;
    const project = createProject({
      ...brief, name: parsed.name || topic.slice(0, 30), mode: 'vibe',
      genres: [], logline: topic,
    });
    createVibeProject(project.id, parsed.topic);
    const job = createJob({
      type: 'vibe.generate', projectId: project.id,
      payload: vibeJobPayloadSchema.parse({ revision: 1, topic: parsed.topic, autoCode: true }),
      targetType: 'project', targetId: project.id, priority: 5, maxAttempts: 1,
      stageLabel: '排队生成动画草稿',
    });
    updateVibeProject(project.id, { revision: 1, activeJobId: job.id, renderStatus: 'queued' });
    updateProject(project.id, { status: 'in_progress', stage: 'script' });
    return { id: project.id, job };
  });
}

export function saveVibeDraft(projectId: string, kind: 'script' | 'code', value: unknown, revision: number): VibeProject {
  if (typeof value !== 'string' && kind === 'code') throw new Error('动画代码必须是文本');
  const script = kind === 'script' ? vibeScriptSchema.parse(value) : undefined;
  if (kind === 'code') assertProtocolStub(value as string);
  return transaction(() => {
    const vibe = assertVibeIdle(projectId);
    if (vibe.revision !== revision) throw new Error('内容已在其他页面更新，请刷新后重试');
    if (kind === 'code') vibeScriptSchema.parse(vibe.script);
    const updated = updateVibeProject(projectId, {
      ...clearOutput, revision: revision + 1, activeJobId: null, renderStatus: 'idle',
      ...(script ? { script, code: null, codeUpdatedAt: null }
        : { code: value as string, codeUpdatedAt: new Date().toISOString() }),
    }, { revision });
    updateProject(projectId, { status: 'in_progress', stage: kind === 'script' ? 'script' : 'edit', lastExportUrl: null });
    return updated;
  });
}

export function saveVibeDubbing(projectId: string, value: unknown, revision: number): VibeProject {
  const dubbing = vibeDubbingSchema.parse(value);
  return transaction(() => {
    const vibe = assertVibeIdle(projectId);
    if (vibe.revision !== revision) throw new Error('内容已更新，请刷新后重试');
    if (dubbing.music) requireVibeMusic(projectId, dubbing.music.mediaId);
    const updated = updateVibeProject(projectId, {
      ...clearOutput, dubbing, revision: revision + 1, activeJobId: null, renderStatus: 'idle',
    }, { revision });
    updateProject(projectId, { status: 'in_progress', stage: 'edit', lastExportUrl: null });
    return updated;
  });
}
