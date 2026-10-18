import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const { NextRequest } = createRequire(new URL('../apps/web/package.json', import.meta.url))('next/server');

const data = mkdtempSync(join(tmpdir(), 'sakura-ecosystem-'));
process.env.SAKURA_DATA_DIR = data;
process.env.SAKURA_DB_FILE = join(data, 'test.db');
process.env.SAKURA_SECRET = 'isolated-ecosystem-test-secret';
const db = await import('../packages/db/src/index.ts');
const pair = await import('../apps/web/src/app/api/ecosystem/pair/route.ts');
const projects = await import('../apps/web/src/app/api/open/projects/route.ts');
const projectRoute = await import('../apps/web/src/app/api/open/projects/[id]/route.ts');
const screenplayRoute = await import('../apps/web/src/app/api/open/projects/[id]/screenplay/route.ts');
const ecosystemStatus = await import('../apps/web/src/app/api/ecosystem/status/route.ts');
const jobs = await import('../apps/web/src/app/api/open/jobs/route.ts');
const jobRoute = await import('../apps/web/src/app/api/open/jobs/[id]/route.ts');
const { requireOpenApiKey } = await import('../apps/web/src/lib/server/open-api.ts');
const { disconnectEcosystem, readPeerTopics, setEcosystemScreenplayImport } = await import('../apps/web/src/lib/server/ecosystem.ts');
const { normalizePeerUrl, peerJson, validatePeerAddress } = await import('../apps/web/src/lib/server/peer-http.ts');
const { proxy } = await import('../apps/web/src/proxy.ts');
const { createPairingAction, setScreenplayImportAction } = await import('../apps/web/src/app/actions/ecosystem.ts');
const { createSessionToken } = await import('../apps/web/src/lib/session.ts');
let base;
let grant;
let peerActive = true;
let topicsRead = 0;
const peerToken = 'reverse-test-token-with-at-least-32-characters';
const server = createServer((req, res) => {
  if (req.headers.authorization !== `Bearer ${peerToken}` || !peerActive) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end('{}'); return; }
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/api/ecosystem/status') res.end(JSON.stringify({ active: true, grantId: grant.id }));
  else if (req.url === '/api/ecosystem/revoke') { peerActive = false; res.end('{"revoked":true}'); }
  else if (req.url === '/api/ecosystem/redirect') { res.writeHead(302, { Location: '/unexpected' }); res.end('{}'); }
  else if (req.url === '/api/ecosystem/topics') {
    topicsRead++;
    res.end(JSON.stringify({ topics: [{ key: 'topic-1', keyword: '测试', title: '来源选题', reason: '来源关联', sharedAt: new Date().toISOString(), source: { id: 'source-1', title: '来源标题', sourceName: '授权来源', sourceUrl: 'https://example.test/source', observedAt: new Date().toISOString(), kind: 'sourced' } }] }));
  } else { res.writeHead(404); res.end('{}'); }
});
before(async () => { await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`; });
beforeEach(() => {
  delete process.env.AICUT_OPEN_API_KEYS;
  db.getDb().exec('DELETE FROM ecosystem_pairings; DELETE FROM ecosystem_grants; DELETE FROM ecosystem_rate_limits; DELETE FROM ecosystem_projects; DELETE FROM jobs; DELETE FROM projects;');
  peerActive = true; topicsRead = 0;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.closeDb();
  createRequire(new URL('../apps/web/package.json', import.meta.url))('@sakura/db').closeDb();
  rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
function request(path, key = '', body) {
  return new Request(`http://localhost:3000${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'X-API-Key': key, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
}
function createGrant(allowRender = false, allowScreenplayImport = false) {
  const code = db.createPairing('SakuraSeeking', base, allowRender, allowScreenplayImport).code;
  grant = db.consumePairing({ code, clientName: 'SakuraSeeking', kind: 'seeking', peerBaseUrl: base, peerToken });
  return grant;
}

const screenplayInput = { title: '待审核的剧本', logline: '保留用户提供的故事', synopsis: '草稿梗概', raw: 'SakuraSeeking 剧本原文 · 待人工审核',
  scenes: [{ durationSec: 15, visual: '原有画面描述', narration: '原有旁白' }, { durationSec: 10, visual: '收尾画面', narration: '收尾旁白' }] };
function linkedProject(current, name = '剧本导入测试') {
  const project = db.createProject({ name }); db.linkEcosystemProject(project.id, current.id); return project;
}
function importDraft(id, key, requestId = 'screenplay-once', body = screenplayInput) {
  const req = request(`/api/open/projects/${id}/screenplay`, key, body);
  if (requestId !== null) req.headers.set('Idempotency-Key', requestId);
  return screenplayRoute.POST(req, { params: Promise.resolve({ id }) });
}

test('剧本导入默认关闭，可在原授权单独开关，白名单和吊销限制生效', async () => {
  const current = createGrant(); const project = linkedProject(current);
  assert.equal(current.scope.includes('screenplay:import'), false);
  assert.equal((await importDraft(project.id, current.apiKey)).status, 403);
  assert.equal(db.getScreenplay(project.id), null);
  setEcosystemScreenplayImport(current.id, true); setEcosystemScreenplayImport(current.id, true);
  const status = await ecosystemStatus.GET(request('/api/ecosystem/status', current.apiKey)).json();
  assert.equal(status.scope.split(' ').filter((scope) => scope === 'screenplay:import').length, 1);
  assert.equal(status.scope.includes('jobs:submit'), false);
  assert.equal((await importDraft(project.id, current.apiKey)).status, 201);
  setEcosystemScreenplayImport(current.id, false);
  assert.equal((await importDraft(project.id, current.apiKey)).status, 403);
  assert.ok(db.getScreenplay(project.id));
  assert.throws(() => db.setGrantScope(current.id, ['unsupported:scope']));
  assert.throws(() => db.setGrantScope(current.id, []));
  db.revokeGrant(current.id);
  assert.throws(() => setEcosystemScreenplayImport(current.id, true));
  assert.throws(() => db.setGrantScope(current.id, ['screenplay:import']));
});

test('显式导入落一版待审核草稿，仅节拍不造人物、场景、道具或制作镜头', async () => {
  const current = createGrant(false, true); const project = linkedProject(current);
  const response = await importDraft(project.id, current.apiKey); assert.equal(response.status, 201);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const result = await response.json();
  assert.equal(result.id, project.id); assert.equal(result.version, 1); assert.equal(result.reviewRequired, true); assert.equal(result.imported, true); assert.equal(result.repeated, false);
  const screenplay = db.getScreenplay(project.id);
  assert.equal(screenplay.id, result.screenplayId); assert.equal(screenplay.raw, screenplayInput.raw); assert.equal(screenplay.source, 'manual');
  assert.equal(screenplay.logline, screenplayInput.logline); assert.equal(screenplay.synopsis, screenplayInput.synopsis);
  assert.deepEqual(screenplay.characters, []); assert.deepEqual(screenplay.locations, []); assert.deepEqual(screenplay.props, []);
  assert.equal(screenplay.beats.length, screenplayInput.scenes.length);
  for (const [index, beat] of screenplay.beats.entries()) {
    assert.equal(beat.durationSec, screenplayInput.scenes[index].durationSec);
    assert.equal(beat.summary, `画面：${screenplayInput.scenes[index].visual}\n旁白：${screenplayInput.scenes[index].narration}`);
    assert.deepEqual(beat.characterIds, []); assert.equal(beat.locationId, null); assert.equal(beat.mood, '');
  }
  const versions = db.listScreenplayVersions(project.id); assert.equal(versions.length, 1);
  assert.match(versions[0].title, /待人工审核/); assert.equal(versions[0].source, 'manual');
  const snapshot = JSON.parse(versions[0].dataJson); assert.equal(snapshot.logline, screenplayInput.logline); assert.deepEqual(snapshot.beats, screenplay.beats);
  for (const table of ['assets', 'shots', 'jobs']) {
    assert.equal(db.getDb().prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE project_id = ?`).get(project.id).count, 0);
  }
  assert.equal(db.findScreenplayImport(current.id, 'screenplay-once').importedAt, result.importedAt);
});

test('同一导入幂等重放返回 200，后续人工改稿或进入后期也不会覆盖', async () => {
  const current = createGrant(false, true); const project = linkedProject(current);
  const first = await (await importDraft(project.id, current.apiKey)).json();
  const screenplay = db.getScreenplay(project.id);
  db.upsertScreenplay(project.id, { ...screenplay, raw: '制作端人工修订，不能覆盖' });
  db.updateProject(project.id, { stage: 'edit' });
  const response = await importDraft(project.id, current.apiKey, 'screenplay-once', { ...screenplayInput, raw: '重复请求的新正文' });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ...first, repeated: true });
  assert.equal(db.getScreenplay(project.id).raw, '制作端人工修订，不能覆盖'); assert.equal(db.listScreenplayVersions(project.id).length, 1);
  assert.equal((await importDraft(project.id, current.apiKey, 'new-attempt')).status, 409);
});

test('已有剧本即使在初期也返回 409，已有版本与正文完整保留', async () => {
  const current = createGrant(false, true); const project = linkedProject(current);
  db.updateProject(project.id, { stage: 'script' });
  db.upsertScreenplay(project.id, { title: '人工原稿', logline: '', synopsis: '', raw: '不可覆盖', source: 'manual', characters: [], locations: [], props: [], beats: [] });
  const original = db.getScreenplay(project.id);
  const response = await importDraft(project.id, current.apiKey);
  assert.equal(response.status, 409); assert.match((await response.json()).error, /已有剧本/);
  assert.deepEqual(db.getScreenplay(project.id), original); assert.equal(db.listScreenplayVersions(project.id).length, 0);
  assert.equal(db.findScreenplayImport(current.id, 'screenplay-once'), null);
});

test('新库迁移、密钥摘要与对端令牌加密，重开数据库仍可鉴权', () => {
  const current = createGrant();
  const row = db.getDb().prepare('SELECT * FROM ecosystem_grants WHERE id = ?').get(current.id);
  assert.notEqual(row.api_key, current.apiKey); assert.equal(row.api_key.length, 64);
  assert.ok(!row.peer_token.includes(peerToken)); assert.equal(db.getPeer(current.id).token, peerToken);
  assert.ok(!JSON.stringify(db.listGrants()).includes(current.apiKey));
  db.closeDb(); assert.equal(db.findActiveGrant(current.apiKey).id, current.id);
});
test('配对码格式、到期、名称/地址绑定、一次性消费及删除后不可复用', () => {
  const item = db.createPairing('SakuraSeeking', base);
  assert.match(item.code, /^[23456789A-HJ-NP-Z]{6}$/);
  const input = { code: item.code, clientName: 'SakuraSeeking', kind: 'seeking', peerBaseUrl: base, peerToken };
  assert.throws(() => db.consumePairing({ ...input, peerBaseUrl: `${base}/wrong` }));
  assert.throws(() => db.consumePairing({ ...input, clientName: 'wrong' }));
  const current = db.consumePairing(input);
  assert.throws(() => db.consumePairing(input)); db.revokeGrant(current.id); db.deleteGrant(current.id);
  assert.throws(() => db.consumePairing(input));
  const expired = db.createPairing('SakuraSeeking', base);
  db.getDb().prepare('UPDATE ecosystem_pairings SET expires_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', expired.id);
  assert.throws(() => db.consumePairing({ ...input, code: expired.code }));
});
test('预览版库升级会清除明文凭证、废止旧授权、补全配对地址列', () => {
  db.getDb().exec("DROP TABLE ecosystem_pairings; CREATE TABLE ecosystem_pairings (id TEXT PRIMARY KEY, code TEXT UNIQUE, name TEXT, expires_at TEXT, grant_id TEXT, created_at TEXT);");
  db.getDb().prepare('INSERT INTO ecosystem_grants (id,name,kind,api_key,peer_base_url,peer_token,scope,paired_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run('legacy', '旧版', 'seeking', 'sak_live_legacy_plaintext', base, 'old-plain-token', 'projects:read', '2000', '2000', '2000');
  db.closeDb();
  const row = db.getDb().prepare('SELECT * FROM ecosystem_grants WHERE id = ?').get('legacy');
  assert.equal(row.api_key.length, 64); assert.equal(row.peer_token, ''); assert.ok(row.revoked_at);
  assert.equal(db.findActiveGrant('sak_live_legacy_plaintext'), null);
  assert.ok(db.createPairing('SakuraSeeking', base).peerBaseUrl);
});
test('并发核销配对码时恰好一次成功', async () => {
  const code = db.createPairing('SakuraSeeking', base).code;
  const input = { code, clientName: 'SakuraSeeking', peerBaseUrl: base, peerToken };
  const responses = await Promise.all([pair.POST(request('/api/ecosystem/pair', '', input)), pair.POST(request('/api/ecosystem/pair', '', input))]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 400]);
  assert.equal(db.listGrants().length, 1);
});
test('持久化限流不会因为重开数据库重置', () => {
  for (let index = 0; index < 3; index++) assert.equal(db.takeEcosystemRateLimit('test', 3, 1000), true);
  db.closeDb(); assert.equal(db.takeEcosystemRateLimit('test', 3, 1001), false);
  assert.equal(db.takeEcosystemRateLimit('test', 3, 61_001), true);
});
test('配对端点严格验证，实际返回权限与颁发范围相同', async () => {
  const item = db.createPairing('SakuraSeeking', base);
  assert.equal((await pair.POST(request('/api/ecosystem/pair', '', null))).status, 400);
  const input = { code: item.code, clientName: 'SakuraSeeking', peerBaseUrl: base, peerToken };
  const response = await pair.POST(request('/api/ecosystem/pair', '', input));
  assert.equal(response.status, 201); assert.equal(response.headers.get('cache-control'), 'no-store');
  const value = await response.json(); assert.deepEqual(value.capabilities, value.scope.split(' ')); assert.ok(!value.capabilities.includes('jobs:submit'));
  assert.equal((await pair.POST(request('/api/ecosystem/pair', '', input))).status, 400);
  for (let index = 0; index < 12; index++) await pair.POST(request('/api/ecosystem/pair', '', input));
  assert.equal((await pair.POST(request('/api/ecosystem/pair', '', input))).status, 429);
});
test('无静态 Key 也可动态授权；默认拒绝渲染；静态 Key 兼容', async () => {
  const current = createGrant();
  assert.equal(await requireOpenApiKey(request('/api/open/projects', current.apiKey), 'projects:read'), null);
  assert.equal((await requireOpenApiKey(request('/api/open/jobs', current.apiKey), 'jobs:submit')).status, 403);
  assert.equal((await requireOpenApiKey(request('/api/open/projects'), 'projects:read')).status, 401);
  process.env.AICUT_OPEN_API_KEYS = ' test-static , other-key ';
  peerActive = false;
  assert.equal(await requireOpenApiKey(request('/api/open/jobs', 'test-static'), 'jobs:submit'), null);
});
test('创建传递严格设定和溯源；幂等重试不重复建项目；剧本未导入', async () => {
  const current = createGrant();
  const source = { id: 'source-1', title: '来源标题', sourceName: '授权来源', sourceUrl: 'https://example.test/source', observedAt: new Date().toISOString(), kind: 'sourced' };
  const body = { name: '创作包', brief: { logline: '一句话故事', aspectRatio: '16:9', targetDurationSec: 60, notes: '待审核', provenance: { producer: 'SakuraSeeking', schemaVersion: '1.0', createdAt: new Date().toISOString(), keyword: '测试', generator: 'template', reviewRequired: true, source } } };
  const send = () => { const req = request('/api/open/projects', current.apiKey, body); req.headers.set('Idempotency-Key', 'test-request'); return projects.POST(req); };
  const first = await send(); assert.equal(first.status, 201);
  const value = await first.json(); assert.equal(value.imported, false); assert.equal(value.reviewRequired, true);
  assert.equal((await (await send()).json()).id, value.id); assert.equal(db.listProjects().length, 1);
  assert.deepEqual(db.getProject(value.id).brief.provenance.source, source);
  assert.equal(db.getScreenplay(value.id), null);
  for (const brief of [null, [], { aspectRatio: 'bad' }, { language: 'bad' }, { targetDurationSec: '60' }, { extra: true }]) {
    assert.equal((await projects.POST(request('/api/open/projects', current.apiKey, { name: '拒绝', brief }))).status, 400);
  }
});
test('动态授权看不到不属于它的项目或任务，关联项目可回读状态', async () => {
  const current = createGrant();
  const own = await (await projects.POST(request('/api/open/projects', current.apiKey, { name: '关联项目' }))).json();
  const other = db.createProject({ name: '私有项目' });
  const job = db.createJob({ projectId: own.id, type: 'timeline.render', payload: {} });
  const hidden = db.createJob({ projectId: other.id, type: 'timeline.render', payload: {} });
  const list = await (await projects.GET(request('/api/open/projects', current.apiKey))).json();
  assert.deepEqual(list.projects.map((item) => item.id), [own.id]);
  assert.equal((await projectRoute.GET(request('/api/open/projects/x', current.apiKey), { params: Promise.resolve({ id: other.id }) })).status, 404);
  const status = await (await projectRoute.GET(request('/api/open/projects/x', current.apiKey), { params: Promise.resolve({ id: own.id }) })).json();
  assert.equal(status.stage, 'brief'); assert.equal(status.jobs[0].jobId, job.id);
  assert.equal((await jobRoute.GET(request('/api/open/jobs/x', current.apiKey), { params: Promise.resolve({ id: hidden.id }) })).status, 404);
  assert.equal((await jobs.POST(request('/api/open/jobs', current.apiKey, { projectId: own.id }))).status, 403);
});
test('AiCut 真正调用共享选题；本端/对端吊销都阻止后续调用', async () => {
  const current = createGrant();
  const topics = await readPeerTopics(current.id); assert.equal(topics.length, 1); assert.equal(topicsRead, 1);
  assert.deepEqual(await disconnectEcosystem(current.id), { notified: true }); assert.equal(peerActive, false);
  assert.equal((await requireOpenApiKey(request('/api/open/projects', current.apiKey), 'projects:read')).status, 401);
  await assert.rejects(readPeerTopics(current.id));
  peerActive = true; const second = createGrant(); peerActive = false;
  assert.equal((await requireOpenApiKey(request('/api/open/projects', second.apiKey), 'projects:read')).status, 401);
  assert.equal(db.findActiveGrant(second.apiKey), null);
});
test('显式渲染权限可以提交本授权项目；静态 Key 保留无项目任务查询兼容', async () => {
  const current = createGrant(true);
  const project = await (await projects.POST(request('/api/open/projects', current.apiKey, { name: '渲染测试' }))).json();
  assert.equal((await jobs.POST(request('/api/open/jobs', current.apiKey, null))).status, 400);
  const response = await jobs.POST(request('/api/open/jobs', current.apiKey, { projectId: project.id, includeSubtitles: false }));
  assert.equal(response.status, 201);
  const job = db.getJob((await response.json()).jobId);
  assert.equal(job.payload.includeSubtitles, false); assert.equal(job.status, 'pending');
  const unattached = db.createJob({ type: 'timeline.render', payload: {} });
  process.env.AICUT_OPEN_API_KEYS = 'static-test';
  assert.equal((await jobRoute.GET(request('/api/open/jobs/x', 'static-test'), { params: Promise.resolve({ id: unattached.id }) })).status, 200);
});
test('代理仅放开专用机器端点；管理页面和动作必须登录', async () => {
  assert.equal(proxy(new NextRequest('http://localhost:3000/api/ecosystem/pair', { method: 'POST' })).headers.get('x-middleware-next'), '1');
  assert.equal(proxy(new NextRequest('http://localhost:3000/api/ecosystem/manage')).status, 401);
  assert.equal(proxy(new NextRequest('http://localhost:3000/settings')).status, 307);
  assert.equal(proxy(new NextRequest('http://localhost:3000/settings', { headers: { Cookie: `sakura_session=${createSessionToken()}` } })).headers.get('x-middleware-next'), '1');
  assert.equal(proxy(new NextRequest('http://localhost:3000/api/open/projects/prj_test/screenplay', { method: 'POST' })).headers.get('x-middleware-next'), '1');
  assert.equal((await setScreenplayImportAction({ id: 'grant_test', enabled: true })).ok, false);
  assert.equal((await createPairingAction({ name: 'SakuraSeeking', peerBaseUrl: base, allowRender: false, allowScreenplayImport: false })).ok, false);
});
test('导入拒绝后期项目、跨项目幂等键及其他授权项目', async () => {
  const current = createGrant(false, true); const first = linkedProject(current); const second = linkedProject(current);
  assert.equal((await importDraft(first.id, current.apiKey, 'shared-key')).status, 201);
  assert.equal((await importDraft(second.id, current.apiKey, 'shared-key')).status, 409);
  assert.equal(db.getScreenplay(second.id), null);
  for (const stage of ['assets', 'shots', 'edit', 'done']) {
    const project = linkedProject(current); db.updateProject(project.id, { stage });
    assert.equal((await importDraft(project.id, current.apiKey, `stage-${stage}`)).status, 409);
    assert.equal(db.getScreenplay(project.id), null);
  }
  const other = db.createProject({ name: '非本授权项目' });
  assert.equal((await importDraft(other.id, current.apiKey, 'foreign')).status, 404);
  assert.equal((await importDraft(first.id, '', 'unauthorized')).status, 401);
  db.updateProject(second.id, { stage: 'script' });
  assert.equal((await importDraft(second.id, current.apiKey, 'empty-script-stage')).status, 201);
});

test('导入正文严格校验、大小限制和幂等键必填，不接受伪造镜头字段', async () => {
  const current = createGrant(false, true); const project = linkedProject(current);
  for (const key of [null, '', 'invalid key', 'x'.repeat(161)]) assert.equal((await importDraft(project.id, current.apiKey, key)).status, 400);
  for (const body of [
    { ...screenplayInput, raw: '' }, { ...screenplayInput, characters: [{ name: '不存在的人物卡' }] },
    { ...screenplayInput, scenes: [{ ...screenplayInput.scenes[0], durationSec: '15' }] },
    { ...screenplayInput, scenes: [{ ...screenplayInput.scenes[0], camera: '虚构参数' }] },
  ]) assert.equal((await importDraft(project.id, current.apiKey, 'invalid', body)).status, 400);
  assert.equal((await importDraft(project.id, current.apiKey, 'large', { ...screenplayInput, raw: '字'.repeat(32_000) })).status, 413);
  assert.equal(db.getScreenplay(project.id), null);
});

test('导入写入前再次校验撤销和降权，不留下部分草稿', async () => {
  const current = createGrant(false, true); const project = linkedProject(current);
  for (const revoked of [false, true]) {
    if (!revoked) setEcosystemScreenplayImport(current.id, true);
    const req = request(`/api/open/projects/${project.id}/screenplay`, current.apiKey, screenplayInput);
    req.headers.set('Idempotency-Key', 'during-read');
    const body = req.body;
    Object.defineProperty(req, 'body', { get() {
      if (revoked) db.revokeGrant(current.id); else setEcosystemScreenplayImport(current.id, false);
      return body;
    } });
    const response = await screenplayRoute.POST(req, { params: Promise.resolve({ id: project.id }) });
    assert.equal(response.status, revoked ? 401 : 403);
    assert.equal(db.getScreenplay(project.id), null);
    if (!revoked) setEcosystemScreenplayImport(current.id, true);
  }
});

test('静态 Key 可导入但同样不覆盖，并发导入仅落一次', async () => {
  process.env.AICUT_OPEN_API_KEYS = 'static-import-test';
  const project = db.createProject({ name: '静态导入' });
  const responses = await Promise.all([importDraft(project.id, 'static-import-test'), importDraft(project.id, 'static-import-test')]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
  assert.equal(db.listScreenplayVersions(project.id).length, 1);
  assert.equal((await importDraft(project.id, 'static-import-test', 'different-key')).status, 409);
});

test('导入失败回滚剧本与版本，数据库重开仍保留幂等记录', async () => {
  const current = createGrant(false, true); const project = linkedProject(current);
  db.getDb().exec("CREATE TRIGGER reject_import BEFORE INSERT ON ecosystem_screenplay_imports BEGIN SELECT RAISE(ABORT, 'isolated-test'); END;");
  try { assert.equal((await importDraft(project.id, current.apiKey)).status, 503); }
  finally { db.getDb().exec('DROP TRIGGER reject_import'); }
  assert.equal(db.getScreenplay(project.id), null); assert.equal(db.listScreenplayVersions(project.id).length, 0);
  const first = await (await importDraft(project.id, current.apiKey)).json();
  db.closeDb();
  createRequire(new URL('../apps/web/package.json', import.meta.url))('@sakura/db').closeDb();
  const replay = await importDraft(project.id, current.apiKey); assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), { ...first, repeated: true });
});

test('旧生态库补建导入记录表，不影响已配对授权', () => {
  const current = createGrant();
  db.closeDb(); createRequire(new URL('../apps/web/package.json', import.meta.url))('@sakura/db').closeDb();
  db.getDb().exec('DROP TABLE ecosystem_screenplay_imports'); db.closeDb();
  assert.equal(db.findActiveGrant(current.apiKey).id, current.id);
  assert.equal(db.getDb().prepare('SELECT COUNT(*) AS count FROM ecosystem_screenplay_imports').get().count, 0);
  assert.equal(db.findActiveGrant(current.apiKey).scope.includes('screenplay:import'), false);
});

test('服务地址拒绝元数据/映射地址/公网 HTTP/携带凭证和重定向', async () => {
  for (const url of ['file:///etc/passwd', 'http://user:secret@localhost', 'http://localhost/?token=secret', 'http://localhost/#x']) assert.throws(() => normalizePeerUrl(url));
  for (const address of ['169.254.169.254', '0.0.0.0', '::', '::ffff:a9fe:a9fe', 'fe80::1']) assert.throws(() => validatePeerAddress(address, 'https:'));
  assert.throws(() => validatePeerAddress('8.8.8.8', 'http:'));
  validatePeerAddress('127.0.0.1', 'http:');
  await assert.rejects(peerJson(base, '/api/ecosystem/redirect', { token: peerToken }), /302/);
});