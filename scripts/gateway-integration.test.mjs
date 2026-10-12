import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const data = mkdtempSync(join(tmpdir(), 'sakura-gateway-test-'));
process.env.SAKURA_DATA_DIR = data;
process.env.SAKURA_DB_FILE = join(data, 'test.db');
const db = await import('../packages/db/src/index.ts');
const { findPreset } = await import('../packages/core/src/index.ts');
const { resolveRoute } = await import('../packages/core/src/ai/router.ts');
const { connectGateway, refreshGateway, listGatewayConnections } = await import('../apps/web/src/lib/server/gateway.ts');
const { connectGatewayByAuthorization } = await import('../apps/web/src/lib/server/gateway.ts');
const {
  startGatewayAuthorization,
  completeGatewayAuthorization,
  loadAuthorization,
  saveAuthorization,
  gatewayDraft,
  fetchAuthorizedConfig,
} = await import('../apps/web/src/lib/server/gateway-oauth.ts');
const { normalizeGatewayUrl, validateGatewayAddress, requestGatewayJson } = await import('../apps/web/src/lib/server/gateway-http.ts');
const protocol = findPreset('compatible').protocol;
const apiKey = 'sk-local_test-call-key';
let base;
let models;
let requests;
let authorizations;
let cancelled;
let keyDisabled;
let remoteKeyId;
let responder;
let oauthRequests;
let oauthTokens;
let oauthResponse;
let usedCodes;
let challenge;
const originalFetch = globalThis.fetch;

function json(response, value, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(value));
}

function config() {
  return {
    verified: true,
    gateway: { service: 'sakura-ai-gateway', version: '2.8.0' },
    apiKey: { id: remoteKeyId, name: '测试调用 Key', modelAccessMode: 'custom', allowedModels: models.map((model) => model.id) },
    endpoints: { [protocol]: { models: '/v1/models', chat: '/v1/chat/completions', responses: '/v1/responses' } },
    models,
    modelsCount: models.length,
  };
}

function defaultResponder(request, response, body) {
  if (request.url.endsWith('/api/integration/verify')) {
    if (body.apiKey !== apiKey && body.apiKey !== 'sk-local_test-new-key' || keyDisabled) {
      return json(response, { error: { message: `invalid ${body.apiKey}`, code: 'unauthorized' } }, 401);
    }
    if (body.authorization && (cancelled || !authorizations.has(body.authorization))) {
      return json(response, { error: { code: 'authorization_cancelled' } }, 403);
    }
    const token = body.authorization || `sakura-int_test-${authorizations.size + 1}`;
    authorizations.add(token);
    return json(response, { ...config(), authorization: { id: 'int_test', status: 'active', ...(!body.authorization ? { token } : {}) } });
  }
  if (request.url.endsWith('/api/integration/config')) {
    if (keyDisabled) return json(response, { error: { code: 'unauthorized' } }, 401);
    if (cancelled) return json(response, { error: { code: 'authorization_cancelled' } }, 403);
    if (!authorizations.has(request.headers.authorization?.replace('Bearer ', ''))) return json(response, {}, 401);
    return json(response, config());
  }
  if (request.url.endsWith('/v1/chat/completions')) {
    assert.equal(request.headers.authorization, `Bearer ${apiKey}`);
    return json(response, { choices: [{ message: { content: '测试文本生成成功' } }] });
  }
  return json(response, {}, 404);
}

const server = createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    requests.push({ url: request.url, method: request.method, headers: request.headers, body });
    await responder(request, response, body);
  } catch { json(response, {}, 500); }
});

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  globalThis.fetch = (url, options) => {
    assert.equal(new URL(url).origin, base, '测试不得访问真实模型服务');
    return originalFetch(url, options);
  };
});

