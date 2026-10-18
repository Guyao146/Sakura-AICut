import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { mkdtempSync, rmSync, readdirSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { testScript, testMeta, testCode } from './vibe-fixture.mjs';

const data = mkdtempSync(join(tmpdir(), 'sakura-vibe-'));
process.env.SAKURA_DATA_DIR = data;
process.env.SAKURA_DB_FILE = join(data, 'test.db');
const db = await import('../packages/db/src/index.ts');
const core = await import('../packages/core/src/index.ts');
const pipeline = await import('../packages/pipeline/src/index.ts');
const { HANDLERS } = await import('../apps/worker/src/handlers.ts');
const { renderVibeVideo, closeVibeBrowser } = await import('../apps/worker/src/vibe-render.ts');
const { GET: serveFile } = await import('../apps/web/src/app/api/files/[...path]/route.ts');
const live = process.env.VIBE_RENDER_LIVE === '1';
const requests = [];
let scriptResponse = testScript;
let codeResponse = testCode;
let onRequest = () => {};
const server = createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    requests.push({ url: request.url, body });
    onRequest(body);
    assert.equal(request.url, '/v1/chat/completions');
    const content = body.response_format?.type === 'json_object' ? JSON.stringify(scriptResponse) : codeResponse;
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content } }] }));
  } catch (error) { response.writeHead(500); response.end(String(error)); }
});
const originalFetch = globalThis.fetch;
let base;
before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    assert.equal(url.origin, base, '禁止测试连接模拟服务器之外的服务');
    return originalFetch(input, init);
  };
  const provider = db.createProvider({ name: '本地测试模型', protocol: 'openai', baseUrl: base,
    models: [{ id: 'test-text', label: '测试文本', capability: 'text', mode: 'sync' }] });
  db.upsertModelRoute({ capability: 'text', providerId: provider.id, modelId: 'test-text' });
});
beforeEach(() => {
  requests.length = 0; scriptResponse = testScript; codeResponse = testCode; onRequest = () => {};
  for (const job of db.listJobs({ status: ['pending', 'queued', 'running'], limit: -1 })) db.cancelJob(job.id);
});
after(async () => {
  await closeVibeBrowser();
  globalThis.fetch = originalFetch;
  await new Promise((resolve) => server.close(resolve));
  db.closeDb();
  rmSync(data, { recursive: true, force: true, maxRetries: 5 });
});

function project() {
  const p = db.createProject({ name: '动画测试', mode: 'vibe', aspectRatio: '1:1', targetDurationSec: 3 });
  db.createVibeProject(p.id, '相遇');
  return p;
}
async function execute(pending) {
  const job = db.claimNextJob([pending.type]);
  assert.equal(job.id, pending.id);
  try {
    const result = await HANDLERS[job.type]({ job,
      progress: (percent, stage) => db.updateJob(job.id, { progress: percent, stageLabel: stage }),
      log: () => {}, isCanceled: () => db.getJob(job.id)?.status === 'canceled',
    });
    db.completeJob(job.id, result);
    return result;
  } catch (error) { db.failJob(job.id, String(error)); throw error; }
}
function mediaFiles(projectId) {
  const folder = join(data, 'media', projectId);
  return existsSync(folder) ? readdirSync(folder) : [];
}
function prepared(code = testCode) {
  const p = project();
  db.updateVibeProject(p.id, { script: testScript, code });
  return p;
}

test('schema 拒绝无效时长、重复场次、乱序、非法画幅与超大代码', () => {
  assert.deepEqual(core.vibeScriptSchema.parse(testScript), testScript);
  for (const duration of [0, -1, NaN, Infinity, 151]) assert.throws(() => core.vibeMetaSchema.parse({ ...testMeta, durationSec: duration }));
  for (const width of [0, 65, 4096, Infinity]) assert.throws(() => core.planVibeFrames({ ...testMeta, width }));
  assert.throws(() => core.planVibeFrames({ ...testMeta, durationSec: 150, fps: 60 }));
  assert.throws(() => core.vibeScriptSchema.parse({ shots: [testScript.shots[0], testScript.shots[0]] }));
  assert.throws(() => core.vibeScriptSchema.parse({ shots: [{ ...testScript.shots[0], index: 2 }] }));
  assert.throws(() => core.vibeCreateSchema.parse({ topic: 'test', aspectRatio: 'wrong' }));
  assert.throws(() => core.assertProtocolStub(testCode + 'x'.repeat(core.VIBE_MAX_CODE_LENGTH)));
  assert.throws(() => core.assertProtocolStub('<html></html>'));
  assert.equal(core.planVibeFrames(testMeta).times.length, 72);
  assert.equal(core.extractHtmlDocument('```html\n' + testCode + '\n```'), testCode);
});

