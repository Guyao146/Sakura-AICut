import type {
  Capability,
  ModelEntry,
  ModelRoute,
  PromptCategory,
  PromptTemplate,
  ProviderConfig,
  ProviderCredentials,
  ProviderProtocol,
} from '@sakura/core';
import { createId, extractTemplateVariables } from '@sakura/core';
import { decryptJson, encryptJson } from '@sakura/core/server';
import { buildUpdate, getDb, intToBool, nowIso, parseJson, toJson } from '../client';

/**
 * 供应商 / 模型路由 / 提示词库 / 全局设置 仓储
 */

interface ProviderRow {
  id: string;
  name: string;
  protocol: string;
  base_url: string;
  credentials_enc: string | null;
  extra_headers_json: string | null;
  proxy_url: string | null;
  enabled: number;
  is_default: number;
  concurrency: number;
  timeout_sec: number;
  models_json: string;
  remark: string | null;
  created_at: string;
  updated_at: string;
}

function mapProvider(row: ProviderRow): ProviderConfig {
  return {
    id: row.id,
    name: row.name,
    protocol: row.protocol as ProviderProtocol,
    baseUrl: row.base_url,
    credentials: decryptJson<ProviderCredentials>(row.credentials_enc) ?? {},
    extraHeaders: parseJson<Record<string, string> | undefined>(row.extra_headers_json, undefined),
    proxyUrl: row.proxy_url,
    enabled: intToBool(row.enabled),
    isDefault: intToBool(row.is_default),
    concurrency: row.concurrency,
    timeoutSec: row.timeout_sec,
    models: parseJson<ModelEntry[]>(row.models_json, []),
    remark: row.remark,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 列表：默认返回解密后的凭证（仅服务端使用） */
export function listProviders(options: { maskCredentials?: boolean } = {}): ProviderConfig[] {
  const rows = getDb().prepare('SELECT * FROM providers ORDER BY created_at ASC').all() as unknown as ProviderRow[];
  const providers = rows.map(mapProvider);
  if (!options.maskCredentials) return providers;
  return providers.map((provider) => ({ ...provider, credentials: undefined }));
}

export function getProvider(id: string): ProviderConfig | null {
  const row = getDb().prepare('SELECT * FROM providers WHERE id = ?').get(id) as unknown as ProviderRow | undefined;
  return row ? mapProvider(row) : null;
}

export interface ProviderInput {
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  credentials?: ProviderCredentials;
  extraHeaders?: Record<string, string>;
  proxyUrl?: string | null;
  enabled?: boolean;
  concurrency?: number;
  timeoutSec?: number;
  models?: ModelEntry[];
  remark?: string | null;
}

export function createProvider(input: ProviderInput): ProviderConfig {
  const id = `prv_${createId(12)}`;
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO providers (id, name, protocol, base_url, credentials_enc, extra_headers_json, proxy_url, enabled,
        is_default, concurrency, timeout_sec, models_json, remark, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.name,
      input.protocol,
      input.baseUrl.replace(/\/+$/, ''),
      input.credentials ? encryptJson(input.credentials) : null,
      input.extraHeaders ? toJson(input.extraHeaders) : null,
      input.proxyUrl ?? null,
      input.enabled === false ? 0 : 1,
      input.concurrency ?? 3,
      input.timeoutSec ?? 300,
      toJson(input.models ?? []),
      input.remark ?? null,
      now,
      now,
    );
  return getProvider(id) as ProviderConfig;
}

export function updateProvider(
  id: string,
  patch: Partial<ProviderInput> & { isDefault?: boolean },
): ProviderConfig {
  const fields: Record<string, unknown> = {};
  if (patch.name !== undefined) fields.name = patch.name;
  if (patch.protocol !== undefined) fields.protocol = patch.protocol;
  if (patch.baseUrl !== undefined) fields.base_url = patch.baseUrl.replace(/\/+$/, '');
  if (patch.credentials !== undefined) {
    fields.credentials_enc = patch.credentials && Object.keys(patch.credentials).length > 0
      ? encryptJson(patch.credentials)
      : null;
  }
  if (patch.extraHeaders !== undefined) fields.extra_headers_json = toJson(patch.extraHeaders);
  if (patch.proxyUrl !== undefined) fields.proxy_url = patch.proxyUrl;
  if (patch.enabled !== undefined) fields.enabled = patch.enabled ? 1 : 0;
  if (patch.isDefault !== undefined) fields.is_default = patch.isDefault ? 1 : 0;
  if (patch.concurrency !== undefined) fields.concurrency = patch.concurrency;
  if (patch.timeoutSec !== undefined) fields.timeout_sec = patch.timeoutSec;
  if (patch.models !== undefined) fields.models_json = toJson(patch.models);
  if (patch.remark !== undefined) fields.remark = patch.remark;

  if (Object.keys(fields).length > 0) {
    const { sql, values } = buildUpdate('providers', id, fields);
    getDb().prepare(sql).run(...(values as never[]));
  }
  return getProvider(id) as ProviderConfig;
}

/** 追加或覆盖某个模型配置（设置页「自动发现模型」用） */
export function upsertProviderModel(providerId: string, model: ModelEntry): ProviderConfig {
  const provider = getProvider(providerId);
  if (!provider) throw new Error(`供应商不存在：${providerId}`);
  const models = provider.models.filter((item) => item.id !== model.id);
  models.push(model);
  return updateProvider(providerId, { models });
}

export function deleteProvider(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM model_routes WHERE provider_id = ?').run(id);
  db.prepare('DELETE FROM providers WHERE id = ?').run(id);
}

/* ------------------------- 模型路由 ------------------------- */

interface RouteRow {
  capability: string;
  provider_id: string;
  model_id: string;
  fallbacks_json: string;
  params_json: string | null;
  updated_at: string;
}

function mapRoute(row: RouteRow): ModelRoute {
  return {
    capability: row.capability as Capability,
    providerId: row.provider_id,
    modelId: row.model_id,
    fallbacks: parseJson<ModelRoute['fallbacks']>(row.fallbacks_json, []),
    params: parseJson<Record<string, unknown> | undefined>(row.params_json, undefined),
  };
}

export function listModelRoutes(): ModelRoute[] {
  const rows = getDb().prepare('SELECT * FROM model_routes').all() as unknown as RouteRow[];
  return rows.map(mapRoute);
}

export function upsertModelRoute(route: ModelRoute): void {
  getDb()
    .prepare(
      `INSERT INTO model_routes (capability, provider_id, model_id, fallbacks_json, params_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(capability) DO UPDATE SET provider_id = excluded.provider_id, model_id = excluded.model_id,
         fallbacks_json = excluded.fallbacks_json, params_json = excluded.params_json, updated_at = excluded.updated_at`,
    )
    .run(
      route.capability,
      route.providerId,
      route.modelId,
      toJson(route.fallbacks ?? []),
      route.params ? toJson(route.params) : null,
      nowIso(),
    );
}

export function deleteModelRoute(capability: Capability): void {
  getDb().prepare('DELETE FROM model_routes WHERE capability = ?').run(capability);
}

/* ------------------------- 全局设置 ------------------------- */

export function getSetting<T>(key: string, fallback: T): T {
  const row = getDb().prepare('SELECT value_json FROM settings WHERE key = ?').get(key) as unknown as
    | { value_json: string }
    | undefined;
  return row ? parseJson<T>(row.value_json, fallback) : fallback;
}

export function setSetting(key: string, value: unknown): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    )
    .run(key, toJson(value), nowIso());
}

