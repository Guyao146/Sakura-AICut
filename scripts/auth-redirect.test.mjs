import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const data = mkdtempSync(join(tmpdir(), 'sakura-auth-redirect-'));
const originalEnv = { APP_URL: process.env.APP_URL, SAKURA_DATA_DIR: process.env.SAKURA_DATA_DIR,
  SAKURA_DB_FILE: process.env.SAKURA_DB_FILE };
process.env.SAKURA_DATA_DIR = data;
process.env.SAKURA_DB_FILE = join(data, 'test.db');
const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url));
webRequire('next/dist/server/node-environment');
const { NextRequest } = webRequire('next/server');
const { createRequestStoreForAPI } = webRequire('next/dist/server/async-storage/request-store');
const { workAsyncStorage } = webRequire('next/dist/server/app-render/work-async-storage.external');
const { workUnitAsyncStorage } = webRequire('next/dist/server/app-render/work-unit-async-storage.external');
const db = webRequire('@sakura/db');
const { publicBaseUrl, publicUrl } = await import('../apps/web/src/lib/public-url.ts');
const { buildAuthorizeRequest } = await import('../apps/web/src/lib/server/oidc.ts');
const { SESSION_COOKIE, verifySessionToken } = await import('../apps/web/src/lib/session.ts');
const { proxy } = await import('../apps/web/src/proxy.ts');
const login = await import('../apps/web/src/app/api/auth/login/[kind]/route.ts');
const callback = await import('../apps/web/src/app/api/auth/callback/[kind]/route.ts');
const originalFetch = globalThis.fetch;
const context = () => ({ params: Promise.resolve({ kind: 'sakura' }) });
const headers = { host: 'cut.example.test', 'x-forwarded-proto': 'https', 'x-forwarded-host': 'cut.example.test' };

beforeEach(() => { delete process.env.APP_URL; globalThis.fetch = originalFetch; });
after(() => {
  globalThis.fetch = originalFetch;
  db.closeDb();
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('容器内登录守卫跳转到外部域名，保留返回路径', () => {
  const response = proxy(new NextRequest('https://0.0.0.0:3000/settings', { headers }));
  const location = new URL(response.headers.get('location'));
  assert.equal(location.origin, 'https://cut.example.test');
  assert.equal(location.pathname, '/login');
  assert.equal(location.searchParams.get('from'), '/settings');
});

test('OIDC 回调缺参和拒绝授权均返回外部登录页', async () => {
  for (const query of ['', '?error=access_denied']) {
    const response = await callback.GET(new NextRequest(`https://0.0.0.0:3000/api/auth/callback/sakura${query}`, { headers }), context());
    const location = new URL(response.headers.get('location'));
    assert.equal(location.origin, 'https://cut.example.test');
    assert.equal(location.pathname, '/login');
    assert.ok(location.searchParams.get('error'));
  }
});

test('OIDC 发起时无转发域名头，仍以 Host 生成外部回调地址', async () => {
  const provider = db.createOidcProvider({ name: 'Sakura', kind: 'sakura',
    issuer: 'https://auth.example.test', clientId: 'test-client' });
  globalThis.fetch = async () => new Response(JSON.stringify({
    authorization_endpoint: 'https://auth.example.test/authorize',
  }), { headers: { 'Content-Type': 'application/json' } });
  try {
    const response = await login.GET(new NextRequest('https://0.0.0.0:3000/api/auth/login/sakura', {
      headers: { host: 'cut.example.test', 'x-forwarded-proto': 'https' },
    }), context());
    const location = new URL(response.headers.get('location'));
    assert.equal(location.origin, 'https://auth.example.test');
    assert.equal(location.searchParams.get('redirect_uri'), 'https://cut.example.test/api/auth/callback/sakura');
  } finally { db.deleteOidcProvider(provider.id); }
});

test('OIDC 成功回调签发会话，并返回外部首页或原业务页', async () => {
  const provider = db.createOidcProvider({ name: 'Sakura', kind: 'sakura',
    issuer: 'https://auth.example.test', clientId: 'success-client' });
  let exchanges = 0;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    let body;
    if (path.endsWith('/.well-known/openid-configuration')) {
      body = { authorization_endpoint: 'https://auth.example.test/authorize',
        token_endpoint: 'https://auth.example.test/token', userinfo_endpoint: 'https://auth.example.test/userinfo' };
    } else if (path === '/token') {
      exchanges++;
      assert.equal(init.body.get('redirect_uri'), 'https://cut.example.test/api/auth/callback/sakura');
      assert.equal(init.body.get('client_id'), 'success-client');
      body = { access_token: 'test-access', expires_in: 3600 };
    } else {
      assert.equal(path, '/userinfo');
      assert.equal(init.headers.Authorization, 'Bearer test-access');
      body = { sub: 'test-user' };
    }
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    for (const from of ['/', '/settings?tab=login']) {
      const auth = await buildAuthorizeRequest('sakura', 'https://cut.example.test/api/auth/callback/sakura', from);
      const url = new URL('https://0.0.0.0:3000/api/auth/callback/sakura');
      url.searchParams.set('state', auth.state);
      url.searchParams.set('code', 'test-code');
      const request = new NextRequest(url, { headers });
      const store = createRequestStoreForAPI(request, { pathname: url.pathname, search: url.search },
        { tags: [], expirationsByCacheKind: new Map() }, undefined, undefined, undefined);
      const response = await workAsyncStorage.run({ route: url.pathname, isStaticGeneration: false }, () =>
        workUnitAsyncStorage.run(store, () => callback.GET(request, context())));
      assert.equal(response.headers.get('location'), `https://cut.example.test${from}`);
      assert.equal(verifySessionToken(store.mutableCookies.get(SESSION_COOKIE)?.value), true);
    }
    assert.equal(exchanges, 2);
  } finally { db.deleteOidcProvider(provider.id); }
});

test('显式 APP_URL 优先，转发头支持多级代理，本地开发可直接使用请求地址', () => {
  const request = new NextRequest('http://0.0.0.0:3000/', { headers });
  process.env.APP_URL = 'https://configured.example.test/';
  assert.equal(publicBaseUrl(request), 'https://configured.example.test');
  delete process.env.APP_URL;
  assert.equal(publicBaseUrl(new NextRequest(request.url, { headers: {
    'x-forwarded-host': 'cut.example.test, internal:3000', 'x-forwarded-proto': 'https, http',
  } })), 'https://cut.example.test');
  assert.equal(publicBaseUrl(new NextRequest('http://localhost:3000/')), 'http://localhost:3000');
});

test('拒绝以监听地址生成跳转，也拒绝跨站返回路径和无效配置', () => {
  const request = new NextRequest('http://0.0.0.0:3000/', { headers });
  assert.throws(() => publicBaseUrl(new NextRequest(request.url)));
  for (const path of ['//other.example.test/', '/\\other.example.test/', 'https://other.example.test/']) {
    assert.throws(() => publicUrl(path, request));
  }
  for (const value of ['http://0.0.0.0:3000', 'http://[::]:3000', 'https://cut.example.test/path',
    'https://user:password@cut.example.test', 'file:///tmp/site']) {
    process.env.APP_URL = value;
    assert.throws(() => publicBaseUrl(request));
  }
});