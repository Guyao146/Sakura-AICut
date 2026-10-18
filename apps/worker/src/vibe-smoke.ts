import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** 镜像烟测使用独立数据目录，不污染应用数据库。 */
const dir = mkdtempSync(join(tmpdir(), 'sakura-render-smoke-'));
mkdirSync(join(dir, 'data'));
process.env.SAKURA_DATA_DIR = join(dir, 'data');
process.env.SAKURA_DB_FILE = join(dir, 'data', 'smoke.db');
const db = await import('@sakura/db');
const { renderVibeVideo, closeVibeBrowser } = await import('./vibe-render');
try {
  const project = db.createProject({ name: '渲染自检', mode: 'vibe', aspectRatio: '1:1' });
  db.createVibeProject(project.id, '颜色变化');
  db.updateVibeProject(project.id, {
    script: { shots: [{ id: 'test', index: 1, durationSec: 0.25, visualDescription: '颜色变化', narration: '' }] },
    code: `<!doctype html><html><body><script>
      window.__vibeMeta={durationSec:0.25,fps:24,width:1024,height:1024};
      window.__vibeSeek=function(t){document.body.style.background=t<0.1?'#ec4899':'#38bdf8';};
      window.__vibeSeek(0);
    </script></body></html>`,
  });
  const result = await renderVibeVideo(project.id, { timeoutMs: 60_000 });
  const probe = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'json', result.outputPath], { encoding: 'utf8' });
  if (probe.status !== 0 || JSON.parse(probe.stdout).streams[0].nb_read_frames !== '6') throw new Error('渲染自检失败');
  console.log('渲染自检通过：浏览器沙箱与编码器可用');
} finally {
  await closeVibeBrowser();
  db.closeDb();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
}
