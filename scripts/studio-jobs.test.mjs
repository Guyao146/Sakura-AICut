import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 必须在加载任何仓储前固定库文件：web / worker 模块按包名解析 @sakura/db，
// 与本脚本的相对路径导入是两份模块实例、两个连接，但都指向同一个文件，
// 因此测试间用清表重置数据，而不是切换库文件（否则别的连接会读到旧库）。
const data = mkdtempSync(join(tmpdir(), 'sakura-studio-jobs-'));
process.env.SAKURA_DATA_DIR = data;
process.env.SAKURA_DB_FILE = join(data, 'test.db');
const db = await import('../packages/db/src/index.ts');
const { getCanvasRetryIds, getCanvasNodeJobStates } = await import('../packages/core/src/utils/jobs.ts');
const { HANDLERS } = await import('../apps/worker/src/handlers.ts');
const { runAgentPlan } = await import('../apps/worker/src/agent-runner.ts');
const { enqueueCanvasAi, enqueueCanvasGenerate } = await import('../apps/web/src/lib/server/jobs.ts');
const { selectCanvasItemVariant } = await import('../packages/pipeline/src/canvas.ts');
const { GET, POST } = await import('../apps/web/src/app/api/jobs/route.ts');
let serial = 0;
let requests = [];
let onRequest = () => {};
let aiText;
let videoStatus = 'succeeded';
let base;
const originalFetch = globalThis.fetch;
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jI3sAAAAASUVORK5LEAAAAAElFTkSuQmCC';
const server = createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    requests.push({ path: request.url, body });
    onRequest(request.url, body);
    if (request.url === '/test-video.mp4') {
      response.writeHead(200, { 'Content-Type': 'video/mp4' });
      response.end(Buffer.from('test-video-bytes'));
      return;
    }
    if (request.url === '/v1/audio/speech') {
      response.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      response.end(Buffer.from('test-audio-bytes'));
      return;
    }
    if (request.url.startsWith('/v1/video/generations')) {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(request.method === 'POST' ? { id: 'test-video-task' }
        : { status: videoStatus, video_url: `${base}/test-video.mp4`, duration: 7 }));
      return;
    }
    if (request.url === '/v1/chat/completions' && aiText !== undefined) {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: aiText } }] }));
      return;
    }
    const failed = String(body.prompt ?? '').startsWith('fail');
    response.writeHead(failed ? 422 : 200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(failed ? { error: { message: '测试模型拒绝该节点' } }
      : request.url === '/v1/images/generations' ? { data: [{ b64_json: `data:image/png;base64,${png}` }] }
        : { choices: [{ message: { content: JSON.stringify({ summary: '测试计划', steps: [
          { title: '创建节点', rationale: '测试', tool: 'canvas.create_item', args: { text: '不应创建' } },
        ] }) } }] }));
  } catch (error) {
    response.writeHead(500);
    response.end(String(error));
  }
});

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    assert.equal(url.origin, base, '测试禁止访问本地模拟模型之外的网络');
    return originalFetch(input, init);
  };
  server.on('close', () => { globalThis.fetch = originalFetch; });
});
beforeEach(() => {
  const tables = db.getDb().prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  ).all();
  for (const row of tables) db.getDb().prepare(`DELETE FROM "${row.name}"`).run();
  db.bootstrap();
  requests = [];
  onRequest = () => {};
  aiText = undefined;
  videoStatus = 'succeeded';
});
after(() => {
  db.closeDb();
  globalThis.fetch = originalFetch;
  server.closeAllConnections();
  server.close();
  try {
    rmSync(data, { recursive: true, force: true });
  } catch {
    /* Windows 上其它模块的连接可能尚未释放库文件，交给系统临时目录清理 */
  }
});