beforeEach(() => {
  db.getDb().exec('DELETE FROM model_routes; DELETE FROM providers;');
  models = [{ id: 'group/story:latest', supportsThinking: true, thinkingLevels: ['low', 'high'] }, { id: 'video-named-text-model' }];
  requests = [];
  authorizations = new Set();
  cancelled = false;
  keyDisabled = false;
  remoteKeyId = 'key_test';
  oauthRequests = [];
  oauthTokens = new Map();
  oauthResponse = () => ({ access_token: `sakura-at_test-${oauthRequests.length}`, refresh_token: `sakura-rt_test-${oauthRequests.length}`, expires_in: 3600, scope: 'models:read models:invoke offline_access' });
  usedCodes = new Set();
  challenge = '';
  process.env.SAKURA_PUBLIC_BASE_URL = 'https://cut.example.test';
  db.getDb().prepare("DELETE FROM settings WHERE key LIKE 'gateway_%'").run();
  responder = defaultResponder;
});

after(() => {
  delete process.env.SAKURA_PUBLIC_BASE_URL;
  globalThis.fetch = originalFetch;
  db.closeDb();
  server.closeAllConnections();
  server.close();
  try { rmSync(data, { recursive: true, force: true }); } catch { /* 其他模块连接在进程退出时释放 */ }
});

const connect = (patch = {}) => connectGateway({ baseUrl: base, apiKey, allowPrivateNetwork: true, name: '测试网关', ...patch });

test('网关网址规范化保留部署前缀，拒绝凭据、非 HTTP 协议和查询参数', () => {
  assert.equal(normalizeGatewayUrl(' https://gateway.example.test/prefix/v1/ '), 'https://gateway.example.test/prefix');
  assert.equal(normalizeGatewayUrl('https://gateway.example.test/'), 'https://gateway.example.test');
  for (const url of ['', 'not-a-url', 'file:///private', 'ftp://gateway.example.test', 'https://user:password@gateway.example.test',
    'https://gateway.example.test/?token=value', 'https://gateway.example.test/#private', 'https://gateway.example.test/line\nbreak', 'https://gateway.example.test/\\path']) {
    assert.throws(() => normalizeGatewayUrl(url));
  }
});

test('网关地址检查：内网需显式允许，公网禁止明文，特殊与映射元数据地址始终拒绝', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.18.0.2', '192.168.1.2', '::1', 'fd00::1', '::ffff:127.0.0.1']) {
    assert.throws(() => validateGatewayAddress(address, 'https:', false), /内网/);
    assert.doesNotThrow(() => validateGatewayAddress(address, 'http:', true));
  }
  for (const address of ['0.0.0.0', '169.254.169.254', '100.100.100.200', '168.63.129.16', '224.0.0.1', '::', 'fe80::1', 'ff02::1', '::ffff:a9fe:a9fe']) {
    assert.throws(() => validateGatewayAddress(address, 'https:', true), /不能连接/);
  }
  assert.throws(() => validateGatewayAddress('203.0.113.7', 'http:', true), /HTTPS/);
  assert.doesNotThrow(() => validateGatewayAddress('203.0.113.7', 'https:', false));
});

