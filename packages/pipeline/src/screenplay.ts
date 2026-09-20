import type { Screenplay, ScreenplayVersion } from '@sakura/core';
import {
  createScreenplayVersion,
  getScreenplay,
  getScreenplayVersion,
  listScreenplayVersions,
  upsertScreenplay,
} from '@sakura/db';

/**
 * 剧本版本管理（⑧）
 *
 * - 落稿：把当前剧本（或助手生成的新文本）存为一个版本
 * - 回滚：把某个历史版本恢复为当前剧本
 * - 版本列表：按版本号倒序
 */

export interface SaveVersionInput {
  projectId: string;
  title?: string;
  /** 若提供，则先把这段文本落为当前剧本再存版本 */
  raw?: string;
  source?: ScreenplayVersion['source'];
}

function snapshotDataJson(screenplay: Screenplay | null): string {
  return JSON.stringify(
    screenplay
      ? {
          title: screenplay.title,
          characters: screenplay.characters,
          locations: screenplay.locations,
          props: screenplay.props,
          beats: screenplay.beats,
          synopsis: screenplay.synopsis,
        }
      : {},
  );
}

/** 落稿一个新版本（同时更新当前剧本） */
export function saveScreenplayVersion(input: SaveVersionInput): ScreenplayVersion {
  const current = getScreenplay(input.projectId);
  let screenplay: Screenplay | null = current;

  if (input.raw && input.raw.trim()) {
    const base = current ?? {
      title: '未命名剧本',
      logline: '',
      synopsis: '',
      characters: [],
      locations: [],
      props: [],
      beats: [],
      raw: input.raw,
      source: 'ai' as const,
    };
    screenplay = upsertScreenplay(input.projectId, {
      ...base,
      raw: input.raw,
      source: input.source === 'manual' ? 'manual' : 'ai',
    });
  }

  return createScreenplayVersion({
    projectId: input.projectId,
    title: input.title || `v · ${new Date().toLocaleString('zh-CN')}`,
    raw: screenplay?.raw ?? input.raw ?? '',
    dataJson: snapshotDataJson(screenplay),
    source: input.source ?? 'ai',
  });
}

/** 版本列表（最新在前） */
export function listVersions(projectId: string): ScreenplayVersion[] {
  return listScreenplayVersions(projectId);
}

/** 回滚：把指定版本恢复为当前剧本，并产生一个 rollback 版本记录 */
export function rollbackToVersion(versionId: string): ScreenplayVersion {
  const version = getScreenplayVersion(versionId);
  if (!version) throw new Error(`剧本版本不存在：${versionId}`);

  const current = getScreenplay(version.projectId);
  const base = current ?? {
    title: '未命名剧本',
    logline: '',
    synopsis: '',
    characters: [],
    locations: [],
    props: [],
    beats: [],
    raw: '',
    source: 'manual' as const,
  };
  upsertScreenplay(version.projectId, { ...base, raw: version.raw, source: 'manual' });

  // 回滚也留一条版本记录，标明来源
  return createScreenplayVersion({
    projectId: version.projectId,
    title: `回滚至 v${version.version}`,
    raw: version.raw,
    dataJson: version.dataJson,
    source: 'rollback',
  });
}
