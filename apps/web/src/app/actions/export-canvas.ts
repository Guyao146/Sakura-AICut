'use server';

import { getCanvasItem, listCanvasItems, getProject, saveTimeline } from '@sakura/db';
import { enqueueTimelineRender } from '@/lib/server/jobs';
import type { Track, TimelineClip } from '@sakura/core';

/**
 * 把画布素材排列快照转为时间线轨道
 * 规则：
 * - 按 z 层级排成并行轨道
 * - 每个素材按其视频时长或固定时长占据时间
 * - 统一导出为视频
 */
export async function exportCanvasAsTimelineAction(
  projectId: string,
  options: { duration?: number } = {},
): Promise<{ ok: boolean; jobId?: string; error?: string }> {
  try {
    const project = getProject(projectId);
    if (!project) throw new Error('项目不存在');

    const items = listCanvasItems(projectId);
    if (items.length === 0) throw new Error('画布为空，无法导出');

    // 按 z 分组为并行轨道
    const tracksByZ = new Map<number, typeof items>();
    items.forEach((item) => {
      if (!tracksByZ.has(item.z)) tracksByZ.set(item.z, []);
      tracksByZ.get(item.z)!.push(item);
    });

    const totalDuration = options.duration ?? 10; // 默认 10 秒
    const tracks: Track[] = [];

    tracksByZ.forEach((zItems) => {
      const clips: TimelineClip[] = zItems.map((item, idx) => {
        const startTime = (idx * totalDuration) / zItems.length;
        const duration = Math.max(1, totalDuration / zItems.length);

        return {
          id: `clip_${item.id}`,
          shotId: undefined,
          mediaId: item.mediaId ?? item.id,
          start: startTime,
          duration,
          trimIn: 0,
          speed: 1,
          volume: 1,
        };
      });

      tracks.push({
        id: `track_canvas_${tracks.length}`,
        type: 'video',
        name: `Canvas Layer`,
        clips,
      });
    });

    // 保存时间线
    const timeline = saveTimeline(projectId, { tracks });

    // 入队渲染
    const job = enqueueTimelineRender(projectId, { includeSubtitles: false });

    return { ok: true, jobId: job.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[export canvas]', message);
    return { ok: false, error: message };
  }
}
