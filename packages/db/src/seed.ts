import { builtinPromptTemplates } from '@sakura/core';
import {
  DEFAULT_APP_SETTINGS,
  createPromptTemplate,
  getSetting,
  listPromptTemplates,
  setSetting,
} from './repos/system';
import { getDb } from './client';

/**
 * 首次启动时写入内置数据（提示词库模板、默认设置）
 */
export function bootstrap(): { seededPrompts: number } {
  getDb();

  let seededPrompts = 0;
  const existing = new Set(listPromptTemplates({ source: 'builtin' }).map((item) => item.id));
  for (const template of builtinPromptTemplates()) {
    if (existing.has(template.id)) continue;
    createPromptTemplate({
      id: template.id,
      source: 'builtin',
      category: template.category,
      name: template.name,
      description: template.description,
      template: template.template,
      variables: template.variables,
      capability: template.capability,
      tags: template.tags,
    });
    seededPrompts += 1;
  }

  if (!getSetting<boolean | null>('app_seeded', null)) {
    setSetting('app', DEFAULT_APP_SETTINGS);
    setSetting('app_seeded', true);
  }

  return { seededPrompts };
}