test('旧项目默认 studio；Vibe 数据隔离且删除项目级联', () => {
  const normal = db.createProject({ name: '旧工作流' });
  assert.equal(normal.mode, 'studio');
  assert.throws(() => db.createVibeProject(normal.id, 'test'));
  const p = project();
  assert.equal(db.getProject(p.id).mode, 'vibe');
  assert.equal(db.getVibeProject(p.id).revision, 0);
  db.deleteProject(p.id);
  assert.equal(db.getVibeProject(p.id), null);
});

test('已有数据库幂等补列，不丢失原项目与初版 Vibe 数据', () => {
  db.closeDb();
  const legacy = new DatabaseSync(process.env.SAKURA_DB_FILE);
  legacy.exec('ALTER TABLE projects DROP COLUMN mode; ALTER TABLE vibe_projects DROP COLUMN revision; ALTER TABLE vibe_projects DROP COLUMN active_job_id;');
  legacy.close();
  const names = db.listProjects().map((project) => project.brief.name);
  assert.ok(names.includes('旧工作流'));
  assert.ok(db.listProjects().every((project) => project.mode === 'studio'));
  db.closeDb();
  const migrated = db.getDb();
  const columns = migrated.prepare('PRAGMA table_info(vibe_projects)').all().map((row) => row.name);
  assert.equal(columns.filter((name) => name === 'revision').length, 1);
  assert.equal(columns.filter((name) => name === 'active_job_id').length, 1);
});

test('创建直出项目原子入队；缺少模型不留下空项目', () => {
  const providers = db.listProviders();
  for (const provider of providers) db.updateProvider(provider.id, { enabled: false });
  const count = db.listProjects().length;
  try {
    assert.throws(() => pipeline.createVibeAndEnqueue({ topic: '相遇' }));
    assert.equal(db.listProjects().length, count);
  } finally {
    for (const provider of providers) db.updateProvider(provider.id, { enabled: provider.enabled });
  }
  const result = pipeline.createVibeAndEnqueue({ topic: '相遇', aspectRatio: '1:1', targetDurationSec: 3 });
  assert.equal(result.job.payload.autoRender, true);
  assert.equal(db.getVibeProject(result.id).activeJobId, result.job.id);
  assert.throws(() => pipeline.enqueueVibeJob(result.id, 'vibe.generate'));
  db.cancelJob(result.job.id);
  assert.equal(db.getVibeProject(result.id).renderStatus, 'canceled');
});

test('中断恢复跳过已保存脚本，不重复调用模型阶段', async () => {
  const p = project();
  const job = pipeline.enqueueVibeJob(p.id, 'vibe.generate', { topic: '相遇' });
  db.updateVibeProject(p.id, { script: testScript });
  await execute(job);
  assert.equal(requests.length, 0);
  assert.equal(db.getJob(job.id).status, 'succeeded');
});

test('阶段生成经校验落库；不重复排队，编辑使旧代码与输出失效', async () => {
  const p = project();
  const scriptJob = pipeline.enqueueVibeJob(p.id, 'vibe.generate', { topic: '相遇' });
  assert.throws(() => pipeline.enqueueVibeJob(p.id, 'vibe.generate'));
  await execute(scriptJob);
  assert.equal(db.getVibeProject(p.id).script.shots.length, 2);
  const codeJob = pipeline.enqueueVibeJob(p.id, 'vibe.code');
  await execute(codeJob);
  const vibe = db.getVibeProject(p.id);
  assert.equal(vibe.code, testCode);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].body.model, 'test-text');
  assert.equal(requests[0].body.response_format.type, 'json_object');
  assert.throws(() => pipeline.saveVibeDraft(p.id, 'code', testCode, 0), /更新/);
  pipeline.saveVibeDraft(p.id, 'script', testScript, vibe.revision);
  assert.equal(db.getVibeProject(p.id).code, null);
  assert.equal(db.getProject(p.id).lastExportUrl, null);
  assert.throws(() => db.updateVibeProject(p.id, { code: testCode }, { revision: 0 }));
});

