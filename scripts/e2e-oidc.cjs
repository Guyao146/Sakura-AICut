// 端到端验证：Sakura OIDC 登录全流程
// 前置：Sakura-Auth-Server 跑在 9000，客户端 app-aicut-test1 已注册
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

const data = mkdtempSync(join(tmpdir(), 'sakura-oidc-e2e-'));
const DB_FILE = join(data, 'sakura.db');
process.env.SAKURA_DATA_DIR = data;
process.env.SAKURA_DB_FILE = DB_FILE;
const PORT = 3199;
const BASE = `http://127.0.0.1:${PORT}`;
const IDP = 'http://127.0.0.1:9000';
const CLIENT_ID = 'app-aicut-test1';
const CLIENT_REDIRECT = `http://localhost:${PORT}/api/auth/callback/sakura`;

const results = [];
function check(name, ok, extra) {
  results.push({ name, ok, extra });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`);
}

const logFile = join(tmpdir(), 'aicut-e2e-server.log');
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(PORT)], {
  cwd: join(process.cwd(), 'apps/web'),
  env: { ...process.env, SAKURA_DATA_DIR: data, SAKURA_DB_FILE: DB_FILE },
  stdio: ['ignore', 'ignore', 'pipe'],
});
const stderr = [];
server.stderr.on('data', (chunk) => {
  const text = chunk.toString();
  stderr.push(text);
  console.log('[server stderr]', text.trim().slice(0, 400));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let up = false;
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    try { await fetch(`${BASE}/login`); up = true; break; } catch {}
  }
  check('AICut 启动', up, up ? String(PORT) : stderr.slice(-2).join(''));
  if (!up) throw new Error('server not up');

  // 1) 未接入时 /api/auth/login/sakura 应 503
  const before = await fetch(`${BASE}/api/auth/login/sakura?from=/`, { redirect: 'manual' });
  check('未接入时 503', before.status === 503, `${before.status}`);

  // 2) 写入启用的 sakura 提供商（模拟设置页接入）
  const { createOidcProvider, getEnabledOidcProvider, getDb } = await import('../packages/db/src/index.ts');
  createOidcProvider({
    name: 'Sakura 账号',
    kind: 'sakura',
    issuer: IDP,
    clientId: CLIENT_ID,
    scope: 'openid profile email groups',
    enabled: true,
  });
  const provider = getEnabledOidcProvider('sakura');
  check('配置已写入', provider !== null && provider.clientId === CLIENT_ID, provider?.issuer ?? '');

  // 3) 登录页出现 Sakura 按钮
  const loginPage = await (await fetch(`${BASE}/login`)).text();
  check('登录页含 Sakura 按钮', loginPage.includes('/api/auth/login/sakura'), '');

  // 4) 发起授权
  const start = await fetch(`${BASE}/api/auth/login/sakura?from=/studio/x`, { redirect: 'manual' });
  check('发起授权 302', start.status === 307 || start.status === 302, `${start.status}`);
  const authorizeUrl = start.headers.get('location') ?? '';
  check('跳到 IDP authorize', authorizeUrl.startsWith(`${IDP}/authorize`), authorizeUrl.slice(0, 80));
  const authorizeParams = new URL(authorizeUrl).searchParams;
  check('带 client_id', authorizeParams.get('client_id') === CLIENT_ID, authorizeParams.get('client_id') ?? '');
  check('带 PKCE S256', authorizeParams.get('code_challenge_method') === 'S256' && (authorizeParams.get('code_challenge') ?? '').length === 43, '');
  check('带 redirect_uri', authorizeParams.get('redirect_uri') === CLIENT_REDIRECT, authorizeParams.get('redirect_uri') ?? '');
  const state = authorizeParams.get('state');
  check('带 state', (state ?? '').length > 0, '');

  // 5) 在 IDP 登录 admin（JSON API），拿会话 cookie
  const adminPassword = process.env.IDP_ADMIN_PASSWORD || 'admin123';
  const sessionRes = await fetch(`${IDP}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'JSON' },
    body: JSON.stringify({ username: 'admin', password: adminPassword }),
  });
  const idpCookie = sessionRes.headers.get('set-cookie')?.split(';')[0] ?? '';
  check('IDP 登录成功', sessionRes.ok, `${sessionRes.status}`);
  if (!sessionRes.ok) console.log('  IDP 登录响应:', await sessionRes.text());

  // 6) 带 IDP 会话访问 authorize，应直接带 code 回调（require_consent=0）
  const authorizeRes = await fetch(authorizeUrl, {
    headers: idpCookie ? { cookie: idpCookie } : {},
    redirect: 'manual',
  });
  const callbackLocation = authorizeRes.headers.get('location') ?? '';
  let code = null;
  if ((authorizeRes.status === 302 || authorizeRes.status === 307) && callbackLocation.includes('/api/auth/callback/')) {
    code = new URL(callbackLocation, BASE).searchParams.get('code');
    check('IDP 回调带 code', Boolean(code), `${authorizeRes.status}`);
  } else {
    check('IDP 回调带 code', false, `status=${authorizeRes.status} loc=${callbackLocation.slice(0, 120)}`);
    console.log('  authorize 响应体:', (await authorizeRes.text()).slice(0, 300));
  }

  if (code) {
    // 7) 命中 AICut 回调：换码 → userinfo → 签 cookie → 跳回 from
    const callbackRes = await fetch(`${BASE}/api/auth/callback/sakura?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`, { redirect: 'manual' });
    const setCookie = callbackRes.headers.get('set-cookie') ?? '';
    const hasSession = setCookie.includes('sakura_session');
    check('回调换码签发会话', hasSession, `status=${callbackRes.status} loc=${callbackRes.headers.get('location') ?? ''}`);
    check('回调跳回业务页', (callbackRes.headers.get('location') ?? '').includes('/studio/x'), callbackRes.headers.get('location') ?? '');

    if (hasSession) {
      const cookie = setCookie.split(';')[0];
      const authed = await fetch(`${BASE}/`, { headers: { cookie } });
      check('登录后根路径 200', authed.status === 200, `${authed.status}`);
      const authedApi = await fetch(`${BASE}/api/jobs`, { headers: { cookie } });
      check('登录后 API 可用', authedApi.status === 200, `${authedApi.status}`);
      // 会话记录入库
      const { createHash } = require('node:crypto');
      const token = cookie.split('=')[1];
      const digest = createHash('sha256').update(token).digest('hex');
      const row = getDb().prepare('SELECT digest FROM sessions WHERE digest = ? AND revoked_at IS NULL').get(digest);
      check('会话已记录', Boolean(row), digest.slice(0, 12));
    }
  }

  // 8) 错误 state 被拒
  const bad = await fetch(`${BASE}/api/auth/callback/sakura?code=x&state=garbage`, { redirect: 'manual' });
  check('错误 state 跳登录页带错误', (bad.headers.get('location') ?? '').includes('/login?error='), `${bad.status}`);

  // 9) 未登录仍被守卫拦截（接入第三方后守卫不能松动）
  const still = await fetch(`${BASE}/settings`, { redirect: 'manual' });
  check('未登录仍被守卫拦截', still.status === 307, `${still.status}`);
})().catch((error) => {
  console.error('异常：', error);
  results.push({ name: '未捕获异常', ok: false, extra: String(error) });
}).finally(() => {
  server.kill('SIGKILL');
  try { rmSync(data, { recursive: true, force: true }); } catch {}
  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== ${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) {
    console.log('失败：', failed.map((r) => r.name).join(', '));
    process.exitCode = 1;
  }
});

