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
const jobs = await import('../apps/web/src/app/api/open/jobs/route.ts');
const jobRoute = await import('../apps/web/src/app/api/open/jobs/[id]/route.ts');
const { requireOpenApiKey } = await import('../apps/web/src/lib/server/open-api.ts');
const { disconnectEcosystem, readPeerTopics } = await import('../apps/web/src/lib/server/ecosystem.ts');
const { normalizePeerUrl, peerJson, validatePeerAddress } = await import('../apps/web/src/lib/server/peer-http.ts');
const { proxy } = await import('../apps/web/src/proxy.ts');
const { createPairingAction } = await import('../apps/web/src/app/actions/ecosystem.ts');
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
function createGrant(allowRender = false) {
  const code = db.createPairing('SakuraSeeking', base, allowRender).code;
  grant = db.consumePairing({ code, clientName: 'SakuraSeeking', kind: 'seeking', peerBaseUrl: base, peerToken });
  return grant;
}

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
test('代理仅放开专用机器端点；管理页面和动作必须登录', async () => {
  assert.equal(proxy(new NextRequest('http://localhost:3000/api/ecosystem/pair', { method: 'POST' })).headers.get('x-middleware-next'), '1');
  assert.equal(proxy(new NextRequest('http://localhost:3000/api/ecosystem/manage')).status, 401);
  assert.equal(proxy(new NextRequest('http://localhost:3000/settings')).status, 307);
  assert.equal(proxy(new NextRequest('http://localhost:3000/settings', { headers: { Cookie: `sakura_session=${createSessionToken()}` } })).headers.get('x-middleware-next'), '1');
  assert.equal((await createPairingAction({ name: 'SakuraSeeking', peerBaseUrl: base, allowRender: false })).ok, false);
});
test('服务地址拒绝元数据/映射地址/公网 HTTP/携带凭证和重定向', async () => {
  for (const url of ['file:///etc/passwd', 'http://user:secret@localhost', 'http://localhost/?token=secret', 'http://localhost/#x']) assert.throws(() => normalizePeerUrl(url));
  for (const address of ['169.254.169.254', '0.0.0.0', '::', '::ffff:a9fe:a9fe', 'fe80::1']) assert.throws(() => validatePeerAddress(address, 'https:'));
  assert.throws(() => validatePeerAddress('8.8.8.8', 'http:'));
  validatePeerAddress('127.0.0.1', 'http:');
  await assert.rejects(peerJson(base, '/api/ecosystem/redirect', { token: peerToken }), /302/);
});