function provider() {
  return db.createProvider({ name: '仅供测试的本地模型', protocol: 'openai', baseUrl: base,
    models: [
      { id: 'test-image', label: '测试图片', capability: 'image', mode: 'sync' },
      { id: 'test-text', label: '测试文本', capability: 'text', mode: 'sync' },
      { id: 'test-audio', label: '测试语音', capability: 'audio', mode: 'sync' },
      { id: 'test-video', label: '测试视频', capability: 'video', mode: 'async' },
    ] });
}
function project() { return db.createProject({ name: `测试项目 ${++serial}` }); }
function item(projectId, text = 'test image') {
  return db.createCanvasItem({ projectId, kind: 'text', text, width: 200, height: 120 });
}
function context(job, patch = {}) {
  return { job, autoApprove: true, log: (message, level = 'info') => db.addJobEvent(job.id, level, message),
    progress: (progress, stageLabel) => db.updateJob(job.id, { progress, stageLabel }),
    isCanceled: () => db.getJob(job.id)?.status === 'canceled', ...patch };
}
function step(index, tool, args = {}) {
  return { id: `step-${index}`, index, title: `步骤 ${index + 1}`, rationale: '测试', tool, args,
    dependsOn: [], status: 'pending', needsApproval: false };
}
function agent(projectId, steps = []) {
  const plan = db.createPlan({ projectId, goal: '测试目标', steps });
  const job = db.createJob({ type: 'agent.run', projectId, targetType: 'agent', targetId: plan.id,
    payload: { planId: plan.id }, maxAttempts: 1 });
  db.updatePlan(plan.id, { jobId: job.id });
  return { plan, job };
}

for (const kind of ['text', 'image', 'video', 'audio']) {
  for (const role of ['plain', 'character', 'scene', 'prop']) {
    test(`节点 AI 优化：${kind}/${role} 使用草稿和要求，保留类型及媒体`, async () => {
      provider();
      const current = project();
      const node = db.createCanvasItem({ projectId: current.id, kind, role, text: '原文字', url: '/existing-media' });
      aiText = '优化后的内容';
      const queued = enqueueCanvasAi(current.id, node.id, { operation: 'optimize', sourceText: '未保存的草稿', instruction: '更简洁' });
      assert.equal(db.getCanvasItem(node.id).text, '未保存的草稿');
      assert.equal(queued.payload.ai.kind, kind);
      assert.equal(queued.payload.ai.role, role);
      assert.equal(getCanvasNodeJobStates([queued], current.id).get(node.id).status, 'pending');
      assert.throws(() => enqueueCanvasAi(current.id, node.id, { operation: 'generate' }), /重复提交/);
      const job = db.claimNextJob();
      const result = await HANDLERS['canvas.generate'](context(job));
      db.completeJob(job.id, result);
      assert.equal(result.succeeded, 1);
      const updated = db.getCanvasItem(node.id);
      assert.equal(updated.text, aiText);
      assert.equal(updated.kind, kind);
      assert.equal(updated.role, role);
      assert.equal(updated.url, '/existing-media');
      assert.equal(requests.length, 1);
      assert.equal(requests[0].path, '/v1/chat/completions');
      assert.match(requests[0].body.messages[1].content, /未保存的草稿/);
      assert.match(requests[0].body.messages[1].content, /更简洁/);
      assert.deepEqual(getCanvasRetryIds(db.getJob(job.id)), []);
    });
  }
}