export interface AppSettings {
  /** 新建项目默认画幅 */
  defaultAspectRatio: string;
  /** 默认目标时长（秒） */
  defaultTargetDurationSec: number;
  /** 默认视觉风格 */
  defaultStyle: string;
  /** Agent 是否自动执行（否则每步确认） */
  agentAutoApprove: boolean;
  /** 视频生成是否默认先生成首帧图 */
  videoUseFirstFrame: boolean;
  /** 并发生成数量 */
  generationConcurrency: number;
  /** ffmpeg 路径 */
  ffmpegPath: string;
  /** 是否保留供应商原始响应（调试用） */
  keepRawResponse: boolean;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  defaultAspectRatio: '9:16',
  defaultTargetDurationSec: 90,
  defaultStyle: '写实电影感',
  agentAutoApprove: false,
  videoUseFirstFrame: true,
  generationConcurrency: 3,
  ffmpegPath: process.env.FFMPEG_PATH ?? 'ffmpeg',
  keepRawResponse: false,
};

export function getAppSettings(): AppSettings {
  return { ...DEFAULT_APP_SETTINGS, ...getSetting<Partial<AppSettings>>('app', {}) };
}

export function saveAppSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...getAppSettings(), ...patch };
  setSetting('app', next);
  return next;
}

/* ------------------------- 提示词库 ------------------------- */

interface PromptRow {
  id: string;
  source: string;
  category: string;
  name: string;
  description: string;
  template: string;
  variables_json: string;
  capability: string | null;
  tags_json: string;
  use_count: number;
  project_id: string | null;
  created_at: string;
  updated_at: string;
}

