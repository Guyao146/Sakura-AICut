import type { ProjectSnapshot } from '@sakura/core';

export * from './client';
export * from './seed';
export * from './repos/projects';
export * from './repos/media';
export * from './repos/shots';
export * from './repos/system';
export * from './repos/jobs';
export * from './repos/agent';
export * from './repos/canvas';
export * from './repos/canvas-groups';
export * from './repos/screenplay-versions';
export * from './repos/redraws';
export * from './snapshot';

import { getProjectWithContent } from './snapshot';

/** 组装项目全量数据（画布 / Agent / 渲染都用它） */
export function loadProjectSnapshot(projectId: string): ProjectSnapshot {
  return getProjectWithContent(projectId);
}

