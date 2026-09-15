/**
 * 轻量 ID 生成（不引入额外依赖，Node 与浏览器均可用）
 */

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function randomBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < size; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

/** 生成短 ID，默认 16 位，可用于数据库主键 */
export function createId(size = 16): string {
  const bytes = randomBytes(size);
  let out = '';
  for (let i = 0; i < size; i += 1) out += ALPHABET[(bytes[i] ?? 0) % ALPHABET.length];
  return out;
}

/** 带前缀的 ID，例如 shot_ab12cd34 */
export function prefixedId(prefix: string, size = 12): string {
  return `${prefix}_${createId(size)}`;
}

/** 稳定的时间排序 ID：时间戳(36) + 随机 */
export function timeOrderedId(size = 8): string {
  return `${Date.now().toString(36)}${createId(size)}`;
}
