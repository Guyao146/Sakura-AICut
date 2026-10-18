import type { Job, JobType, VibeProject } from '@sakura/core';
import {
  assertProtocolStub, isActiveJob, vibeCreateSchema, vibeJobPayloadSchema,
  vibeScriptSchema, vibeTopicSchema,
} from '@sakura/core';
import {
  createJob, createProject, createVibeProject, getProject, getVibeProject, listJobs,
  transaction, updateProject, updateVibeProject,
} from '@sakura/db';
import { routeFor } from './ai';

type VibeJobType = Extract<JobType, `vibe.${string}`>;

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
  topic?: string; instructions?: string; autoRender?: boolean;
} = {}): Job {
  if (!['vibe.generate', 'vibe.code', 'vibe.render'].includes(type)) throw new Error('不支持的 Vibe 任务');
  if (type !== 'vibe.render') routeFor('text');
  return transaction(() => {
    const vibe = assertVibeIdle(projectId);
    const payload = vibeJobPayloadSchema.parse({ ...input, revision: vibe.revision + 1 });
    if (type === 'vibe.generate') payload.topic = vibeTopicSchema.parse(input.topic ?? vibe.topic);
    if (type !== 'vibe.generate') vibeScriptSchema.parse(vibe.script);
    if (type === 'vibe.render') assertProtocolStub(vibe.code ?? '');
    const job = createJob({
      type, projectId, payload, targetType: 'project', targetId: projectId,
      maxAttempts: 1, priority: 5,
      stageLabel: payload.autoRender ? '排队一键生成视频' : '排队执行 Vibe 任务',
    });
    updateVibeProject(projectId, {
      ...clearOutput, revision: payload.revision, activeJobId: job.id,
      renderStatus: 'queued',
      ...(type === 'vibe.generate' ? { topic: payload.topic, script: null } : {}),
      ...(type !== 'vibe.render' ? { code: null, codeUpdatedAt: null } : {}),
    }, { revision: vibe.revision });
    updateProject(projectId, { status: 'in_progress', stage: 'script', lastExportUrl: null });
    return job;
  });
}

/** 新建即入队，一键直出不是仅创建空项目。 */
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
      payload: vibeJobPayloadSchema.parse({ revision: 1, topic: parsed.topic, autoRender: true }),
      targetType: 'project', targetId: project.id, priority: 5, maxAttempts: 1,
      stageLabel: '排队一键生成视频',
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
