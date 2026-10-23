
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { mkdtempSync, rmSync, readdirSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { testScript, testMeta, testCode, testAudio } from './vibe-fixture.mjs';

const data = mkdtempSync(join(tmpdir(), 'sakura-vibe-'));
process.env.SAKURA_DATA_DIR = data;
process.env.SAKURA_DB_FILE = join(data, 'test.db');
const db = await import('../packages/db/src/index.ts');
const core = await import('../packages/core/src/index.ts');
const pipeline = await import('../packages/pipeline/src/index.ts');
const { HANDLERS } = await import('../apps/worker/src/handlers.ts');
const { renderVibeVideo, closeVibeBrowser } = await import('../apps/worker/src/vibe-render.ts');
const { addVibeDubbing, vibeTempoFilters } = await import('../apps/worker/src/vibe-audio.ts');
const { GET: serveFile } = await import('../apps/web/src/app/api/files/[...path]/route.ts');
const live = process.env.VIBE_RENDER_LIVE === '1';
const requests = [];
let scriptResponse = testScript;
let codeResponse = testCode;
let planResponse = null;
let audioSeconds = 0.35;
let onRequest = () => {};
const server = createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    requests.push({ url: request.url, body });
    onRequest(body);
    if (request.url === '/v1/audio/speech') {
      response.writeHead(200, { 'Content-Type': 'audio/wav' });
      response.end(testAudio(audioSeconds));
      return;
    }
    assert.equal(request.url, '/v1/chat/completions');
    const content = body.response_format?.type === 'json_object' ? JSON.stringify(planResponse ?? scriptResponse) : codeResponse;
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
    models: [{ id: 'test-text', label: '测试文本', capability: 'text', mode: 'sync' },
      { id: 'test-audio', label: '测试语音', capability: 'audio', mode: 'sync' }] });
  db.upsertModelRoute({ capability: 'text', providerId: provider.id, modelId: 'test-text' });
  db.upsertModelRoute({ capability: 'audio', providerId: provider.id, modelId: 'test-audio' });
});
beforeEach(() => {
  requests.length = 0; scriptResponse = testScript; codeResponse = testCode; planResponse = null; audioSeconds = 0.35; onRequest = () => {};
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
  assert.deepEqual(vibeTempoFilters(1.5), ['atempo=1.5']);
  for (const ratio of [0, 0.5, NaN, Infinity, 2.01]) assert.throws(() => vibeTempoFilters(ratio));
  assert.equal(core.extractHtmlDocument('```html\n' + testCode + '\n```'), testCode);
  assert.equal(core.parsePlanResponse(JSON.stringify({ summary: '提问', steps: [{ title: '澄清', rationale: '询问', tool: 'agent.ask_user', args: { question: '需要何种配色？' } }] })).steps[0].tool, 'agent.ask_user');
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
  legacy.exec('ALTER TABLE projects DROP COLUMN mode; ALTER TABLE vibe_projects DROP COLUMN revision; ALTER TABLE vibe_projects DROP COLUMN active_job_id; ALTER TABLE vibe_projects DROP COLUMN dubbing_json;');
  legacy.close();
  const names = db.listProjects().map((project) => project.brief.name);
  assert.ok(names.includes('旧工作流'));
  assert.ok(db.listProjects().every((project) => project.mode === 'studio'));
  db.closeDb();
  const migrated = db.getDb();
  const columns = migrated.prepare('PRAGMA table_info(vibe_projects)').all().map((row) => row.name);
  assert.equal(columns.filter((name) => name === 'revision').length, 1);
  assert.equal(columns.filter((name) => name === 'active_job_id').length, 1);
  assert.equal(columns.filter((name) => name === 'dubbing_json').length, 1);
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
  assert.equal(result.job.payload.autoCode, true);
  assert.equal(result.job.payload.autoRender, false);
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

test('默认只生成动画草稿，兼容旧自动字段但不能跳过用户确认', async () => {
  const { id, job } = pipeline.createVibeAndEnqueue({ topic: '相遇' });
  await execute(job);
  const vibe = db.getVibeProject(id);
  assert.equal(vibe.code, testCode);
  assert.equal(vibe.outputUrl, null);
  assert.equal(db.listMedia(id).length, 0);
  assert.equal(db.getProject(id).status, 'in_progress');
  assert.throws(() => pipeline.enqueueVibeJob(id, 'vibe.render'), /确认/);
  assert.throws(() => pipeline.enqueueVibeJob(id, 'vibe.render', { confirmedRevision: vibe.revision - 1 }), /确认/);
  const old = pipeline.enqueueVibeJob(id, 'vibe.generate', { autoRender: true });
  await execute(old);
  assert.equal(db.getVibeProject(id).outputUrl, null);
});

test('配音设置校验、版本防覆盖，保存后不重置动画但使旧输出与确认失效', () => {
  const p = prepared();
  const vibe = db.getVibeProject(p.id);
  assert.deepEqual(vibe.dubbing, { enabled: false, voice: '', speed: 1, volume: 1, pitch: 0 });
  for (const speed of [0, -1, 5, NaN]) assert.throws(() => pipeline.saveVibeDubbing(p.id, { enabled: true, speed }, vibe.revision));
  assert.throws(() => pipeline.saveVibeDubbing(p.id, { enabled: true }, 99), /更新/);
  const saved = pipeline.saveVibeDubbing(p.id, { enabled: true, voice: 'test-voice', speed: 1.2 }, vibe.revision);
  assert.equal(saved.revision, vibe.revision + 1);
  assert.equal(saved.code, testCode);
  assert.equal(saved.dubbing.voice, 'test-voice');
  assert.throws(() => pipeline.enqueueVibeJob(p.id, 'vibe.render', { confirmedRevision: vibe.revision }), /确认/);
  const job = pipeline.enqueueVibeJob(p.id, 'vibe.render', { confirmedRevision: saved.revision });
  assert.throws(() => pipeline.saveVibeDubbing(p.id, {}, saved.revision + 1), /任务/);
  db.cancelJob(job.id);
});

test('开启配音但未配置语音模型时拒绝导出，不产生任务或丢失草稿', () => {
  const p = prepared();
  pipeline.saveVibeDubbing(p.id, { enabled: true }, 0);
  const route = db.listModelRoutes().find((entry) => entry.capability === 'audio');
  const provider = db.getProvider(route.providerId);
  db.updateProvider(provider.id, { enabled: false });
  const count = db.listJobs({ projectId: p.id }).length;
  try {
    assert.throws(() => pipeline.enqueueVibeJob(p.id, 'vibe.render', { confirmedRevision: 1 }));
    assert.equal(db.listJobs({ projectId: p.id }).length, count);
    assert.equal(db.getVibeProject(p.id).code, testCode);
  } finally { db.updateProvider(provider.id, { enabled: true }); }
});

test('音乐上传限制格式与大小、保存验证项目归属且版本确认失效', async () => {
  const p = prepared();
  await assert.rejects(() => pipeline.uploadVibeMusic(p.id, new File([''], 'empty.mp3')), /不能为空/);
  await assert.rejects(() => pipeline.uploadVibeMusic(p.id, new File(['x'], 'script.html', { type: 'audio/mpeg' })), /请上传/);
  await assert.rejects(() => pipeline.uploadVibeMusic(p.id, { name: 'large.wav', size: 33 * 1024 * 1024 }), /32 MiB/);
  const media = await pipeline.uploadVibeMusic(p.id, new File([testAudio()], '背景音乐.WAV'));
  assert.equal(media.kind, 'audio');
  assert.equal(media.mime, 'audio/wav');
  assert.equal(db.getVibeProject(p.id).revision, 0, '上传不直接修改当前版本');
  assert.ok(existsSync(join(data, media.path)));
  const music = { mediaId: media.id, name: '背景音乐.WAV', volume: 0.2, loop: true };
  const saved = pipeline.saveVibeDubbing(p.id, { music }, 0);
  assert.deepEqual(saved.dubbing.music, music);
  assert.equal(saved.code, testCode);
  assert.equal(saved.revision, 1);
  assert.throws(() => pipeline.enqueueVibeJob(p.id, 'vibe.render', { confirmedRevision: 0 }), /确认/);
  const other = prepared();
  assert.throws(() => pipeline.saveVibeDubbing(other.id, { music }, 0), /不属于/);
  for (const volume of [-1, 2, NaN]) assert.throws(() => pipeline.saveVibeDubbing(p.id, { music: { ...music, volume } }, 1));
  assert.throws(() => pipeline.saveVibeDubbing(p.id, { volume: 3 }, 1));
  assert.throws(() => pipeline.saveVibeDubbing(p.id, { pitch: 13 }, 1));
  rmSync(join(data, media.path));
  assert.throws(() => pipeline.enqueueVibeJob(p.id, 'vibe.render', { confirmedRevision: 1 }), /背景音乐不存在/);
  const removed = pipeline.saveVibeDubbing(p.id, { ...saved.dubbing, music: undefined }, 1);
  assert.equal(removed.dubbing.music, undefined);
});

test('音色试听使用当前路由与项目语言，不保存媒体或修改导出版本', async () => {
  const p = prepared();
  const result = await pipeline.previewVibeVoice(p.id, { voice: 'test-voice', speed: 1.2 }, '你好');
  assert.ok(result.startsWith('data:audio/'));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.voice, 'test-voice');
  assert.equal(requests[0].body.speed, 1.2);
  assert.equal(requests[0].body.language, p.brief.language);
  assert.equal(db.getVibeProject(p.id).revision, 0);
  assert.equal(db.listMedia(p.id).length, 0);
  await assert.rejects(() => pipeline.previewVibeVoice(p.id, {}, 'x'.repeat(121)), /120/);
  const options = await pipeline.vibeVoiceOptions(p.id);
  assert.equal(options.supportsVoiceList, false);
  assert.deepEqual(options.voices, []);
});

test('未确认的旧导出队列不能继续渲染，旁白为空时不能启用配音导出', async () => {
  const p = prepared();
  const legacy = db.createJob({ type: 'vibe.render', projectId: p.id, payload: { revision: 1 }, maxAttempts: 1 });
  db.updateVibeProject(p.id, { revision: 1, activeJobId: legacy.id });
  await assert.rejects(() => execute(legacy), /未确认/);
  assert.deepEqual(mediaFiles(p.id), []);
  const script = { shots: testScript.shots.map((shot) => ({ ...shot, narration: '' })) };
  db.updateVibeProject(p.id, { script, dubbing: { enabled: true, speed: 1, voice: '' } });
  assert.throws(() => pipeline.enqueueVibeJob(p.id, 'vibe.render', { confirmedRevision: 1 }), /旁白/);
});

test('对话调整携带原代码与历史；失败、取消均保留原脚本和代码', async () => {
  const p = prepared();
  const revised = { shots: testScript.shots.map((shot) => ({ ...shot, narration: '重逢' })) };
  scriptResponse = revised;
  codeResponse = testCode.replace('相遇', '重逢');
  const first = pipeline.enqueueVibeJob(p.id, 'vibe.revise', { instructions: '把相遇改成重逢' });
  await execute(first);
  const current = db.getVibeProject(p.id);
  assert.deepEqual(current.script, revised);
  assert.equal(current.code, codeResponse);
  assert.ok(requests[1].body.messages[1].content.includes(testCode));
  assert.equal(current.outputUrl, null);
  codeResponse = '<html>invalid</html>';
  const second = pipeline.enqueueVibeJob(p.id, 'vibe.revise', { instructions: '再改成暖色' });
  await assert.rejects(() => execute(second));
  assert.ok(requests[2].body.messages[1].content.includes('把相遇改成重逢'));
  assert.equal(db.getVibeProject(p.id).code, current.code);
  assert.deepEqual(db.getVibeProject(p.id).script, revised);
  const third = pipeline.enqueueVibeJob(p.id, 'vibe.revise', { instructions: '第三轮' });
  onRequest = () => db.cancelJob(third.id);
  await assert.rejects(() => execute(third), /取消/);
  assert.equal(db.getVibeProject(p.id).code, current.code);
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

async function runPlan(projectId, tool, args = {}) {
  const steps = core.draftToSteps({ summary: '调整动画', steps: [{ title: '工具步骤', rationale: '测试', tool, args }] });
  const plan = db.createPlan({ projectId, goal: '调整', steps, status: 'running', autoApprove: true });
  const job = db.createJob({ type: 'agent.run', projectId, payload: { planId: plan.id, autoApprove: true }, maxAttempts: 1 });
  db.updatePlan(plan.id, { jobId: job.id });
  await execute(job);
  return db.getPlan(plan.id);
}

test('Agent 工具能排队调整、查询真实进度日志，Vibe 无法调用最终导出或传统工具', async () => {
  const p = prepared();
  const other = prepared();
  const unrelated = pipeline.enqueueVibeJob(other.id, 'vibe.revise', { instructions: '其他项目调整' });
  const plan = await runPlan(p.id, 'vibe.revise', { instructions: '把结尾改暖色' });
  assert.equal(plan.status, 'completed');
  const queued = db.getJob(plan.steps[0].result.jobId);
  db.updateJob(queued.id, { progress: 37, stageLabel: '正在调整第二场' });
  db.addJobEvent(queued.id, 'info', '测试实时日志');
  const queried = await runPlan(p.id, 'jobs.status');
  const snapshot = queried.steps[0].result.jobs.find((entry) => entry.id === queued.id);
  assert.equal(snapshot.progress, 37);
  assert.equal(snapshot.stage, '正在调整第二场');
  assert.equal(snapshot.events[0].message, '测试实时日志');
  assert.ok(!queried.steps[0].result.jobs.some((entry) => entry.id === unrelated.id));
  db.cancelJob(queued.id);
  db.cancelJob(unrelated.id);
  const forbidden = await runPlan(p.id, 'timeline.render');
  assert.equal(forbidden.status, 'failed');
  assert.equal(db.listMedia(p.id).length, 0);
});

test('Agent 规划看到 Vibe 当前稿和最近对话，规划失败不能降级执行传统流程', async () => {
  const p = prepared();
  const previous = db.createPlan({ projectId: p.id, goal: '旧目标', status: 'completed' });
  db.addTurn({ planId: previous.id, projectId: p.id, role: 'user', content: '保留蓝色背景' });
  planResponse = { summary: '查询进度', steps: [{ title: '查看进度', rationale: '只读', tool: 'jobs.status', args: {} }] };
  const plan = db.createPlan({ projectId: p.id, goal: '看看进度', autoApprove: true });
  const job = db.createJob({ type: 'agent.run', projectId: p.id, payload: { planId: plan.id, autoApprove: true }, maxAttempts: 1 });
  db.updatePlan(plan.id, { jobId: job.id });
  await execute(job);
  assert.ok(requests[0].body.messages[1].content.includes('保留蓝色背景'));
  assert.ok(requests[0].body.messages[1].content.includes('当前草稿'));
  assert.ok(!requests[0].body.messages[0].content.includes('- timeline.render'));
  planResponse = { summary: '错误工具', steps: [{ title: '导出', rationale: '不适用', tool: 'timeline.render' }] };
  const bad = db.createPlan({ projectId: p.id, goal: '错误计划', autoApprove: true });
  const badJob = db.createJob({ type: 'agent.run', projectId: p.id, payload: { planId: bad.id, autoApprove: true }, maxAttempts: 1 });
  db.updatePlan(bad.id, { jobId: badJob.id });
  await execute(badJob);
  assert.equal(db.getPlan(bad.id).status, 'failed');
  assert.equal(db.getPlan(bad.id).steps.length, 0);
});

test('真实确认导出：草稿不自动成片，确认后 MP4、媒体记录和项目状态一致', { skip: !live }, async () => {
  const { id, job: draft } = pipeline.createVibeAndEnqueue({ topic: '相遇', aspectRatio: '1:1', targetDurationSec: 3 });
  await execute(draft);
  assert.equal(db.getVibeProject(id).outputUrl, null);
  assert.equal(db.getVibeProject(id).renderStatus, 'idle');
  const job = pipeline.enqueueVibeJob(id, 'vibe.render', { confirmedRevision: db.getVibeProject(id).revision });
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

test('真实配音导出含声音轨且逐场对齐，传递音色语速并清理中间文件', { skip: !live }, async () => {
  const p = prepared();
  pipeline.saveVibeDubbing(p.id, { enabled: true, voice: 'test-voice', speed: 1.2 }, 0);
  const job = pipeline.enqueueVibeJob(p.id, 'vibe.render', { confirmedRevision: 1 });
  const result = await execute(job);
  const audioRequests = requests.filter((entry) => entry.url === '/v1/audio/speech');
  assert.equal(audioRequests.length, testScript.shots.filter((shot) => shot.narration.trim()).length);
  assert.equal(audioRequests[0].body.voice, 'test-voice');
  assert.equal(audioRequests[0].body.speed, 1.2);
  assert.equal(audioRequests[0].body.input, testScript.shots.find((shot) => shot.narration.trim()).narration);
  const media = db.getMedia(result.mediaId);
  const file = join(data, media.path);
  const probe = spawnSync(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8' });
  assert.equal(probe.status, 0, probe.stderr);
  const info = JSON.parse(probe.stdout);
  assert.ok(info.streams.some((stream) => stream.codec_type === 'video' && stream.codec_name === 'h264'));
  assert.ok(info.streams.some((stream) => stream.codec_type === 'audio' && stream.codec_name === 'aac'));
  assert.ok(Math.abs(Number(info.format.duration) - 3) < 0.06);
  const decoded = spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-i', file, '-vn', '-f', 's16le', '-ac', '1', '-ar', '24000', 'pipe:1']);
  assert.equal(decoded.status, 0, decoded.stderr?.toString());
  assert.ok(decoded.stdout.some((value) => value > 20), '不能只写入静音轨');
  assert.equal(db.listMedia(p.id).length, 1);
  assert.equal(mediaFiles(p.id).length, 1);
  assert.equal(db.getProject(p.id).status, 'completed');
});

test('空白场次补静音，长旁白加速后仍严格从下一场起点播放', { skip: !live }, async () => {
  const p = prepared();
  const script = { shots: testScript.shots.map((shot, index) => ({ ...shot, narration: index === 0 ? '' : shot.narration })) };
  db.updateVibeProject(p.id, { script, dubbing: { enabled: true, voice: '', speed: 1 } });
  audioSeconds = 2.2;
  const work = mkdtempSync(join(data, 'audio-test-'));
  const video = join(work, 'silent.mp4'), output = join(work, 'final.mp4');
  const input = spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-nostdin', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=24:d=3', '-c:v', 'libx264', video]);
  assert.equal(input.status, 0, input.stderr?.toString());
  const logs = [];
  await addVibeDubbing(db.getVibeProject(p.id), 'zh-CN', video, output, work, { onLog: (message) => logs.push(message) });
  assert.equal(requests.length, 1, '没有旁白的场次不调用语音模型');
  assert.ok(logs.some((message) => message.includes('倍速对齐')));
  const decoded = spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-i', output, '-vn', '-f', 's16le', '-ac', '1', '-ar', '24000', 'pipe:1']);
  assert.equal(decoded.status, 0);
  const peak = (start, end) => {
    let value = 0;
    for (let i = Math.round(start * 24000) * 2; i < Math.round(end * 24000) * 2; i += 2) value = Math.max(value, Math.abs(decoded.stdout.readInt16LE(i)));
    return value;
  };
  assert.ok(peak(0.1, 1.4) < 20, '第一场应静音');
  assert.ok(peak(1.6, 2.8) > 1000, '第二场应在自己的起点播放旁白');
  rmSync(work, { recursive: true, force: true });
});

test('音乐单独导出无语音调用，循环播放覆盖视频末尾', { skip: !live }, async () => {
  const p = prepared();
  const media = await pipeline.uploadVibeMusic(p.id, new File([testAudio()], '短音乐.wav'));
  pipeline.saveVibeDubbing(p.id, { music: { mediaId: media.id, name: '短音乐', volume: 0.2, loop: true } }, 0);
  const route = db.listModelRoutes().find((entry) => entry.capability === 'audio');
  db.updateProvider(route.providerId, { enabled: false });
  let result;
  try { result = await execute(pipeline.enqueueVibeJob(p.id, 'vibe.render', { confirmedRevision: 1 })); }
  finally { db.updateProvider(route.providerId, { enabled: true }); }
  assert.equal(requests.length, 0, '只用音乐时无需语音模型');
  const output = join(data, db.getMedia(result.mediaId).path);
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', output], { encoding: 'utf8' });
  assert.equal(probe.status, 0, probe.stderr);
  const info = JSON.parse(probe.stdout);
  assert.ok(info.streams.some((stream) => stream.codec_type === 'audio'));
  assert.ok(Math.abs(Number(info.format.duration) - 3) < 0.06);
  const decoded = spawnSync('ffmpeg', ['-v', 'error', '-ss', '2', '-i', output, '-t', '0.5', '-vn', '-f', 's16le', '-ac', '1', '-ar', '24000', 'pipe:1']);
  assert.equal(decoded.status, 0);
  assert.ok(decoded.stdout.some((value) => value > 20), '循环音乐在末尾仍有声音');
  assert.equal(db.listMedia(p.id).length, 2, '只保留上传音乐和最终视频');
});

test('音乐播放一次后补静音，音量控制生效，并能与逐场旁白混音', { skip: !live }, async () => {
  const p = prepared();
  const media = await pipeline.uploadVibeMusic(p.id, new File([testAudio()], '音乐.wav'));
  const work = mkdtempSync(join(data, 'music-test-'));
  const video = join(work, 'silent.mp4');
  assert.equal(spawnSync('ffmpeg', ['-v', 'error', '-nostdin', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=24:d=3', '-c:v', 'libx264', video]).status, 0);
  const peak = (file, start) => {
    const decoded = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(start), '-i', file, '-t', '0.15', '-vn', '-f', 's16le', '-ac', '1', '-ar', '24000', 'pipe:1']);
    assert.equal(decoded.status, 0, decoded.stderr?.toString());
    let max = 0;
    for (let i = 0; i + 1 < decoded.stdout.length; i += 2) max = Math.max(max, Math.abs(decoded.stdout.readInt16LE(i)));
    return max;
  };
  try {
    const vibe = db.getVibeProject(p.id);
    vibe.dubbing.music = { mediaId: media.id, name: '音乐', volume: 0.2, loop: false };
    const single = join(work, 'single.mp4');
    await addVibeDubbing(vibe, 'zh-CN', video, single, work, {});
    const singlePeak = peak(single, 0.05);
    assert.ok(singlePeak > 500 && singlePeak < 3000, `音量应为原始音量的约 20%：${singlePeak}`);
    assert.ok(peak(single, 2) < 20, '非循环音乐结束后应静音');
    vibe.dubbing.enabled = true;
    const mixed = join(work, 'mixed.mp4');
    await addVibeDubbing(vibe, 'zh-CN', video, mixed, work, {});
    assert.equal(requests.length, 2);
    assert.ok(peak(mixed, 0.05) > singlePeak * 2, '混音应包含旁白');
    assert.ok(peak(mixed, 1.55) > 1000, '音乐结束后第二场旁白正常播放');
    assert.ok(peak(mixed, 2.5) < 20, '旁白和音乐结束后补静音');
  } finally { rmSync(work, { recursive: true, force: true }); }
});

test('配音请求期间取消忽略迟到音频，无最终视频或半成品', { skip: !live }, async () => {
  const p = prepared();
  pipeline.saveVibeDubbing(p.id, { enabled: true }, 0);
  const job = pipeline.enqueueVibeJob(p.id, 'vibe.render', { confirmedRevision: 1 });
  onRequest = () => db.cancelJob(job.id);
  await assert.rejects(() => execute(job), /取消/);
  assert.equal(db.getJob(job.id).status, 'canceled');
  assert.equal(db.getVibeProject(p.id).outputUrl, null);
  assert.equal(db.listMedia(p.id).length, 0);
  assert.deepEqual(mediaFiles(p.id), []);
});

test('过长旁白明确失败而非截断，保留草稿且不留下中间媒体', { skip: !live }, async () => {
  const p = prepared();
  pipeline.saveVibeDubbing(p.id, { enabled: true }, 0);
  audioSeconds = 9;
  const job = pipeline.enqueueVibeJob(p.id, 'vibe.render', { confirmedRevision: 1 });
  await assert.rejects(() => execute(job), /旁白过长/);
  assert.equal(db.getJob(job.id).status, 'failed');
  assert.equal(db.getVibeProject(p.id).code, testCode);
  assert.deepEqual(mediaFiles(p.id), []);
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