test('接入真实 HTTP 流程：加密凭据、只公开摘要、保留模型 ID 和思考元数据，不猜媒体能力', async () => {
  process.env.SAKURA_PUBLIC_BASE_URL = 'http://127.0.0.1:3210';
  const started = startGatewayAuthorization(`${base}/prefix`);
  const authorize = new URL(started.authorizeUrl);
  assert.equal(authorize.pathname, '/prefix/oauth/authorize');
  assert.equal(authorize.searchParams.get('client_id'), 'auto');
  assert.equal(authorize.searchParams.get('name'), 'Sakura AI Cut');
  assert.equal(authorize.searchParams.get('redirect_uri'), 'http://127.0.0.1:3210/settings/gateway/callback');
  assert.equal(authorize.searchParams.get('response_type'), 'code');
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authorize.searchParams.get('scope'), 'models:read models:invoke offline_access');
  challenge = authorize.searchParams.get('code_challenge');
  assert.ok(/^[A-Za-z0-9_-]{43}$/.test(challenge));
  const draft = gatewayDraft(started.draftId);
  assert.ok(draft && createHash('sha256').update(draft.verifier).digest('base64url') === challenge, 'PKCE challenge 必须由 verifier 派生');
  assert.equal(draft.state, started.state);

  responder = (request, response, body) => {
    if (request.url.endsWith('/oauth/token')) {
      oauthRequests.push({ url: request.url, body });
      if (body.grant_type === 'authorization_code') {
        if (usedCodes.has(body.code) || typeof body.code_verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(body.code_verifier)) {
          return json(response, { error: 'invalid_grant', error_description: '授权码或 PKCE 无效' }, 400);
        }
        usedCodes.add(body.code);
      }
      let result;
      try {
        result = oauthResponse(request, body);
      } catch {
        return json(response, { error: 'invalid_grant', error_description: '授权码或 PKCE 无效' }, 400);
      }
      oauthTokens.set(result.access_token, result.refresh_token);
      return json(response, result);
    }
    if (request.url.endsWith('/api/integration/config') && request.headers.authorization?.startsWith('Bearer sakura-at_')) {
      if (!oauthTokens.has(request.headers.authorization.replace('Bearer ', ''))) return json(response, { error: 'invalid_token' }, 401);
      return json(response, config());
    }
    return defaultResponder(request, response, body);
  };
  await assert.rejects(completeGatewayAuthorization({ state: started.state, error: 'access_denied', errorDescription: '用户拒绝' }), /用户拒绝/);
  assert.equal(loadAuthorization(), null);
  const stateBeforeReuse = startGatewayAuthorization(base).state;
  await completeGatewayAuthorization({ code: 'code-2', state: started.state });
  const completed = await completeGatewayAuthorization({ code: 'code-1', state: started.state });
  assert.equal(completed.ok, true);
  assert.equal(completed.gatewayUrl, `${base}/prefix`);
  // 授权码的单次有效性由网关侧校验。
  await assert.rejects(completeGatewayAuthorization({ code: 'code-1', state: stateBeforeReuse }), /HTTP 400/);
  const saved = loadAuthorization();
  assert.ok(saved?.accessToken && saved.refreshToken && saved.clientId === 'auto');
  assert.equal(oauthRequests[0].body.redirect_uri, 'http://127.0.0.1:3210/settings/gateway/callback');
  assert.ok(!JSON.stringify(saved).includes(apiKey), '账号授权不得保留来源 Key');

  const connected = await connectGatewayByAuthorization();
  assert.equal(connected.connection.modelCount, models.length);
  const provider = db.getProvider(connected.connection.providerId);
  assert.equal(provider.credentials.gatewayBaseUrl, `${base}/prefix`);
  assert.equal(provider.credentials.apiKey, `oauth:${remoteKeyId}`);
  assert.ok(!provider.credentials.gatewayToken.includes('sk-local'));
  const exposed = JSON.stringify(connected) + JSON.stringify(listGatewayConnections()) + JSON.stringify(db.listProviders({ maskCredentials: true }));
  assert.ok(!exposed.includes(saved.accessToken) && !exposed.includes(saved.refreshToken));
  assert.deepEqual(db.listModelRoutes(), []);
  await refreshGateway(connected.connection.providerId);
  assert.equal(requests.at(-1).headers.authorization, `Bearer ${saved.accessToken}`);
  models = [{ id: 'oauth-text-model' }];
  const synced = await connectGatewayByAuthorization();
  assert.equal(synced.connection.providerId, connected.connection.providerId);
  assert.deepEqual(db.getProvider(synced.connection.providerId).models.map((model) => model.id), ['oauth-text-model']);
  await completeGatewayAuthorization({ code: 'code-3', state: started.state });

  saveAuthorization({ ...saved, expiresAt: new Date(Date.now() - 1000).toISOString() });
  oauthResponse = () => ({ access_token: 'sakura-at_test-rotated', refresh_token: 'sakura-rt_test-rotated', expires_in: 3600 });
  const refreshed = await fetchAuthorizedConfig();
  assert.equal(refreshed.token, 'sakura-at_test-rotated');
  assert.equal(oauthRequests.at(-1).body.grant_type, 'refresh_token');
  assert.equal(loadAuthorization().accessToken, 'sakura-at_test-rotated');
  oauthResponse = () => { throw new Error('invalid_grant'); };
  saveAuthorization({ ...loadAuthorization(), expiresAt: new Date(Date.now() - 1000).toISOString() });
  await assert.rejects(fetchAuthorizedConfig(), /授权已失效/);
  assert.equal(loadAuthorization(), null);
  delete process.env.SAKURA_PUBLIC_BASE_URL;
});

