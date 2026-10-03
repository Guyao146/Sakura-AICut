import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * 供应商凭证加密存储（AES-256-GCM）
 *
 * 密钥来源优先级：
 *   1. SAKURA_SECRET 环境变量（用户显式配置，最高优先级）
 *   2. 由 @sakura/db 在启动期注入的持久化随机密钥（<数据目录>/.sakura_secret）
 *   3. 旧版公开默认密钥（仅本地开发兜底，生产环境会显著削弱凭证保护）
 *
 * core 不反向依赖 db，所以持久化密钥通过 setEncryptionSecretResolver 注入。
 */

const LEGACY_SECRET = 'sakura-aicut-dev-secret-do-not-use-in-production';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const SALT = 'sakura-aicut-v1';

let cachedKey: Buffer | null = null;
let secretResolver: () => string = () => process.env.SAKURA_SECRET?.trim() || LEGACY_SECRET;

/**
 * 启动期由 @sakura/db 调用，注入数据目录下持久化的随机密钥。
 * 必须在任何 encryptJson / decryptJson 调用之前执行（bootstrap 里第一时间完成）。
 */
export function setEncryptionSecretResolver(resolver: () => string): void {
  secretResolver = resolver;
  cachedKey = null;
}

function keyFromSecret(secret: string): Buffer {
  return scryptSync(secret, SALT, KEY_LENGTH);
}

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = secretResolver();
  if (!process.env.SAKURA_SECRET?.trim() && secret === LEGACY_SECRET) {
    console.warn(
      '[sakura] 供应商凭证正在用公开的默认密钥加密，生产环境请设置 SAKURA_SECRET 环境变量。',
    );
  }
  cachedKey = keyFromSecret(secret);
  return cachedKey;
}

/** 加密 JSON 对象 → base64 字符串（iv.tag.cipher 三段式） */
export function encryptJson(value: unknown): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.');
}

/** 用旧版公开默认密钥解密；仅供从默认密钥迁移到持久化随机密钥时使用 */
export function decryptJsonLegacy<T = Record<string, string>>(payload: string | null | undefined): T | null {
  return decryptWithSecret<T>(payload, LEGACY_SECRET);
}

/** 用指定密钥解密；仅在升级迁移时使用（旧库可能用的是早期版本的公开默认密钥） */
export function decryptWithSecret<T = Record<string, string>>(
  payload: string | null | undefined,
  secret: string,
): T | null {
  return decryptWithKey<T>(payload, keyFromSecret(secret));
}

function decryptWithKey<T>(payload: string | null | undefined, key: Buffer): T | null {
  if (!payload) return null;
  try {
    const [ivB64, tagB64, dataB64] = payload.split('.');
    if (!ivB64 || !tagB64 || !dataB64) return null;
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
    return JSON.parse(dec.toString('utf8')) as T;
  } catch {
    return null;
  }
}

/** 解密 → 对象；失败返回 null */
export function decryptJson<T = Record<string, string>>(payload: string | null | undefined): T | null {
  return decryptWithKey<T>(payload, getKey());
}

/** 打码显示，例如 sk-1234****abcd */
export function maskSecret(value: string | undefined | null): string {
  if (!value) return '';
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

/** 常量时间比较 */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
