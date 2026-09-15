/**
 * 统一的 HTTP 调用工具：超时、重试、JSON 解析、SSE 流式读取
 */

export interface RequestOptions {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  /** 是否对 5xx / 网络错误重试 */
  retryOn5xx?: boolean;
  signal?: AbortSignal;
}

export class HttpError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly url: string;

  constructor(message: string, status: number, url: string, body?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new Error('aborted'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  if (!signal) return AbortSignal.timeout(timeoutMs);
  // 组合外部取消信号与超时信号
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal.reason);
  if (signal.aborted) controller.abort(signal.reason);
  else signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  return controller.signal;
}

export async function fetchJson<T = unknown>(
  url: string,
  init: RequestInit = {},
  options: RequestOptions = {},
): Promise<T> {
  const { timeoutMs = 120_000, retries = 2, retryDelayMs = 800, retryOn5xx = true, signal } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, {
        ...init,
        signal: withTimeout(signal, timeoutMs),
      });
      const text = await res.text();

      if (!res.ok) {
        const err = new HttpError(
          `HTTP ${res.status} ${res.statusText} @ ${url}${text ? ` :: ${text.slice(0, 500)}` : ''}`,
          res.status,
          url,
          safeJson(text),
        );
        // 4xx（除 429）不重试
        if (res.status < 500 && res.status !== 429) throw err;
        lastError = err;
      } else {
        if (!text) return undefined as T;
        const parsed = safeJson(text);
        return (parsed === undefined ? (text as unknown as T) : (parsed as T));
      }
    } catch (error) {
      lastError = error;
      const err = error as HttpError;
      if (err instanceof HttpError && err.status < 500 && err.status !== 429) throw err;
      if (!retryOn5xx) throw error;
    }

    if (attempt < retries) {
      await sleep(retryDelayMs * (attempt + 1), signal);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function safeJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * 轮询直到条件满足（用于供应商异步任务）
 */
export async function pollUntil<T>(
  fn: () => Promise<T>,
  isDone: (value: T) => boolean,
  options: { intervalMs?: number; timeoutMs?: number; onTick?: (value: T) => void; signal?: AbortSignal } = {},
): Promise<T> {
  const { intervalMs = 3000, timeoutMs = 15 * 60 * 1000, onTick, signal } = options;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (signal?.aborted) throw new Error('任务已取消');
    const value = await fn();
    onTick?.(value);
    if (isDone(value)) return value;
    if (Date.now() > deadline) throw new Error('异步任务轮询超时');
    await sleep(intervalMs, signal);
  }
}

/**
 * 读取 SSE 流（OpenAI 兼容的 stream=true）
 */
export async function readSseLines(
  response: Response,
  onEvent: (data: string) => void,
): Promise<void> {
  const body = response.body;
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') return;
      onEvent(data);
    }
  }
}

/** 把远程文件下载到本地（用于持久化供应商生成的临时链接） */
export async function downloadToBuffer(
  url: string,
  options: RequestOptions = {},
): Promise<{ buffer: Uint8Array; contentType: string }> {
  const res = await fetch(url, { signal: withTimeout(options.signal, options.timeoutMs ?? 300_000) });
  if (!res.ok) throw new HttpError(`下载失败 HTTP ${res.status}`, res.status, url);
  const arrayBuffer = await res.arrayBuffer();
  return {
    buffer: new Uint8Array(arrayBuffer),
    contentType: res.headers.get('content-type') ?? 'application/octet-stream',
  };
}