test('未配置外部访问地址不能发起账号授权', () => {
  delete process.env.SAKURA_PUBLIC_BASE_URL;
  assert.throws(() => startGatewayAuthorization(base), /外部访问地址/);
});

test('接入真实 HTTP 流程：加密凭据、只公开摘要、保留模型 ID 和思考元数据，不猜媒体能力', async () => {
  const result = await connect({ baseUrl: `${base}/prefix/v1/` });
  const provider = db.getProvider(result.connection.providerId);
  assert.equal(result.created, true);
  assert.equal(provider.baseUrl, `${base}/prefix`);
  assert.equal(provider.protocol, protocol);
  assert.equal(provider.credentials.apiKey, apiKey);
  assert.ok(authorizations.has(provider.credentials.gatewayToken));
  assert.deepEqual(provider.models.map((model) => model.id), models.map((model) => model.id));
  assert.ok(provider.models.every((model) => model.capability === 'text' && model.mode === 'sync'));
  assert.equal(provider.models[0].supportsThinking, true);
  assert.deepEqual(provider.models[0].thinkingLevels, ['low', 'high']);
  assert.equal(provider.models[1].supportsThinking, null);
  const row = db.getDb().prepare('SELECT credentials_enc FROM providers WHERE id = ?').get(provider.id);
  assert.ok(row.credentials_enc && !row.credentials_enc.includes(apiKey) && !row.credentials_enc.includes(provider.credentials.gatewayToken));
  const exposed = JSON.stringify([result, listGatewayConnections(), db.listProviders({ maskCredentials: true })]);
  assert.ok(!exposed.includes(apiKey) && !exposed.includes(provider.credentials.gatewayToken));
  assert.equal(requests[0].url, '/prefix/api/integration/verify');
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].headers.cookie, undefined);
  assert.equal(requests[0].headers.authorization, undefined);
  assert.equal(requests[0].body.apiKey, apiKey);
  assert.equal(requests[0].body.label, 'Sakura AI Cut · 测试网关');
  assert.deepEqual(db.listModelRoutes(), []);
  const route = resolveRoute('text', [], [provider]);
  const generated = await route.adapter.chat(route.ctx, { model: models[0].id, messages: [{ role: 'user', content: '测试' }] });
  assert.equal(generated.text, '测试文本生成成功');
  assert.equal(requests.at(-1).url, '/prefix/v1/chat/completions');
});

test('重复接入同一网址与 Key 复用记录和授权，留空 Key 重新验证不清空凭据', async () => {
  const first = await connect();
  const duplicate = await connect({ baseUrl: `${base}/v1` });
  assert.equal(duplicate.connection.providerId, first.connection.providerId);
  assert.equal(duplicate.created, false);
  assert.equal(authorizations.size, 1);
  assert.equal(db.listProviders().length, 1);
  const savedToken = db.getProvider(first.connection.providerId).credentials.gatewayToken;
  assert.equal(requests[1].body.authorization, savedToken);
  await connect({ providerId: first.connection.providerId, apiKey: '', name: '重命名网关' });
  assert.equal(db.getProvider(first.connection.providerId).name, '重命名网关');
  assert.equal(db.getProvider(first.connection.providerId).credentials.gatewayToken, savedToken);
});

