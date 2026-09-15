/**
 * @sakura/core/server —— 服务端入口（含 Node 专属依赖）
 * 在 Next.js 的 API 路由 / Server Action、以及 worker 中使用。
 */

export { ADAPTERS, getAdapter, SUPPORTED_PROTOCOLS } from './ai/registry';
export { resolveRoute, RouteError, modelSupports } from './ai/router';
export type { RouteResolution } from './ai/router';

export {
  decryptJson,
  encryptJson,
  maskSecret,
  safeCompare,
} from './utils/crypto';

export {
  downloadToBuffer,
  fetchJson,
  HttpError,
  pollUntil,
  readSseLines,
  safeJson,
  sleep,
} from './utils/http';
export type { RequestOptions } from './utils/http';

// 同时转发客户端安全的内容，服务端只需引一个入口
export * from './index';
