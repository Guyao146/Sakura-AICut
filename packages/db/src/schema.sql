-- ==========================================================
-- Sakura AI Cut 数据库结构（SQLite）
-- 时间字段统一 ISO-8601 字符串；嵌套结构以 JSON 文本存储
-- ==========================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- 项目
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  brief_json TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'brief',
  status TEXT NOT NULL DEFAULT 'draft',
  cover_media_id TEXT,
  last_export_url TEXT,
  last_opened_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at DESC);

-- 剧本（一个项目一份，整体存 JSON）
CREATE TABLE IF NOT EXISTS screenplays (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL DEFAULT '',
  raw TEXT,
  source TEXT NOT NULL DEFAULT 'ai',
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- 媒体（图片 / 视频 / 音频）
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  url TEXT NOT NULL,
  path TEXT,
  mime TEXT NOT NULL DEFAULT 'application/octet-stream',
  width INTEGER,
  height INTEGER,
  duration_sec REAL,
  file_size INTEGER,
  prompt TEXT,
  negative_prompt TEXT,
  model TEXT,
  provider_id TEXT,
  job_id TEXT,
  seed INTEGER,
  owner_type TEXT NOT NULL DEFAULT 'upload',
  owner_id TEXT,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_project ON media(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_owner ON media(owner_type, owner_id);

-- 资产（人物 / 场景 / 道具 / 风格）
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  ref_id TEXT,
  description TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL DEFAULT '',
  negative_prompt TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  media_ids_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  seed INTEGER,
  variants INTEGER NOT NULL DEFAULT 1,
  locked INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(project_id, sort_order);

-- 镜头
CREATE TABLE IF NOT EXISTS shots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  beat_id TEXT,
  episode INTEGER NOT NULL DEFAULT 1,
  description TEXT NOT NULL DEFAULT '',
  dialogue TEXT,
  narration TEXT,
  duration_sec REAL NOT NULL DEFAULT 5,
  shot_size TEXT NOT NULL DEFAULT '中景',
  camera_template_id TEXT,
  camera_prompt TEXT,
  character_ids_json TEXT NOT NULL DEFAULT '[]',
  prop_ids_json TEXT NOT NULL DEFAULT '[]',
  location_id TEXT,
  prompt TEXT NOT NULL DEFAULT '',
  negative_prompt TEXT,
  first_frame_media_id TEXT,
  last_frame_media_id TEXT,
  clip_media_ids_json TEXT NOT NULL DEFAULT '[]',
  selected_media_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shots_project ON shots(project_id, sort_order);

-- 时间线（一个项目一份）
CREATE TABLE IF NOT EXISTS timelines (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE,
  version INTEGER NOT NULL DEFAULT 1,
  fps INTEGER NOT NULL DEFAULT 30,
  width INTEGER NOT NULL DEFAULT 1080,
  height INTEGER NOT NULL DEFAULT 1920,
  tracks_json TEXT NOT NULL DEFAULT '[]',
  duration_sec REAL NOT NULL DEFAULT 0,
  render_status TEXT,
  render_progress REAL NOT NULL DEFAULT 0,
  render_output_url TEXT,
  render_job_id TEXT,
  rendered_at TEXT,
  export_preset_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 自定义运镜模板
CREATE TABLE IF NOT EXISTS camera_moves (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '特殊',
  description TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL DEFAULT '',
  usage TEXT,
  frame_mode TEXT,
  params_json TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 提示词库
CREATE TABLE IF NOT EXISTS prompt_templates (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'custom',
  category TEXT NOT NULL DEFAULT 'other',
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  template TEXT NOT NULL DEFAULT '',
  variables_json TEXT NOT NULL DEFAULT '[]',
  capability TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  use_count INTEGER NOT NULL DEFAULT 0,
  project_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prompt_category ON prompt_templates(category);

-- 供应商（凭证加密存储）
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  protocol TEXT NOT NULL,
  base_url TEXT NOT NULL,
  credentials_enc TEXT,
  extra_headers_json TEXT,
  proxy_url TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  concurrency INTEGER NOT NULL DEFAULT 3,
  timeout_sec INTEGER NOT NULL DEFAULT 300,
  models_json TEXT NOT NULL DEFAULT '[]',
  remark TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 模型路由（每种能力一条）
CREATE TABLE IF NOT EXISTS model_routes (
  capability TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  fallbacks_json TEXT NOT NULL DEFAULT '[]',
  params_json TEXT,
  updated_at TEXT NOT NULL
);

-- 任务队列
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  progress REAL NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  remote_task_id TEXT,
  scheduled_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  heartbeat_at TEXT,
  target_type TEXT,
  target_id TEXT,
  stage_label TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, priority DESC, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_jobs_target ON jobs(target_type, target_id);

CREATE TABLE IF NOT EXISTS job_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  data_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_job_events ON job_events(job_id, created_at);

-- Agent 计划
CREATE TABLE IF NOT EXISTS agent_plans (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  goal TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  question TEXT,
  steps_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'planning',
  cursor INTEGER NOT NULL DEFAULT 0,
  auto_approve INTEGER NOT NULL DEFAULT 0,
  job_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plans_project ON agent_plans(project_id, created_at DESC);

-- Agent 对话记录
CREATE TABLE IF NOT EXISTS agent_turns (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  tool_name TEXT,
  data_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_turns_plan ON agent_turns(plan_id, created_at);

-- 剧本助手对话（第二步侧栏）
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'general',
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  template_id TEXT,
  token_usage INTEGER,
  model TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_project ON chat_messages(project_id, scope, created_at);

-- 画布素材（无限画布上的文字 / 图片 / 视频 / 语音）
CREATE TABLE IF NOT EXISTS canvas_items (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  media_id TEXT,
  url TEXT,
  text TEXT NOT NULL DEFAULT '',
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  width REAL NOT NULL DEFAULT 0,
  height REAL NOT NULL DEFAULT 0,
  z INTEGER NOT NULL DEFAULT 0,
  rotation REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_canvas_project ON canvas_items(project_id, z, created_at);

-- 画布连线（节点之间的叙事顺序 / 引用关系）
CREATE TABLE IF NOT EXISTS canvas_edges (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (source_id) REFERENCES canvas_items(id) ON DELETE CASCADE,
  FOREIGN KEY (target_id) REFERENCES canvas_items(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_canvas_edges_project ON canvas_edges(project_id);

-- 画布分组（把一组素材/镜头打包成场景卡片）
CREATE TABLE IF NOT EXISTS canvas_groups (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '未命名场景',
  color TEXT NOT NULL DEFAULT '#f472b6',
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  width REAL NOT NULL DEFAULT 600,
  height REAL NOT NULL DEFAULT 400,
  z INTEGER NOT NULL DEFAULT -1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_canvas_groups_project ON canvas_groups(project_id);

-- 分组与素材的关联（一个素材只属于一个分组）
CREATE TABLE IF NOT EXISTS canvas_group_items (
  group_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  PRIMARY KEY (group_id, item_id),
  FOREIGN KEY (group_id) REFERENCES canvas_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES canvas_items(id) ON DELETE CASCADE
);

-- 全局设置（键值）
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 迁移记录
CREATE TABLE IF NOT EXISTS migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