test('刷新只用接入令牌，模型按当前权限替换、保留本地参数与已有模型路由', async () => {
  const { connection } = await connect();
  const original = db.getProvider(connection.providerId);
  db.updateProvider(original.id, { enabled: false, models: [{ ...original.models[0], label: '自定义模型名称', defaultParams: { temperature: 0.3 }, enabled: false }, original.models[1]] });
  db.upsertModelRoute({ capability: 'text', providerId: original.id, modelId: original.models[1].id });
  const routes = db.listModelRoutes();
  models = [models[0], { id: 'new-text-model' }, models[0]];
  const result = await refreshGateway(original.id);
  assert.equal(result.created, false);
  assert.match(result.warning, /模型路由/);
  assert.equal(requests.at(-1).method, 'GET');
  assert.equal(requests.at(-1).headers.authorization, `Bearer ${original.credentials.gatewayToken}`);
  assert.equal(requests.at(-1).body.apiKey, undefined);
  const current = db.getProvider(original.id);
  assert.deepEqual(current.models.map((model) => model.id), ['group/story:latest', 'new-text-model']);
  assert.equal(current.models[0].label, '自定义模型名称');
  assert.deepEqual(current.models[0].defaultParams, { temperature: 0.3 });
  assert.equal(current.models[0].enabled, false);
  assert.equal(current.enabled, false);
  assert.deepEqual(db.listModelRoutes(), routes);
});

test('成功返回空模型会清空可用模型并明确提示，首次空权限也不会假称可生成', async () => {
  const { connection } = await connect();
  models = [];
  const refreshed = await refreshGateway(connection.providerId);
  assert.equal(refreshed.connection.modelCount, 0);
  assert.match(refreshed.warning, /没有可用模型/);
  assert.deepEqual(db.getProvider(connection.providerId).models, []);
  const empty = await connect({ apiKey: 'sk-local_test-new-key' });
  assert.equal(empty.connection.modelCount, 0);
  assert.match(empty.warning, /没有可用模型/);
});

test('错误 Key、停用与撤销不覆盖旧数据，也不降级到调用 Key；显式重新登记才创建新授权', async () => {
  const { connection } = await connect();
  const original = db.getProvider(connection.providerId);
  await assert.rejects(connect({ providerId: original.id, apiKey: 'wrong-secret-do-not-echo' }), (error) => {
    assert.match(error.message, /凭据无效/);
    assert.ok(!error.message.includes('wrong-secret-do-not-echo'));
    return true;
  });
  keyDisabled = true;
  await assert.rejects(refreshGateway(original.id), /凭据无效/);
  keyDisabled = false;
  cancelled = true;
  const count = requests.length;
  await assert.rejects(refreshGateway(original.id), /授权已取消/);
  assert.equal(requests.length, count + 1, '撤销后不能再用 Key 重试');
  await assert.rejects(connect({ providerId: original.id, apiKey: '' }), /授权已取消/);
  assert.deepEqual(db.getProvider(original.id), original);
  await connect({ providerId: original.id, apiKey: '', renewAuthorization: true });
  assert.equal(authorizations.size, 2);
  assert.equal(requests.at(-1).body.authorization, undefined);
  assert.equal(db.listProviders().length, 1);
});

test('已保存的凭据不能被转发到新网址，解析为内网的域名需显式允许', async () => {
  const { connection } = await connect();
  const count = requests.length;
  await assert.rejects(connect({ providerId: connection.providerId, baseUrl: `${base}/different`, apiKey: '' }), /不能更换/);
  await assert.rejects(connect({ baseUrl: base.replace('127.0.0.1', 'localhost'), allowPrivateNetwork: false }), /内网/);
  assert.equal(requests.length, count);
  await connect({ baseUrl: base.replace('127.0.0.1', 'localhost'), allowPrivateNetwork: true });
  assert.equal(requests.at(-1).headers.host, base.replace('http://127.0.0.1', 'localhost'));
});

