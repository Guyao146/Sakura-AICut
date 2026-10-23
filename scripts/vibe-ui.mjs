import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fork, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testCode, testScript, testAudio } from './vibe-fixture.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const browserRequire = createRequire(join(root, 'apps/worker/package.json'));
const { chromium } = browserRequire('playwright');
const data = mkdtempSync(join(tmpdir(), 'sakura-vibe-ui-'));
process.env.SAKURA_DATA_DIR = data;
process.env.SAKURA_DB_FILE = join(data, 'ui.db');
process.env.SAKURA_SECRET = randomBytes(32).toString('hex');
mkdirSync(join(root, '.tmp-check'), { recursive: true });
writeFileSync(join(root, '.tmp-check/vibe-ui-process.log'), '');
const db = await import('../packages/db/src/index.ts');
const { fileTasksAdapter } = await import('../packages/core/src/ai/adapters/file-tasks.ts');
const { createSessionToken, SESSION_COOKIE } = await import('../apps/web/src/lib/session.ts');
const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
  if (request.url === '/v1/get_voice') {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ base_resp: { status_code: 0 }, system_voice: [
      { voice_id: 'test-voice', voice_name: '测试旁白', description: ['清晰自然'] },
    ] }));
    return;
  }
  if (request.url === '/v1/t2a_v2') {
    assert.equal(body.voice_setting.voice_id, 'test-voice');
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ base_resp: { status_code: 0 }, data: { audio: testAudio().toString('hex') } }));
    return;
  }
  if (request.url === '/v1/audio/speech') {
    response.setHeader('Content-Type', 'audio/wav');
    response.end(testAudio());
    return;
  }
  const planning = body.messages?.[0]?.content.includes('- jobs.status');
  const query = body.messages?.[1]?.content.includes('【用户目标】查看当前任务进度和错误');
  const plan = { summary: query ? '查看任务进度' : '调整动画草稿', steps: [query
    ? { title: '查看进度', rationale: '只读查询', tool: 'jobs.status', args: {} }
    : { title: '修改动画', rationale: '按用户要求', tool: 'vibe.revise', args: { instructions: '把相遇改成重逢' } }] };
  const revised = body.messages?.[1]?.content.includes('重逢');
  const script = revised ? { shots: testScript.shots.map((shot) => ({ ...shot, narration: shot.narration.replace('相遇', '重逢') })) } : testScript;
  const code = revised ? testCode.replace('相遇', '重逢') : testCode;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ choices: [{ message: { content: body.response_format ? JSON.stringify(planning ? plan : script) : code } }] }));
});
const processes = [];
let browser;
let log = '';
const capture = (child) => {
  processes.push(child);
  const record = (chunk) => {
    log = (log + chunk).slice(-30000);
    appendFileSync(join(root, '.tmp-check/vibe-ui-process.log'), chunk);
  };
  child.stdout?.on('data', record);
  child.stderr?.on('data', record);
  return child;
};
async function waitUntil(check, timeout = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (processes.some((child) => child.exitCode !== null)) throw new Error(`测试服务提前退出：${log.slice(-1000)}`);
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('界面验收等待超时');
}

