import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'package.json'));
const result = spawnSync(process.execPath, [require.resolve('tsx/cli'), '--tsconfig', join(root, 'apps/web/tsconfig.json'),
  '--test', join(root, 'scripts/vibe-integration.test.mjs'), join(root, 'scripts/vibe-preview.test.mjs')], {
  cwd: root, env: { ...process.env, VIBE_RENDER_LIVE: '1' }, stdio: 'inherit', timeout: 180_000,
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