test('模型返回非法脚本时失败不落库，不触发下一阶段', async () => {
  scriptResponse = { shots: [] };
  const { id, job } = pipeline.createVibeAndEnqueue({ topic: '相遇' });
  await assert.rejects(() => execute(job));
  assert.equal(db.getVibeProject(id).script, null);
  assert.equal(db.getJob(job.id).status, 'failed');
  assert.equal(requests.length, 1);
});

test('取消后忽略迟到的模型响应，不落库或继续生成代码', async () => {
  const { id, job } = pipeline.createVibeAndEnqueue({ topic: '相遇' });
  onRequest = () => db.cancelJob(job.id);
  await assert.rejects(() => execute(job), /取消/);
  assert.equal(db.getVibeProject(id).script, null);
  assert.equal(db.getVibeProject(id).renderStatus, 'canceled');
  assert.equal(db.getJob(job.id).status, 'canceled');
  assert.equal(requests.length, 1);
});

test('取消后新版本开始，旧任务不能覆盖新版本', async () => {
  const { id, job } = pipeline.createVibeAndEnqueue({ topic: '相遇' });
  let newer;
  onRequest = () => {
    db.cancelJob(job.id);
    newer = pipeline.enqueueVibeJob(id, 'vibe.generate', { topic: '新的故事' });
  };
  await assert.rejects(() => execute(job));
  assert.equal(db.getVibeProject(id).activeJobId, newer.id);
  assert.equal(db.getVibeProject(id).topic, '新的故事');
  assert.equal(db.getVibeProject(id).script, null);
  db.cancelJob(newer.id);
});

test('媒体 URL 前缀和旧地址可读取同一文件，Range 正确且不能越出媒体目录', async () => {
  const p = prepared();
  const folder = join(data, 'media', p.id);
  mkdirSync(folder, { recursive: true });
  const body = Buffer.from('0123456789');
  writeFileSync(join(folder, 'sample.mp4'), body);
  for (const path of [['media', p.id, 'sample.mp4'], [p.id, 'sample.mp4']]) {
    const response = await serveFile(new Request('http://localhost/api/files/' + path.join('/')), { params: Promise.resolve({ path }) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'video/mp4');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), body);
  }
  const path = ['media', p.id, 'sample.mp4'];
  const partial = await serveFile(new Request('http://localhost/api/files/' + path.join('/'), { headers: { Range: 'bytes=2-5' } }), { params: Promise.resolve({ path }) });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(await partial.text(), '2345');
  for (const bad of [['media', '..', 'test.db'], ['..', '.sakura_secret'], ['media', '..\\test.db']]) {
    const response = await serveFile(new Request('http://localhost/api/files/test'), { params: Promise.resolve({ path: bad }) });
    assert.equal(response.status, 403);
  }
});

test('真实一键直出：脚本、代码、MP4、媒体记录和项目状态一致', { skip: !live }, async () => {
  const { id, job } = pipeline.createVibeAndEnqueue({ topic: '相遇', aspectRatio: '1:1', targetDurationSec: 3 });
  const result = await execute(job);
  assert.equal(requests.length, 2);
  assert.equal(db.getJob(job.id).status, 'succeeded');
  assert.equal(db.cancelJob(job.id).status, 'succeeded', '完成提交之后的取消不能改变状态');
  const media = db.getMedia(result.mediaId);
  assert.equal(media.jobId, job.id);
  assert.equal(db.getVibeProject(id).outputMediaId, media.id);
  assert.equal(db.getProject(id).lastExportUrl, media.url);
  assert.equal(db.getProject(id).status, 'completed');
  assert.equal(db.getVibeProject(id).renderStatus, 'succeeded');
  const absolute = join(data, media.path);
  assert.ok(existsSync(absolute));
  const httpResult = await serveFile(new Request(`http://localhost${media.url}`), { params: Promise.resolve({ path: media.url.replace('/api/files/', '').split('/') }) });
  assert.equal(httpResult.status, 200);
  assert.deepEqual(Buffer.from(await httpResult.arrayBuffer()), readFileSync(absolute));
  const probe = spawnSync(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-count_frames',
    '-show_entries', 'stream=codec_name,width,height,nb_read_frames,r_frame_rate:format=duration', '-of', 'json', absolute], { encoding: 'utf8' });
  assert.equal(probe.status, 0, probe.stderr);
  const info = JSON.parse(probe.stdout);
  assert.equal(info.streams[0].codec_name, 'h264');
  assert.equal(info.streams[0].nb_read_frames, '72');
  assert.equal(info.streams[0].width, 1024);
  assert.equal(info.streams[0].height, 1024);
  assert.equal(info.streams[0].r_frame_rate, '24/1');
  assert.ok(Math.abs(Number(info.format.duration) - 3) < 0.05);
  const sample = (at) => spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-ss', String(at), '-i', absolute,
    '-frames:v', '1', '-vf', 'scale=32:32', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
  const first = sample(0), last = sample(2);
  assert.equal(first.status, 0);
  assert.equal(last.status, 0);
  assert.notDeepEqual(first.stdout, last.stdout, '画面必须随寻帧时间变化');
  assert.ok(first.stdout.some((value) => value > 30), '不能只输出黑屏');
  const again = await HANDLERS[job.type]({ job: db.getJob(job.id), progress: () => {}, log: () => {}, isCanceled: () => false });
  assert.equal(again.mediaId, media.id);
  assert.equal(db.listMedia(id).length, 1, '重复执行已完成任务不能生成第二份媒体');
});