test('格式错误、陌生服务、缺失令牌、外部端点都不写库', async () => {
  const payloads = [
    { ...config(), verified: false },
    { ...config(), gateway: { service: 'unrelated-service', version: '1' } },
    config(),
    { ...config(), authorization: { id: 'int_test', status: 'active', token: 'bad\nheader' } },
    { ...config(), endpoints: { [protocol]: { chat: 'https://other.example.test/chat', models: '/v1/models' } } },
    { ...config(), models: [{ id: 42 }] },
  ];
  for (const payload of payloads) {
    responder = (_request, response) => json(response, payload);
    await assert.rejects(connect());
    assert.equal(db.listProviders().length, 0);
  }
});

test('刷新绑定来源 Key；远端改绑不能让调用凭据与模型权限错配', async () => {
  const { connection } = await connect();
  const original = db.getProvider(connection.providerId);
  remoteKeyId = 'key_changed_elsewhere';
  await assert.rejects(refreshGateway(original.id), /调用 Key 已变化/);
  assert.deepEqual(db.getProvider(original.id), original);
  await connect({ providerId: original.id, apiKey: 'sk-local_test-new-key' });
  assert.equal(db.getProvider(original.id).credentials.apiKey, 'sk-local_test-new-key');
  assert.equal(db.getProvider(original.id).credentials.gatewayKeyId, remoteKeyId);
});

test('HTTP 错误分类不泄露正文，重定向不被跟随', async () => {
  for (const [status, message] of [[401, /凭据无效/], [403, /拒绝访问/], [404, /接入接口/], [405, /接入接口/], [429, /过于频繁/], [503, /503/], [307, /重定向/]]) {
    responder = (_request, response) => {
      response.writeHead(status, { 'Content-Type': 'application/json', Location: `${base}/secret-target` });
      response.end(JSON.stringify({ error: { message: apiKey } }));
    };
    const count = requests.length;
    await assert.rejects(connect(), (error) => {
      assert.match(error.message, message);
      assert.ok(!error.message.includes(apiKey));
      return true;
    });
    assert.equal(requests.length, count + 1);
    assert.equal(db.listProviders().length, 0);
  }
});

test('HTML、无效 JSON、声明或流式超大响应都被限制', async () => {
  const responses = [
    [() => ['text/html', '<html>login</html>'], /未返回 JSON/],
    [() => ['application/json', '{invalid'], /无效的 JSON/],
    [() => ['application/json', 'x'.repeat(1024 * 1024 + 1)], /响应过大/],
  ];
  for (const [content, expected] of responses) {
    responder = (_request, response) => {
      const [type, body] = content();
      response.writeHead(200, { 'Content-Type': type });
      response.write(body);
      response.end();
    };
    await assert.rejects(connect(), expected);
  }
  responder = (_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': 2 * 1024 * 1024 });
    response.write('{');
  };
  await assert.rejects(connect(), /响应过大/);
  assert.equal(db.listProviders().length, 0);
});

test('网络请求有超时，同一网关并发操作被拦截且失败后释放锁', async () => {
  responder = () => {};
  await assert.rejects(requestGatewayJson(base, '/api/integration/config', { token: 'test', allowPrivateNetwork: true, timeoutMs: 40 }), /超时/);
  let entered;
  let release;
  const started = new Promise((resolve) => { entered = resolve; });
  const held = new Promise((resolve) => { release = resolve; });
  responder = async (request, response, body) => {
    entered();
    await held;
    defaultResponder(request, response, body);
  };
  const first = connect();
  await started;
  try { await assert.rejects(connect(), /正在验证或同步/); }
  finally { release(); }
  await first;
  responder = defaultResponder;
  await connect();
  assert.equal(db.listProviders().length, 1);
});

test('同步事务失败回滚，不损坏已保存模型、令牌和路由', async () => {
  const { connection } = await connect();
  const original = db.getProvider(connection.providerId);
  db.getDb().exec("CREATE TRIGGER reject_gateway_update BEFORE UPDATE ON providers BEGIN SELECT RAISE(ABORT, 'test failure'); END;");
  models = [{ id: 'new-model' }];
  try { await assert.rejects(refreshGateway(original.id)); }
  finally { db.getDb().exec('DROP TRIGGER reject_gateway_update;'); }
  assert.deepEqual(db.getProvider(original.id), original);
});