function mapPrompt(row: PromptRow): PromptTemplate {
  return {
    id: row.id,
    source: row.source as PromptTemplate['source'],
    category: row.category as PromptCategory,
    name: row.name,
    description: row.description,
    template: row.template,
    variables: parseJson<PromptTemplate['variables']>(row.variables_json, []),
    capability: (row.capability as PromptTemplate['capability']) ?? null,
    tags: parseJson<string[]>(row.tags_json, []),
    useCount: row.use_count,
    projectId: row.project_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listPromptTemplates(
  filter: { category?: string; query?: string; source?: string } = {},
): PromptTemplate[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.category) {
    clauses.push('category = ?');
    params.push(filter.category);
  }
  if (filter.source) {
    clauses.push('source = ?');
    params.push(filter.source);
  }
  if (filter.query) {
    clauses.push('(name LIKE ? OR description LIKE ? OR template LIKE ? OR tags_json LIKE ?)');
    const like = `%${filter.query}%`;
    params.push(like, like, like, like);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = getDb()
    .prepare(`SELECT * FROM prompt_templates ${where} ORDER BY use_count DESC, updated_at DESC`)
    .all(...(params as never[])) as unknown as PromptRow[];
  return rows.map(mapPrompt);
}

export function getPromptTemplate(id: string): PromptTemplate | null {
  const row = getDb().prepare('SELECT * FROM prompt_templates WHERE id = ?').get(id) as unknown as
    | PromptRow
    | undefined;
  return row ? mapPrompt(row) : null;
}

export function createPromptTemplate(
  input: Omit<PromptTemplate, 'id' | 'createdAt' | 'updatedAt' | 'useCount' | 'source' | 'variables'> & {
    id?: string;
    source?: PromptTemplate['source'];
    variables?: PromptTemplate['variables'];
    useCount?: number;
  },
): PromptTemplate {
  const id = input.id ?? `tpl_${createId(12)}`;
  const now = nowIso();
  const variables =
    input.variables && input.variables.length > 0
      ? input.variables
      : extractTemplateVariables(input.template).map((key) => ({ key, label: key }));

  getDb()
    .prepare(
      `INSERT INTO prompt_templates (id, source, category, name, description, template, variables_json, capability,
        tags_json, use_count, project_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET category = excluded.category, name = excluded.name,
         description = excluded.description, template = excluded.template, variables_json = excluded.variables_json,
         capability = excluded.capability, tags_json = excluded.tags_json, updated_at = excluded.updated_at`,
    )
    .run(
      id,
      input.source ?? 'custom',
      input.category,
      input.name,
      input.description,
      input.template,
      toJson(variables),
      input.capability ?? null,
      toJson(input.tags ?? []),
      input.useCount ?? 0,
      input.projectId ?? null,
      now,
      now,
    );
  return getPromptTemplate(id) as PromptTemplate;
}

export function updatePromptTemplate(
  id: string,
  patch: Partial<
    Pick<PromptTemplate, 'name' | 'description' | 'template' | 'category' | 'capability' | 'tags' | 'variables'>
  >,
): PromptTemplate {
  const fields: Record<string, unknown> = {};
  if (patch.name !== undefined) fields.name = patch.name;
  if (patch.description !== undefined) fields.description = patch.description;
  if (patch.template !== undefined) {
    fields.template = patch.template;
    fields.variables_json = toJson(
      patch.variables ?? extractTemplateVariables(patch.template).map((key) => ({ key, label: key })),
    );
  } else if (patch.variables !== undefined) {
    fields.variables_json = toJson(patch.variables);
  }
  if (patch.category !== undefined) fields.category = patch.category;
  if (patch.capability !== undefined) fields.capability = patch.capability;
  if (patch.tags !== undefined) fields.tags_json = toJson(patch.tags);

  if (Object.keys(fields).length > 0) {
    const { sql, values } = buildUpdate('prompt_templates', id, fields);
    getDb().prepare(sql).run(...(values as never[]));
  }
  return getPromptTemplate(id) as PromptTemplate;
}

export function incrementPromptUse(id: string): void {
  getDb()
    .prepare('UPDATE prompt_templates SET use_count = use_count + 1, updated_at = ? WHERE id = ?')
    .run(nowIso(), id);
}

export function deletePromptTemplate(id: string): void {
  getDb().prepare('DELETE FROM prompt_templates WHERE id = ? AND source = ?').run(id, 'custom');
}