test('沙箱渲染阻断页面网络请求', { skip: !live }, async () => {
  const code = testCode.replace('window.__vibeSeek(0);', `
    fetch('${base}/blocked-fetch').catch(() => {});
    var image = new Image(); image.src = '${base}/blocked-image'; document.body.appendChild(image);
    try { new WebSocket('${base.replace('http:', 'ws:')}/blocked-socket'); } catch {}
    window.__vibeSeek(0);`);
  const p = prepared(code);
  const result = await renderVibeVideo(p.id, { timeoutMs: 15_000 });
  assert.equal(result.frameCount, 72);
  assert.equal(requests.length, 0);
});

test('编码器启动失败可控返回，不留下半成片', { skip: !live }, async () => {
  const p = prepared();
  const before = mediaFiles(p.id);
  await assert.rejects(() => renderVibeVideo(p.id, { ffmpegPath: join(data, 'missing-encoder'), timeoutMs: 15_000 }));
  assert.deepEqual(mediaFiles(p.id), before);
});

test('编码管道提前退出可控返回，不挂死或落库半成品', { skip: !live }, async () => {
  const p = prepared();
  await assert.rejects(() => renderVibeVideo(p.id, { ffmpegPath: process.execPath, timeoutMs: 15_000 }), /编码|管道/);
  assert.equal(db.listMedia(p.id).length, 0);
});

test('页面元信息必须匹配脚本，不能自定超大画幅或时长', { skip: !live }, async () => {
  const p = prepared(testCode.replace('"width":1024', '"width":4096'));
  await assert.rejects(() => renderVibeVideo(p.id, { timeoutMs: 15_000 }));
});

test('动画抛错不会被吞掉并导出为成功视频', { skip: !live }, async () => {
  const p = prepared(testCode.replace("document.getElementById('petal').style.left", "if(t > 0) throw new Error('invalid-frame');\ndocument.getElementById('petal').style.left"));
  await assert.rejects(() => renderVibeVideo(p.id, { timeoutMs: 15_000 }), /invalid-frame/);
  assert.equal(db.listMedia(p.id).length, 0);
});

test('真实渲染中取消会退出进程且不留下输出', { skip: !live }, async () => {
  const p = prepared();
  let canceled = false;
  const before = mediaFiles(p.id);
  await assert.rejects(() => renderVibeVideo(p.id, {
    isCanceled: () => canceled, timeoutMs: 15_000,
    onProgress: (percent) => { if (percent > 10) canceled = true; },
  }), /取消/);
  assert.deepEqual(mediaFiles(p.id), before);
});

test('动画死循环触发整体超时，worker 不被拖住', { skip: !live }, async () => {
  const code = testCode.replace('document.getElementById(\'petal\').style.left', 'while(true) {}\ndocument.getElementById(\'petal\').style.left');
  const p = prepared(code);
  const started = Date.now();
  await assert.rejects(() => renderVibeVideo(p.id, { timeoutMs: 3000 }), /超时/);
  assert.ok(Date.now() - started < 12_000);
});
