import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setEncryptionSecretResolver } from '@sakura/core/server';
import { dataDir } from './client';

/**
 * 供应商凭证的加密密钥初始化
 *
 * 优先级（与 @sakura/core/utils/crypto 的约定一致）：
 *   1. SAKURA_SECRET 环境变量（部署方显式配置，最高优先级）
 *   2. 数据目录下的持久化随机密钥（<dataDir>/.sakura_secret），首次使用时自动生成
 *
 * 历史问题：早期版本没有第 2 级，未配置 SAKURA_SECRET 时会回落到源码里的
 * 公开常量，等于明文存储。现在由本模块在 getDb() 首次调用时注入随机密钥，
 * 老库凭证由 system.mapProvider 读取时顺带迁移（见 migrateCredentials）。
 */

const SECRET_FILENAME = '.sakura_secret';
const SECRET_BYTES = 32;

let initialized = false;

export function initEncryptionSecret(): void {
  if (initialized) return;
  initialized = true;

  const configured = process.env.SAKURA_SECRET?.trim();
  if (configured) {
    // 显式配置时不做任何兜底，行为完全由部署方掌控
    setEncryptionSecretResolver(() => configured);
    return;
  }

  let cached: string | null = null;
  const readOrCreate = (): string => {
    if (cached !== null) return cached;
    const file = join(dataDir(), SECRET_FILENAME);
    if (existsSync(file)) {
      const stored = readFileSync(file, 'utf8').trim();
      if (stored.length > 0) {
        cached = stored;
        return stored;
      }
    }
    // 没有就生成一份 256bit 随机密钥并持久化（0600，仅属主可读）
    mkdirSync(dataDir(), { recursive: true });
    const secret = randomBytes(SECRET_BYTES).toString('hex');
    writeFileSync(file, secret, { mode: 0o600 });
    console.warn('[sakura] 未配置 SAKURA_SECRET，已生成数据目录内的持久化随机密钥。生产环境建议显式设置 SAKURA_SECRET 环境变量。');
    cached = secret;
    return secret;
  };
  setEncryptionSecretResolver(readOrCreate);
}
