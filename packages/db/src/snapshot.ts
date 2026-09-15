import type { Asset, Project, ProjectSnapshot, Screenplay, Shot, Timeline } from '@sakura/core';
import { getProject } from './repos/projects';
import { getScreenplay } from './repos/projects';
import { listAssets } from './repos/media';
import { listShots, getTimeline } from './repos/shots';

/**
 * 项目快照：一次性取全流程数据，供画布、Agent、渲染共用
 */

export interface ProjectContent {
  project: Project;
  snapshot: ProjectSnapshot;
  screenplay: Screenplay | null;
  assets: Asset[];
  shots: Shot[];
  timeline: Timeline | null;
}

export function getProjectWithContent(projectId: string): ProjectSnapshot {
  return loadContent(projectId).snapshot;
}

export function loadContent(projectId: string): ProjectContent {
  const project = getProject(projectId);
  if (!project) throw new Error(`项目不存在：${projectId}`);

  const screenplay = getScreenplay(projectId);
  const assets = listAssets(projectId);
  const shots = listShots(projectId);
  const timeline = getTimeline(projectId);

  return {
    project,
    screenplay,
    assets,
    shots,
    timeline,
    snapshot: {
      stage: project.stage,
      brief: {
        name: project.brief.name,
        genres: project.brief.genres,
        style: project.brief.style,
        aspectRatio: project.brief.aspectRatio,
        targetDurationSec: project.brief.targetDurationSec,
        language: project.brief.language,
      },
      screenplay,
      assets,
      shots,
      timeline,
    },
  };
}