for (const kind of ['text', 'image', 'video', 'audio']) {
  test(`节点 AI 生成：${kind} 支持已有内容与新输入并按类型回填`, async () => {
    provider();
    const current = project();
    const node = db.createCanvasItem({ projectId: current.id, kind, text: '已有内容', role: 'character' });
    aiText = '生成的正文';
    for (const instruction of ['', '本次新输入']) {
      requests = [];
      enqueueCanvasAi(current.id, node.id, { operation: 'generate', instruction, durationSec: 7, voice: 'test-voice', aspectRatio: '16:9' });
      const job = db.claimNextJob();
      const result = await HANDLERS['canvas.generate'](context(job));
      db.completeJob(job.id, result);
      assert.equal(result.succeeded, 1, JSON.stringify(result));
      const updated = db.getCanvasItem(node.id);
      assert.equal(updated.kind, kind);
      assert.equal(updated.role, 'character');
      if (kind === 'text') {
        assert.equal(updated.text, aiText);
        assert.equal(updated.mediaId, null);
        assert.match(requests[0].body.messages[1].content, new RegExp(instruction || '已有内容'));
      } else {
        assert.equal(updated.text, instruction || '已有内容');
        assert.match(updated.url, /^\/api\/files\/media\//);
        const media = db.getMedia(updated.mediaId);
        assert.equal(media.kind, kind);
        assert.equal(media.prompt, updated.text);
        assert.equal(media.ownerId, node.id);
        const expectedPrompt = (instruction || '已有内容')
          + (kind === 'image' ? `\n\nAvoid: ${current.brief.negativePrompt}` : '');
        assert.equal(requests[0].body[kind === 'audio' ? 'input' : 'prompt'], expectedPrompt);
        assert.equal(requests.some((r) => r.path === '/v1/chat/completions'), false);
        if (kind === 'audio') assert.equal(requests[0].body.voice, 'test-voice');
        if (kind === 'video') {
          assert.equal(requests[0].body.seconds, '7');
          assert.equal(requests[1].path, '/v1/video/generations/test-video-task');
          assert.equal(result.videoTask.taskId, 'test-video-task');
          assert.equal(media.durationSec, 7);
        }
        if (instruction) {
          assert.equal(updated.variants.length, 1);
          const restored = selectCanvasItemVariant(node.id, updated.variants[0].mediaId);
          assert.equal(restored.text, '已有内容');
          assert.equal(restored.kind, kind);
          assert.notEqual(restored.mediaId, updated.mediaId);
        }
      }
    }
  });
}

test('任务仓储：取消后迟到的完成和失败结果不能复活任务', () => {
  const job = db.createJob({ type: 'canvas.generate' });
  db.updateJob(job.id, { status: 'running' });
  const canceled = db.cancelJob(job.id);
  assert.equal(db.completeJob(job.id, { late: true }).status, 'canceled');
  assert.equal(db.failJob(job.id, '迟到的模型错误', 0).status, 'canceled');
  assert.equal(db.getJob(job.id).finishedAt, canceled.finishedAt);
  assert.equal(db.claimNextJob(), null);
});

test('任务仓储：保留正常自动重试、最大次数与已完成状态', () => {
  const job = db.createJob({ type: 'text.generate', maxAttempts: 2 });
  assert.equal(db.claimNextJob().attempts, 1);
  assert.equal(db.failJob(job.id, '第一次失败', 0).status, 'pending');
  assert.equal(db.claimNextJob().attempts, 2);
  assert.equal(db.failJob(job.id, '第二次失败', 0).status, 'failed');
  assert.equal(db.completeJob(job.id).status, 'failed');
  const done = db.createJob({ type: 'text.generate' });
  db.completeJob(done.id, { text: '完成' });
  assert.equal(db.cancelJob(done.id).status, 'succeeded');
  assert.equal(db.failJob(done.id, '过期失败').status, 'succeeded');
});

test('任务仓储：进程关闭打断的运行中任务回到队列，且不消耗重试次数', () => {
  const job = db.createJob({ type: 'canvas.generate', maxAttempts: 2 });
  db.claimNextJob();
  assert.equal(db.getJob(job.id).attempts, 1);
  // 模拟 worker shutdown：任务还挂在 running 表里
  const requeued = db.requeueInterrupted(job.id);
  assert.equal(requeued.status, 'pending');
  assert.equal(requeued.attempts, 0);
  assert.equal(requeued.startedAt, null);
  const reclaimer = db.claimNextJob();
  assert.equal(reclaimer.id, job.id);
  assert.equal(reclaimer.attempts, 1);
  // 已取消或已完成的任务不能被「回收成待执行」
  const done = db.createJob({ type: 'text.generate' });
  db.completeJob(done.id);
  assert.equal(db.requeueInterrupted(done.id).status, 'succeeded');
  const canceled = db.createJob({ type: 'text.generate' });
  db.claimNextJob();
  db.cancelJob(canceled.id);
  assert.equal(db.requeueInterrupted(canceled.id).status, 'canceled');
});

test('任务日志：只取最新记录，并按发生顺序显示（含相同时间戳）', () => {
  const job = db.createJob({ type: 'text.generate' });
  for (let i = 0; i < 20; i++) db.addJobEvent(job.id, 'info', `事件 ${i}`);
  db.getDb().prepare('UPDATE job_events SET created_at = ? WHERE job_id = ?').run('2026-01-01T00:00:00.000Z', job.id);
  assert.deepEqual(db.listJobEvents(job.id, 3).map((entry) => entry.message), ['事件 17', '事件 18', '事件 19']);
});


test('画布入队：缺少模型、越权节点、空提示词和重复提交均在调用前拒绝', () => {
  const current = project();
  const node = item(current.id);
  assert.throws(() => enqueueCanvasGenerate({ projectId: current.id, canvasItemIds: [node.id] }), /未找到可用/);
  assert.equal(db.listJobs().length, 0);
  provider();
  const other = project();
  const blank = item(current.id, '   ');
  assert.throws(() => enqueueCanvasGenerate({ projectId: current.id, canvasItemIds: [item(other.id).id] }), /不属于/);
  assert.throws(() => enqueueCanvasGenerate({ projectId: current.id, canvasItemIds: [blank.id] }), /提示词/);
  assert.throws(() => enqueueCanvasGenerate({ projectId: current.id, canvasItemIds: [node.id], aspectRatio: 'bad' }), /画幅/);
  const job = enqueueCanvasGenerate({ projectId: current.id, canvasItemIds: [node.id, node.id], aspectRatio: '16:9' });
  assert.deepEqual(job.payload.canvasItemIds, [node.id]);
  assert.equal(job.payload.aspectRatio, '16:9');
  assert.throws(() => enqueueCanvasGenerate({ projectId: current.id, canvasItemIds: [node.id] }), /重复提交/);
  assert.equal(db.listJobs().length, 1);
  assert.equal(requests.length, 0);
});

test('画布 Worker：逐节点保存成功/失败结果，只重试失败项，恢复执行跳过成功项', async () => {
  provider();
  const current = project();
  const success = item(current.id, 'success image');
  const failure = item(current.id, 'fail image');
  const queued = enqueueCanvasGenerate({ projectId: current.id, canvasItemIds: [success.id, failure.id], aspectRatio: '16:9' });
  const job = db.claimNextJob();
  assert.equal(job.id, queued.id);
  const snapshots = [];
  onRequest = () => { snapshots.push(db.getJob(job.id).result); };
  const result = await HANDLERS['canvas.generate'](context(job));
  const done = db.completeJob(job.id, result);
  assert.equal(result.succeeded, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.currentItemId, null);
  assert.equal(snapshots[0].currentItemId, success.id);
  assert.equal(snapshots[1].currentItemId, failure.id);
  assert.equal(snapshots[1].results[0].ok, true);
  assert.equal(db.getCanvasItem(success.id).kind, 'image');
  assert.equal(db.getCanvasItem(failure.id).kind, 'text');
  assert.deepEqual(getCanvasRetryIds(done), [failure.id]);
  assert.equal(getCanvasNodeJobStates([done], current.id).get(failure.id).status, 'failed');
  // 模拟僵尸任务被重新领取：成功结果已持久化，不重复调用成功节点。
  db.updateJob(job.id, { status: 'pending' });
  const resumed = db.claimNextJob();
  db.updateCanvasItem(failure.id, { text: 'fixed image' });
  const retryResult = await HANDLERS['canvas.generate'](context(resumed));
  assert.equal(retryResult.succeeded, 2);
  assert.equal(retryResult.failed, 0);
  assert.equal(requests.length, 3);
  assert.equal(requests.filter((entry) => entry.body.prompt.startsWith('success')).length, 1);
});

test('画布 Worker：请求期间取消后保留已发出请求的产物，不启动下一个节点', async () => {
  provider();
  const current = project();
  const first = item(current.id, 'first image');
  const second = item(current.id, 'second image');
  const queued = enqueueCanvasGenerate({ projectId: current.id, canvasItemIds: [first.id, second.id] });
  const job = db.claimNextJob();
  onRequest = () => db.cancelJob(queued.id);
  const result = await HANDLERS['canvas.generate'](context(job));
  assert.equal(requests.length, 1);
  assert.equal(result.succeeded, 1);
  assert.equal(db.getJob(job.id).status, 'canceled');
  assert.equal(db.getCanvasItem(first.id).kind, 'image');
  assert.equal(db.getCanvasItem(second.id).kind, 'text');
  assert.deepEqual(getCanvasRetryIds(db.getJob(job.id)), [second.id]);
  assert.equal(db.completeJob(job.id, result).status, 'canceled');
});

test('节点 AI：入队校验、空节点新输入及失败保留', async () => {
  const current = project();
  const node = item(current.id, '');
  const foreign = item(project().id);
  assert.throws(() => enqueueCanvasAi(current.id, node.id, { operation: 'optimize' }), /请输入/);
  assert.throws(() => enqueueCanvasAi(current.id, foreign.id, { operation: 'optimize' }), /不属于/);
  assert.throws(() => enqueueCanvasAi(current.id, node.id, { operation: 'bad' }), /不支持/);
  assert.throws(() => enqueueCanvasAi(current.id, node.id, { operation: 'generate', instruction: 1 }), /文字/);
  assert.throws(() => enqueueCanvasAi(current.id, node.id, { operation: 'generate', instruction: 'x'.repeat(20001) }), /20000/);
  assert.throws(() => enqueueCanvasAi(current.id, node.id, { operation: 'generate', sourceText: '草稿' }), /未找到可用/);
  assert.equal(db.getCanvasItem(node.id).text, '');
  assert.equal(db.listJobs().length, 0);
  provider();
  assert.throws(() => enqueueCanvasAi(current.id, node.id, { operation: 'generate', instruction: '内容', durationSec: NaN }), /时长/);
  assert.throws(() => enqueueCanvasAi(current.id, node.id, { operation: 'generate', instruction: '内容', aspectRatio: 'bad' }), /画幅/);
  enqueueCanvasAi(current.id, node.id, { operation: 'generate', instruction: '写一段开场白' });
  aiText = '';
  const job = db.claimNextJob();
  const result = await HANDLERS['canvas.generate'](context(job));
  db.completeJob(job.id, result);
  assert.equal(result.failed, 1);
  assert.equal(db.getCanvasItem(node.id).text, '');
  assert.deepEqual(getCanvasRetryIds(db.getJob(job.id)), [node.id]);
  const ai = job.payload.ai;
  const retry = enqueueCanvasAi(current.id, node.id, ai, ai);
  assert.deepEqual(retry.payload.ai, ai);
  aiText = '新的开场白';
  const retried = db.claimNextJob();
  const done = await HANDLERS['canvas.generate'](context(retried));
  assert.equal(done.succeeded, 1);
  assert.equal(db.getCanvasItem(node.id).text, aiText);
});

for (const change of ['text', 'kind', 'delete', 'cancel', 'move']) {
  test(`节点 AI：执行期间 ${change} 的保护`, async () => {
    provider();
    const current = project();
    const node = item(current.id, '原内容');
    enqueueCanvasAi(current.id, node.id, { operation: 'optimize' });
    const job = db.claimNextJob();
    aiText = '优化结果';
    onRequest = () => {
      if (change === 'text') db.updateCanvasItem(node.id, { text: '新编辑' });
      if (change === 'kind') db.updateCanvasItem(node.id, { kind: 'video' });
      if (change === 'delete') db.deleteCanvasItem(node.id);
      if (change === 'cancel') db.cancelJob(job.id);
      if (change === 'move') db.updateCanvasItem(node.id, { x: 999, width: 500 });
    };
    const result = await HANDLERS['canvas.generate'](context(job));
    db.completeJob(job.id, result);
    const updated = db.getCanvasItem(node.id);
    if (change === 'move') {
      assert.equal(result.succeeded, 1);
      assert.equal(updated.text, aiText);
      assert.equal(updated.x, 999);
      assert.equal(updated.width, 500);
    } else if (change === 'cancel') {
      assert.equal(updated.text, '原内容');
      assert.equal(db.getJob(job.id).status, 'canceled');
      assert.deepEqual(getCanvasRetryIds(db.getJob(job.id)), [node.id]);
    } else {
      assert.equal(result.failed, 1);
      assert.match(result.results[0].error, /已修改|已删除/);
      if (change === 'delete') assert.equal(updated, null);
      else assert.notEqual(updated.text, aiText);
      assert.throws(() => enqueueCanvasAi(current.id, node.id, job.payload.ai, job.payload.ai), /已修改|不存在/);
    }
  });
}

test('节点 AI 视频：恢复远端任务不重复提交，查询固定原供应商', async () => {
  const original = provider();
  const current = project();
  const node = db.createCanvasItem({ projectId: current.id, kind: 'video', text: '视频提示词' });
  const queued = enqueueCanvasAi(current.id, node.id, { operation: 'generate' });
  const remote = { providerId: original.id, modelId: 'test-video', taskId: 'existing-task' };
  db.updateJob(queued.id, { result: { videoTask: remote } });
  const other = provider();
  db.updateProvider(other.id, { baseUrl: 'http://127.0.0.1:1' });
  db.upsertModelRoute({ capability: 'video', providerId: other.id, modelId: 'test-video' });
  const job = db.claimNextJob();
  const result = await HANDLERS['canvas.generate'](context(job));
  assert.equal(result.succeeded, 1, JSON.stringify(result));
  assert.equal(requests[0].path, '/v1/video/generations/existing-task');
  assert.equal(requests.some((r) => r.path === '/v1/video/generations'), false);
});

for (const kind of ['image', 'video', 'audio']) {
  for (const change of ['text', 'cancel']) {
    test(`节点 AI 媒体：${kind} 请求期间 ${change} 不覆盖旧媒体`, async () => {
      provider();
      const current = project();
      const old = db.createMedia({ projectId: current.id, kind, url: '/existing-media',
        mime: `${kind}/test`, ownerType: 'canvas', prompt: '旧提示词' });
      const node = db.createCanvasItem({ projectId: current.id, kind, text: '旧提示词', mediaId: old.id, url: old.url });
      enqueueCanvasAi(current.id, node.id, { operation: 'generate', instruction: '新提示词' });
      const job = db.claimNextJob();
      onRequest = () => change === 'text'
        ? db.updateCanvasItem(node.id, { text: '用户的新编辑' }) : db.cancelJob(job.id);
      const result = await HANDLERS['canvas.generate'](context(job));
      db.completeJob(job.id, result);
      const updated = db.getCanvasItem(node.id);
      assert.equal(updated.mediaId, old.id);
      assert.equal(updated.url, old.url);
      assert.equal(updated.kind, kind);
      assert.equal(updated.text, change === 'text' ? '用户的新编辑' : '旧提示词');
      assert.equal(result.succeeded, 0);
      assert.equal(requests.length, 1);
      assert.equal(db.listMedia(current.id).length, 1);
    });
  }
}

test('节点 AI：图片和视频模型失败保留已有媒体及错误详情', async () => {
  provider();
  const current = project();
  for (const kind of ['image', 'video']) {
    const node = db.createCanvasItem({ projectId: current.id, kind, text: '旧提示词', url: '/existing-media' });
    enqueueCanvasAi(current.id, node.id, { operation: 'generate', instruction: 'fail media' });
    videoStatus = 'failed';
    const job = db.claimNextJob();
    const result = await HANDLERS['canvas.generate'](context(job));
    db.completeJob(job.id, result);
    assert.equal(result.failed, 1);
    assert(result.results[0].error.length > 0);
    assert.equal(db.getCanvasItem(node.id).url, '/existing-media');
    assert.equal(db.getCanvasItem(node.id).text, '旧提示词');
    assert.deepEqual(getCanvasRetryIds(db.getJob(job.id)), [node.id]);
  }
});

test('节点 AI：历史保留原始生成提示词，不误用当前编辑草稿', async () => {
  provider();
  const current = project();
  const media = db.createMedia({ projectId: current.id, kind: 'image', url: '/old-image', mime: 'image/png',
    ownerType: 'canvas', prompt: '原始生成提示词' });
  const node = db.createCanvasItem({ projectId: current.id, kind: 'image', text: '原始生成提示词', mediaId: media.id, url: media.url });
  enqueueCanvasAi(current.id, node.id, { operation: 'generate', sourceText: '本次修改的草稿' });
  const job = db.claimNextJob();
  const result = await HANDLERS['canvas.generate'](context(job));
  assert.equal(result.succeeded, 1);
  assert.equal(db.getCanvasItem(node.id).variants[0].prompt, '原始生成提示词');
  const restored = selectCanvasItemVariant(node.id, media.id);
  assert.equal(restored.text, '原始生成提示词');
});

test('对话轨迹：只取最新记录，并按发生顺序显示（含相同时间戳）', () => {
  const current = project();
  const plan = db.createPlan({ projectId: current.id, goal: '测试轨迹' });
  for (let i = 0; i < 20; i++) db.addTurn({ planId: plan.id, projectId: current.id, role: 'user', content: `第 ${i} 条` });
  db.getDb().prepare('UPDATE agent_turns SET created_at = ? WHERE plan_id = ?').run('2026-01-01T00:00:00.000Z', plan.id);
  assert.deepEqual(db.listTurns(plan.id, 3).map((turn) => turn.content), ['第 17 条', '第 18 条', '第 19 条']);
});

test('任务接口：历史上限不会挤掉活动任务，跟踪终态且不泄露其它项目任务', async () => {
  const current = project();
  const other = project();
  const old = db.createJob({ projectId: current.id, type: 'canvas.generate' });
  db.getDb().prepare('UPDATE jobs SET created_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', old.id);
  for (let i = 0; i < 45; i++) db.completeJob(db.createJob({ projectId: current.id, type: 'text.generate' }).id);
  const foreign = db.createJob({ projectId: other.id, type: 'text.generate' });
  const url = `http://localhost/api/jobs?projectId=${current.id}&limit=40&includeActive=1&ids=${old.id},${foreign.id}`;
  let payload = await (await GET(new Request(url))).json();
  assert.equal(payload.data.length, 41);
  assert(payload.data.some((job) => job.id === old.id));
  assert(payload.data.every((job) => job.projectId === current.id));
  db.cancelJob(old.id);
  payload = await (await GET(new Request(url))).json();
  assert.equal(payload.data.find((job) => job.id === old.id).status, 'canceled');
  assert.equal(new Set(payload.data.map((job) => job.id)).size, payload.data.length);
  const invalidLimit = await (await GET(new Request(`http://localhost/api/jobs?projectId=${current.id}&limit=NaN`))).json();
  assert.equal(invalidLimit.data.length, 40);
});

test('任务接口：取消批量任务时回收还在排队、从未开始的目标实体', async () => {
  const current = project();
  const queuedAsset = db.createAsset(current.id, { type: 'character', name: '主角' });
  const runningAsset = db.createAsset(current.id, { type: 'character', name: '配角' });
  const queuedShot = db.createShot(current.id, { index: 0, description: '测试镜头', prompt: '测试', durationSec: 3 });
  // simulate 入队时被标记成 queued
  db.updateAsset(queuedAsset.id, { status: 'queued' });
  db.updateAsset(runningAsset.id, { status: 'running' });
  db.updateShot(queuedShot.id, { status: 'queued' });
  const assetJob = db.createJob({ projectId: current.id, type: 'asset.prepare', targetType: 'project', targetId: current.id,
    payload: { assetIds: [queuedAsset.id, runningAsset.id] } });
  const shotJob = db.createJob({ projectId: current.id, type: 'shot.batchGenerate', targetType: 'project', targetId: current.id,
    payload: { shotIds: [queuedShot.id] } });

  const post = (body) => POST(new Request('http://localhost/api/jobs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
  await post({ jobId: assetJob.id, projectId: current.id });
  await post({ jobId: shotJob.id, projectId: current.id });

  assert.equal(db.getAsset(queuedAsset.id).status, 'pending');
  // 正在跑的那一个不动它，供应商请求可能仍会完成
  assert.equal(db.getAsset(runningAsset.id).status, 'running');
  assert.equal(db.getShot(queuedShot.id).status, 'pending');
  assert.equal(db.getJob(assetJob.id).status, 'canceled');

  // 已经重新提交的不能被误回收
  db.updateAsset(queuedAsset.id, { status: 'queued' });
  const again = db.createJob({ projectId: current.id, type: 'asset.prepare', targetType: 'project', targetId: current.id,
    payload: { assetIds: [queuedAsset.id] } });
  db.cancelJob(assetJob.id);
  await post({ jobId: assetJob.id, projectId: current.id });
  assert.equal(db.getAsset(queuedAsset.id).status, 'queued');
  assert.ok(db.getJob(again.id));
});

test('任务接口：校验取消参数/项目范围，Agent 计划与任务同步取消', async () => {
  const current = project();
  const { plan, job } = agent(current.id, [step(0, 'finish')]);
  const post = (body) => POST(new Request('http://localhost/api/jobs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
  assert.equal((await post(null)).status, 400);
  assert.equal((await post({ jobId: 7 })).status, 400);
  assert.equal((await post({ jobId: 'missing' })).status, 404);
  assert.equal((await post({ jobId: job.id, projectId: project().id })).status, 404);
  assert.equal(db.getJob(job.id).status, 'pending');
  const payload = await (await post({ jobId: job.id, projectId: current.id })).json();
  assert.equal(payload.ok, true);
  assert.equal(payload.data.canceled, true);
  assert.equal(db.getJob(job.id).status, 'canceled');
  assert.equal(db.getPlan(plan.id).status, 'canceled');
  assert.equal(db.getPlan(plan.id).steps[0].status, 'canceled');
});

test('Agent 执行器：规划阶段被取消后不再落库任何步骤', async () => {
  provider();
  const current = project();
  const { plan, job } = agent(current.id);
  onRequest = () => db.cancelJob(job.id);
  const result = await runAgentPlan(plan.id, context(job));
  assert.equal(result.status, 'canceled');
  assert.equal(requests.length, 1);
  assert.equal(db.getPlan(plan.id).steps.length, 0);
  assert.equal(db.listTurns(plan.id).length, 0);
  // 迟到的完成结果同样不能复活已取消的任务
  assert.equal(db.completeJob(job.id, { succeeded: 1 }).status, 'canceled');
});

test('Agent 执行器：步骤之间取消，已完成的步骤保留、后续步骤不再执行', async () => {
  const current = project();
  const { plan, job } = agent(current.id, [
    step(0, 'prompt.lookup', { query: '测试' }),
    step(1, 'finish', { message: '不应到达' }),
  ]);
  const ctx = context(job, { progress: (_value, label) => { if (label === '步骤 2') db.cancelJob(job.id); } });
  const result = await runAgentPlan(plan.id, ctx);
  assert.equal(result.status, 'canceled');
  assert.equal(requests.length, 0);
  const steps = db.getPlan(plan.id).steps;
  assert.equal(steps[0].status, 'succeeded');
  assert.notEqual(steps[1].status, 'succeeded');
  assert.equal(db.getJob(job.id).status, 'canceled');
});

test('Agent 动作：新目标取代未完成的旧计划时真正取消，而不是残留为已暂停', async () => {
  const current = project();
  provider();
  const stale = agent(current.id, [step(0, 'finish', { message: '旧计划' })]);
  // 旧计划正在跑
  db.updatePlan(stale.plan.id, { status: 'running' });

  const { startAgentPlanAction } = await import('../apps/web/src/app/actions/agent.ts');
  const result = await startAgentPlanAction(current.id, '新的目标', false);
  assert.equal(result.ok, true);
  const oldPlan = db.getPlan(stale.plan.id);
  assert.equal(oldPlan.status, 'canceled');
  assert.equal(oldPlan.steps[0].status, 'canceled');
  assert.equal(db.getJob(stale.job.id).status, 'canceled');
  // 面板展示的应当是新的那一条计划
  const { getPlanStateAction } = await import('../apps/web/src/app/actions/agent.ts');
  const state = await getPlanStateAction(current.id);
  assert.equal(state.data.plan.id, result.data.planId);
});


test('QA 任务：qa.review 挡住废片（文件丢失）并自动标记重抽', async () => {
  const current = project();
  const n = ++serial;
  const media = db.createMedia({
    projectId: current.id,
    kind: 'video',
    url: `/api/files/qa_${n}.mp4`,
    path: `media/qa_${n}.mp4`,
    mime: 'video/mp4',
    durationSec: 5,
    ownerType: 'shot',
  });
  const shot = db.createShot(current.id, {
    index: 1,
    episode: 1,
    description: 'QA 镜头',
    durationSec: 5,
    shotSize: '中景',
    characterIds: [],
    propIds: [],
    prompt: '测试提示词',
    clipMediaIds: [media.id],
    selectedMediaId: media.id,
    status: 'succeeded',
  });
  const job = db.createJob({
    type: 'qa.review',
    projectId: current.id,
    targetType: 'project',
    targetId: current.id,
    payload: { withVision: true, autoFlag: true },
    maxAttempts: 1,
  });

  const result = await HANDLERS['qa.review'](context(job));

  assert.equal(result.total, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.passed, 0);
  assert.deepEqual(result.reshootIndexes, [1]);
  // 探针判负后不再调用任何模型，省额度
  assert.equal(requests.length, 0);
  const after = db.getShot(shot.id);
  assert.equal(after.selectedMediaId, null);
  assert.equal(after.status, 'failed');
  assert.ok(after.error.includes('QA 未通过'));
});

test('QA 任务：已通过的历史报告增量跳过，不重复消耗额度', async () => {
  const current = project();
  const n = ++serial;
  const media = db.createMedia({
    projectId: current.id,
    kind: 'video',
    url: `/api/files/qa2_${n}.mp4`,
    path: `media/qa2_${n}.mp4`,
    mime: 'video/mp4',
    durationSec: 5,
    ownerType: 'shot',
  });
  db.createShot(current.id, {
    index: 2,
    episode: 1,
    description: 'QA 镜头',
    durationSec: 5,
    shotSize: '中景',
    characterIds: [],
    propIds: [],
    prompt: '测试提示词',
    clipMediaIds: [media.id],
    selectedMediaId: media.id,
    status: 'succeeded',
  });
  const history = db.createQaReport({ projectId: current.id, mediaId: media.id, source: 'auto' });
  db.updateQaReport(history.id, {
    status: 'succeeded',
    verdict: 'pass',
    probe: { ok: true, decodable: true, durationSec: 5 },
    review: null,
    issues: [],
  });

  const job = db.createJob({
    type: 'qa.review',
    projectId: current.id,
    targetType: 'project',
    targetId: current.id,
    payload: { withVision: true, autoFlag: true },
    maxAttempts: 1,
  });
  const result = await HANDLERS['qa.review'](context(job));

  assert.equal(result.total, 1);
  assert.equal(result.passed, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.failed, 0);
  assert.equal(requests.length, 0);
});
