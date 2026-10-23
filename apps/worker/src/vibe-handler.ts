import { rm, stat } from 'node:fs/promises';
import { relative } from 'node:path';
import { vibeJobPayloadSchema, type VibeJobPayload } from '@sakura/core';
import { redactUrl } from '@sakura/core/server';
import {
  createMedia, completeJob, dataDir, getAppSettings, getJob, getMedia, getVibeProject, transaction,
  updateJob, updateProject, updateVibeProject,
} from '@sakura/db';
import { generateVibeScript, generateVibeCode, reviseVibeScript, requireVibeProject } from '@sakura/pipeline';
import type { HandlerContext } from './handlers';
import { renderVibeVideo } from './vibe-render';

/** 一个持久化任务串起全流程；恢复时跳过已经成功落库的阶段。 */
export async function handleVibeJob({ job, progress, log, isCanceled }: HandlerContext): Promise<Record<string, unknown>> {
  const projectId = job.projectId;
  if (!projectId) throw new Error('Vibe 任务缺少项目');
  const payload: VibeJobPayload = vibeJobPayloadSchema.parse(job.payload);
  const initial = requireVibeProject(projectId);
  const priorJob = getJob(job.id);
  if (priorJob?.status === 'succeeded' && priorJob.result) return priorJob.result;
  if (!isCanceled() && priorJob?.status === 'running' && initial.revision === payload.revision
    && initial.activeJobId === job.id && initial.outputMediaId && getMedia(initial.outputMediaId)?.jobId === job.id) {
    const result = { mediaId: initial.outputMediaId, outputUrl: initial.outputUrl };
    completeJob(job.id, result);
    return result;
  }
  const stopped = () => {
    const currentJob = getJob(job.id);
    const vibe = getVibeProject(projectId);
    return isCanceled() || !currentJob || currentJob.status !== 'running' || currentJob.attempts !== job.attempts
      || !vibe || vibe.revision !== payload.revision || vibe.activeJobId !== job.id;
  };
  const check = () => { if (stopped()) throw new Error('Vibe 任务已取消或内容已更新'); };
  const persist = (work: () => void) => transaction(() => { check(); work(); });
  const guard = { revision: payload.revision, activeJobId: job.id };
  const options = { instructions: payload.instructions, isCanceled: stopped };
  const beat = setInterval(() => { if (!stopped()) updateJob(job.id, { heartbeatAt: new Date().toISOString() }); }, 5000);
  let outputPath: string | undefined;
  try {
    check();
    if (job.type === 'vibe.generate' && !initial.script) {
      progress(5, 'AI 正在生成视频脚本');
      const script = await generateVibeScript(projectId, payload.topic ?? initial.topic, options);
      persist(() => updateVibeProject(projectId, { script }, guard));
      log(`视频脚本完成：${script.shots.length} 场`);
    }
    if (job.type === 'vibe.revise' && priorJob?.result?.draftSaved !== true) {
      progress(10, 'Agent 正在调整脚本与旁白');
      const script = await reviseVibeScript(projectId, options);
      progress(35, 'Agent 正在调整动画代码');
      const code = await generateVibeCode(projectId, { ...options, script });
      persist(() => {
        updateVibeProject(projectId, { script, code, codeUpdatedAt: new Date().toISOString() }, guard);
        updateJob(job.id, { result: { draftSaved: true } });
      });
      log('调整后的脚本与动画已保存，等待用户预览确认');
    }
    const needCode = job.type === 'vibe.code' || (job.type === 'vibe.generate' && (payload.autoCode || payload.autoRender));
    if (needCode && !getVibeProject(projectId)?.code) {
      check();
      progress(30, 'AI 正在编写动画代码');
      const code = await generateVibeCode(projectId, options);
      persist(() => updateVibeProject(projectId, { code, codeUpdatedAt: new Date().toISOString() }, guard));
      log('动画代码已保存');
    }
    if (job.type !== 'vibe.render') {
      persist(() => {
        updateVibeProject(projectId, { renderStatus: 'idle' }, guard);
        updateProject(projectId, { status: 'in_progress', stage: needCode || job.type === 'vibe.revise' ? 'edit' : 'script' });
        completeJob(job.id, { revision: payload.revision, draftSaved: true });
      });
      progress(100, '生成完成，可检查后继续');
      return { revision: payload.revision };
    }
    if (payload.confirmedRevision !== payload.revision - 1) throw new Error('此导出任务未确认当前草稿，请重新预览并确认导出');
    persist(() => {
      updateVibeProject(projectId, { renderStatus: 'rendering', renderError: null }, guard);
      updateProject(projectId, { status: 'rendering', stage: 'edit' });
    });
    const result = await renderVibeVideo(projectId, {
      ffmpegPath: getAppSettings().ffmpegPath, isCanceled: stopped,
      onProgress: (percent, stage) => progress(5 + Math.round(percent * 0.93), stage), onLog: log,
    });
    outputPath = result.outputPath;
    const fileSize = (await stat(outputPath)).size;
    let mediaId = '';
    persist(() => {
      const media = createMedia({
        projectId, jobId: job.id, kind: 'video', ownerType: 'project', ownerId: projectId,
        url: result.outputUrl, path: relative(dataDir(), result.outputPath).replace(/\\/g, '/'),
        mime: 'video/mp4', width: result.width, height: result.height, durationSec: result.durationSec, fileSize,
      });
      mediaId = media.id;
      updateVibeProject(projectId, {
        renderStatus: 'succeeded', outputMediaId: media.id, outputUrl: media.url,
        renderedAt: new Date().toISOString(), renderError: null,
      }, guard);
      updateProject(projectId, { status: 'completed', stage: 'done', lastExportUrl: media.url });
      completeJob(job.id, { mediaId, outputUrl: media.url, durationSec: result.durationSec, frameCount: result.frameCount });
    });
    outputPath = undefined;
    progress(100, 'MP4 已生成');
    return { mediaId, outputUrl: result.outputUrl, durationSec: result.durationSec, frameCount: result.frameCount };
  } catch (error) {
    if (outputPath) await rm(outputPath, { force: true });
    const message = redactUrl(error instanceof Error ? error.message : String(error));
    const current = getVibeProject(projectId);
    const latest = getJob(job.id);
    if (current?.revision === payload.revision && current.activeJobId === job.id && latest?.attempts === job.attempts && latest.status !== 'succeeded') {
      const canceled = isCanceled() || latest.status === 'canceled' || latest.status === 'pending';
      updateVibeProject(projectId, {
        renderStatus: latest.status === 'pending' ? 'queued' : canceled ? 'canceled' : 'failed',
        renderError: canceled ? null : message,
      }, guard);
      updateProject(projectId, { status: 'in_progress' });
    }
    throw new Error(message);
  } finally { clearInterval(beat); }
}