async function verifyUI() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const provider = db.createProvider({ name: '界面验收模型', protocol: 'openai', baseUrl: `http://127.0.0.1:${server.address().port}`,
    models: [{ id: 'test-text', label: '测试文本', capability: 'text', mode: 'sync' },
      { id: 'test-audio', label: '测试语音', capability: 'audio', mode: 'sync' }] });
  db.upsertModelRoute({ capability: 'text', providerId: provider.id, modelId: 'test-text' });
  const speech = db.createProvider({ name: '音色验收接口', protocol: fileTasksAdapter.protocol, baseUrl: `http://127.0.0.1:${server.address().port}`,
    models: [{ id: 'test-audio', label: '测试语音', capability: 'audio', mode: 'sync' }] });
  db.upsertModelRoute({ capability: 'audio', providerId: speech.id, modelId: 'test-audio' });
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const env = { ...process.env, PORT: String(port), APP_URL: origin, NODE_ENV: 'production' };
  const deployment = join(data, 'deployment');
  const built = join(root, 'apps/web/.next');
  if (!existsSync(join(built, 'BUILD_ID'))) throw new Error('请先完成 pnpm build，再运行工作台验收');
  // 本地 UI 验收复用已安装依赖，避免复制包管理器的符号链接；独立镜像由容器烟测验证。
  cpSync(join(built, 'standalone'), deployment, { recursive: true, filter: (source) => basename(source) !== 'node_modules' });
  symlinkSync(join(root, 'apps/web/node_modules'), join(deployment, 'apps/web/node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  cpSync(join(built, 'static'), join(deployment, 'apps/web/.next/static'), { recursive: true });
  cpSync(join(root, 'apps/web/public'), join(deployment, 'apps/web/public'), { recursive: true });
  const app = capture(fork(join(deployment, 'apps/web/server.js'), [], {
    cwd: deployment, env: { ...env, HOSTNAME: '127.0.0.1' }, execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  }));
  await waitUntil(async () => {
    if (app.exitCode !== null) throw new Error(`测试 Web 提前退出：${log.slice(-1000)}`);
    try { return (await fetch(`${origin}/login`)).status === 200; } catch { return false; }
  });
  browser = await chromium.launch({ chromiumSandbox: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: SESSION_COOKIE, value: createSessionToken(), url: origin }]);
  const page = await context.newPage();
  const invalidOrigin = await page.request.post(`${origin}/api/vibe/music`, { headers: { Origin: 'https://untrusted.example.test' } });
  assert.equal(invalidOrigin.status(), 403);
  page.setDefaultTimeout(10_000);
  console.log('Web 已启动，开始界面验收');
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const response = await page.goto(origin);
  assert.equal(response.headers()['content-security-policy'], "frame-src 'none'");
  await page.getByRole('tab', { name: 'Vibe 直出', exact: false }).click();
  await page.getByLabel('项目名称', { exact: true }).fill('界面验收');
  await page.getByLabel('创作主题', { exact: true }).fill('相遇');
  await page.getByLabel('画幅比例').selectOption('1:1');
  await page.getByLabel('目标时长（秒）').fill('3');
  await page.getByRole('button', { name: '创建并生成动画草稿', exact: true }).click();
  await page.waitForURL(/\/studio\/prj_/);
  console.log('已创建项目并进入工作台');
  const id = page.url().split('/').pop();
  assert.equal(db.getVibeProject(id).renderStatus, 'queued');
  await page.getByRole('button', { name: '取消任务', exact: true }).click();
  await waitUntil(() => db.getVibeProject(id).renderStatus === 'canceled');
  await page.getByRole('button', { name: '生成动画草稿', exact: true }).click();
  console.log('取消成功，已提交一键生成');
  capture(fork(join(root, 'apps/worker/src/index.ts'), [], {
    cwd: join(root, 'apps/worker'), env: { ...env, WORKER_CONCURRENCY: '1', WORKER_POLL_INTERVAL: '300', TSX_TSCONFIG_PATH: join(root, 'apps/worker/tsconfig.json') },
    execArgv: ['--import', 'tsx'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  }));
  await verifyStudio(page, id, errors);
}

async function verifyStudio(page, id, errors) {
  await waitUntil(() => db.getVibeProject(id).code && db.getVibeProject(id).renderStatus === 'idle');
  console.log('动画草稿完成，开始预览与确认验收');
  assert.equal(db.listMedia(id).length, 0, '未确认不得生成成片');
  await page.getByRole('button', { name: '启动隔离预览', exact: true }).waitFor({ timeout: 20_000 });
  assert.equal(await page.getByRole('button', { name: '确认并导出最终视频', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '启动隔离预览', exact: true }).click();
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await page.frameLocator('iframe[title="动画预览"]').locator('#caption').getByText('相遇', { exact: true }).waitFor();
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.waitForTimeout(150);
  const frame = page.frames().find((entry) => entry.url() === 'about:srcdoc');
  assert.ok(frame);
  const position = await frame.locator('#petal').evaluate((node) => node.style.left);
  await page.waitForTimeout(300);
  assert.equal(await frame.locator('#petal').evaluate((node) => node.style.left), position);
  await page.getByRole('button', { name: '停止预览', exact: true }).click();
  await page.getByLabel('确认当前动画版本', { exact: true }).check();
  await page.getByRole('button', { name: '查看 / 编辑代码', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('input[aria-label="确认当前动画版本"]').checked);
  assert.equal(await page.getByLabel('确认当前动画版本', { exact: true }).isChecked(), false);
  await page.getByLabel('动画代码').fill(testCode.replace('相遇', '重逢'));
  assert.equal(await page.getByRole('button', { name: '确认并导出最终视频', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await waitUntil(() => db.getVibeProject(id).code.includes('重逢'));
  await page.getByLabel('与 Agent 沟通', { exact: true }).fill('把相遇改成重逢');
  await page.getByRole('button', { name: '启动 Agent', exact: true }).click();
  await waitUntil(() => db.listJobs({ projectId: id }).some((job) => job.type === 'vibe.revise' && job.status === 'succeeded'));
  assert.equal(db.getVibeProject(id).script.shots[1].narration, '重逢');
  assert.equal(db.getVibeProject(id).outputUrl, null);
  await page.reload();
  await page.getByLabel('与 Agent 沟通', { exact: true }).fill('查看当前任务进度和错误');
  await page.getByRole('button', { name: '启动 Agent', exact: true }).click();
  await waitUntil(() => db.listPlans(id, 1)[0]?.steps.some((step) => step.tool === 'jobs.status' && step.status === 'succeeded'));
  await page.reload();
  await page.getByLabel('启用旁白配音', { exact: true }).check();
  await page.getByRole('button', { name: '加载可用音色', exact: true }).click();
  await page.getByLabel('选择配音音色', { exact: true }).selectOption('test-voice');
  assert.equal(await page.getByLabel('配音音色', { exact: true }).inputValue(), 'test-voice');
  await page.getByLabel('配音语速', { exact: true }).fill('1.2');
  await page.getByRole('button', { name: '生成音色试听', exact: true }).click();
  await page.getByLabel('音色试听', { exact: true }).waitFor();
  assert.equal(db.listMedia(id).length, 0, '音色试听不保存媒体');
  // 超过框架默认的 10MB 限制，验证独立音乐上传路径可完整接收。
  const music = testAudio(240);
  assert.ok(music.length > 10 * 1024 * 1024);
  const uploading = page.waitForResponse((response) => response.url().endsWith('/api/vibe/music'));
  await page.getByLabel('上传背景音乐', { exact: true }).setInputFiles({ name: '背景音乐.wav', mimeType: 'audio/wav', buffer: music });
  const uploadResponse = await uploading;
  const uploaded = await uploadResponse.json();
  assert.equal(uploadResponse.status(), 200, JSON.stringify(uploaded));
  assert.equal(uploaded.ok, true, JSON.stringify(uploaded));
  assert.equal(uploaded.data.fileSize, music.length, '上传音乐不能被截断');
  await page.getByLabel('背景音乐试听', { exact: true }).waitFor();
  await page.getByLabel('背景音乐音量', { exact: true }).fill('0.15');
  assert.equal(await page.getByLabel('确认当前动画版本', { exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '保存音频设置', exact: true }).click();
  await waitUntil(() => db.getVibeProject(id).dubbing.enabled);
  assert.equal(db.getVibeProject(id).dubbing.music.volume, 0.15);
  await page.reload();
  assert.equal(await page.getByLabel('配音音色', { exact: true }).inputValue(), 'test-voice');
  assert.equal(await page.getByLabel('背景音乐音量', { exact: true }).inputValue(), '0.15');
  await page.getByLabel('背景音乐试听', { exact: true }).waitFor();
  await page.getByLabel('确认当前动画版本', { exact: true }).check();
  await page.getByRole('button', { name: '确认并导出最终视频', exact: true }).click();
  await waitUntil(() => db.getVibeProject(id).renderStatus === 'succeeded');
  await page.reload();
  assert.equal(await page.getByRole('link', { name: '下载 MP4', exact: true }).count(), 1);
  assert.equal(db.listMedia(id).length, 2);
  const link = page.getByRole('link', { name: '下载 MP4', exact: true });
  const url = await link.getAttribute('href');
  const file = await page.request.get(new URL(url, page.url()).href);
  assert.equal(file.status(), 200);
  assert.equal(file.headers()['content-type'], 'video/mp4');
  const body = await file.body();
  assert.ok(body.length > 1000);
  const probe = spawnSync(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', join(data, db.listMedia(id).find((media) => media.kind === 'video').path)], { encoding: 'utf8' });
  assert.equal(probe.status, 0, probe.stderr);
  assert.ok(JSON.parse(probe.stdout).streams.some((stream) => stream.codec_type === 'audio'));
  const partial = await page.request.get(new URL(url, page.url()).href, { headers: { Range: 'bytes=0-31' } });
  assert.equal(partial.status(), 206);
  assert.equal((await partial.body()).length, 32);
  const downloadPending = page.waitForEvent('download');
  await link.click();
  const download = await downloadPending;
  assert.equal(await download.failure(), null);
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    if (video?.error) throw new Error(`成片加载失败：${video.error.code} ${video.error.message}`);
    return video && video.readyState >= 2;
  });
  assert.ok(Math.abs(await page.locator('video').evaluate((video) => video.duration) - 3) < 0.05);
  await page.locator('video').evaluate(async (video) => { video.muted = true; await video.play(); });
  await page.waitForFunction(() => document.querySelector('video').currentTime > 0.2);
  await page.locator('video').evaluate((video) => video.pause());
  await page.screenshot({ path: join(root, '.tmp-check/vibe-ui-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(root, '.tmp-check/vibe-ui-mobile.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true,
    JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll('body *')).filter((node) => node.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 10).map((node) => ({ tag: node.tagName, class: node.className, right: node.getBoundingClientRect().right })))));
  assert.deepEqual(errors, []);
  console.log('工作台验收通过：草稿预览与 Agent 修改→加载音色与试听→上传超过 10 MiB 音乐→保存和刷新→确认导出混音成片；桌面与移动布局无横向溢出');
}

try { await verifyUI(); }
finally {
  await browser?.close();
  for (const child of processes.reverse()) {
    if (child.exitCode !== null) continue;
    if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
    else child.kill('SIGTERM');
  }
  writeFileSync(join(root, '.tmp-check/vibe-ui-process.log'), log);
  await new Promise((resolve) => server.close(resolve));
  db.closeDb();
  rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
