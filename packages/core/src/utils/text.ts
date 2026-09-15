/**
 * 文本与模板处理工具
 */

export type TemplateVars = Record<string, string | number | boolean | null | undefined>;

/**
 * 渲染模板：
 * - 变量替换：{{name}}
 * - 条件块：{{#if name}}...{{/if}} 与 {{#if name}}...{{else}}...{{/if}}
 * - 列表循环很复杂，此处不做，改用变量预拼接
 */
export function renderTemplate(template: string, vars: TemplateVars): string {
  let out = template.replace(
    /\{\{#if\s+([\w.]+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g,
    (_m, key: string, truthy: string, falsy?: string) => {
      const value = vars[key];
      const ok = value !== undefined && value !== null && value !== '' && value !== false && value !== 0;
      return ok ? truthy : (falsy ?? '');
    },
  );

  out = out.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
    const value = vars[key];
    return value === undefined || value === null ? '' : String(value);
  });

  return normalizeSpaces(out);
}

export function normalizeSpaces(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** 拼接非空片段，用逗号分隔（提示词拼接常用） */
export function joinPrompt(parts: Array<string | null | undefined | false>, sep = ', '): string {
  return parts
    .map((p) => (typeof p === 'string' ? p.trim().replace(/[,，]\s*$/, '') : ''))
    .filter((p) => p.length > 0)
    .join(sep);
}

export function truncate(text: string, max = 120): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/** 粗略中文 token 估算：中文 1 字 ≈ 1 token，英文 4 字符 ≈ 1 token */
export function estimateTokens(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fa5]/g) ?? []).length;
  const others = text.length - cjk;
  return cjk + Math.ceil(others / 4);
}

/** 从 LLM 返回内容中剥离 ```json 代码块 */
export function stripCodeFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) return fenced[1].trim();
  return text.trim();
}

/** 尽力从模型输出中解析 JSON（容忍前后废话与常见格式错误） */
export function extractJson<T = unknown>(text: string): T {
  const cleaned = stripCodeFence(text);
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // 退而求其次：截取第一个 { 到最后一个 }
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const slice = cleaned.slice(start, end + 1);
      return JSON.parse(slice) as T;
    }
    throw new Error('无法从模型输出中解析 JSON');
  }
}

/** 秒 → mm:ss */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return `${String(m).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}
