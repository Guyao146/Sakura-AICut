import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { closeDb, dataDir, getDb } from './client';
import { bootstrap } from './seed';

/**
 * 数据库初始化 / 重置 CLI
 *   pnpm db:migrate      执行建表 + 写入内置数据
 *   pnpm db:reset        删除数据库文件后重建（危险）
 */
function main(): void {
  const reset = process.argv.includes('--reset');

  if (reset) {
    const dir = dataDir();
    for (const file of ['sakura.db', 'sakura.db-wal', 'sakura.db-shm']) {
      const target = join(dir, file);
      if (existsSync(target)) {
        rmSync(target, { force: true });
        console.log(`已删除 ${target}`);
      }
    }
  }

  getDb();
  console.log(`数据库已就绪：${join(dataDir(), 'sakura.db')}`);

  const result = bootstrap();
  console.log(`内置数据：新增 ${result.seededPrompts} 条提示词模板`);

  closeDb();
}

main();
