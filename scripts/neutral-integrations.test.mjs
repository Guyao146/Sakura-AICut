import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkRepository, scanText, validatePolicy } from './check-brands.mjs';

const data = mkdtempSync(join(tmpdir(), 'sakura-neutral-test-'));
process.env.SAKURA_DATA_DIR = data;
process.env.SAKURA_DB_FILE = join(data, 'test.db');
const db = await import('../packages/db/src/index.ts');
const { PROVIDER_PRESETS, PROTOCOL_LABELS } = await import('../packages/core/src/index.ts');
const { getAdapter, SUPPORTED_PROTOCOLS } = await import('../packages/core/src/ai/registry.ts');
const { fileTasksAdapter } = await import('../packages/core/src/ai/adapters/file-tasks.ts');
const oidc = await import('../apps/web/src/lib/server/oidc.ts');
const policy = validatePolicy(JSON.parse(readFileSync(new URL('brand-policy.json', import.meta.url), 'utf8')));
const originalFetch = globalThis.fetch;
const json = (body) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
after(() => {
  globalThis.fetch = originalFetch;
  db.closeDb();
  try { rmSync(data, { recursive: true, force: true }); } catch { /* 其它模块连接在进程结束时释放 */ }
});

test('所有旧协议仍注册，中性模板没有预填厂商网址或模型推荐', () => {
  assert.equal(SUPPORTED_PROTOCOLS.length, 7);
  assert.equal(new Set(PROVIDER_PRESETS.map((preset) => preset.protocol)).size, 7);
  for (const preset of PROVIDER_PRESETS) {
    const adapter = getAdapter(preset.protocol);
    assert.equal(adapter.protocol, preset.protocol);
    assert.equal(preset.baseUrl, '');
    assert.equal(preset.docsUrl, '');
    assert.deepEqual(preset.defaultModels, []);
    for (const text of [preset.key, preset.label, preset.description, adapter.label, PROTOCOL_LABELS[preset.protocol]]) {
      assert.deepEqual(scanText('display.txt', text, policy), [], text);
    }
    assert.equal(typeof adapter.probe, 'function');
    assert.equal(typeof adapter.image, 'function');
  }
});

test('七种适配器的连通性探测仍能调用预期协议路径', async () => {
  const expectedPaths = {
    compatible: '/v1/models',
    'content-tasks': '/api/v3/models',
    'signed-media': '/v1/videos/text2video/probe-connection',
    'file-tasks': '/v1/text/chatcompletion_v2',
    'service-tasks': '/compatible-mode/v1/models',
    messages: '/v1/messages',
    'content-generation': '/v1beta/models/',
  };
  for (const preset of PROVIDER_PRESETS) {
    const requests = [];
    globalThis.fetch = async (url, init = {}) => {
      assert.equal(new URL(url).origin, 'https://models.example.test');
      requests.push({ url: new URL(url), init });
      return json({ data: [{ id: 'test-model' }], content: [], candidates: [], base_resp: { status_code: 0 } });
    };
    const result = await getAdapter(preset.protocol).probe({
      providerId: 'test', providerName: '测试接口', baseUrl: 'https://models.example.test',
      credentials: { apiKey: 'test-key', accessKey: 'test-access', secretKey: 'test-secret' }, timeoutSec: 30,
    });
    assert.equal(result.ok, true, `${preset.key}: ${result.message}`);
    assert.ok(requests.length);
    assert.ok(requests[0].url.pathname.startsWith(expectedPaths[preset.key]), preset.key);
  }
  globalThis.fetch = originalFetch;
});


test('文件任务接口的语音合成按 T2A 协议组装请求并解析 hex 音频', async () => {
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: new URL(url), init });
    return json({
      base_resp: { status_code: 0 },
      data: { audio: '00112233ff' },
      extra_info: { audio_length: 1500 },
    });
  };
  const result = await fileTasksAdapter.audio(
    {
      providerId: 'test', providerName: '测试接口', baseUrl: 'https://models.example.test',
      credentials: { apiKey: 'test-key', groupId: 'group-1' }, timeoutSec: 30,
    },
    { model: 'speech-02-hd', input: '你好，世界', voice: 'male-qn-qingse', language: 'zh-CN', speed: 1.1, format: 'mp3' },
  );
  globalThis.fetch = originalFetch;
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url.pathname, '/v1/t2a_v2');
  assert.equal(requests[0].url.searchParams.get('GroupId'), 'group-1');
  assert.equal(requests[0].init.headers.Authorization, 'Bearer test-key');
  const body = JSON.parse(requests[0].init.body);
  assert.equal(body.model, 'speech-02-hd');
  assert.equal(body.text, '你好，世界');
  assert.equal(body.stream, false);
  assert.equal(body.output_format, 'hex');
  assert.equal(body.voice_setting.voice_id, 'male-qn-qingse');
  assert.equal(body.voice_setting.speed, 1.1);
  assert.equal(body.audio_setting.format, 'mp3');
  assert.equal(body.audio_setting.channel, 1);
  assert.equal(body.language_boost, 'Chinese');
  assert.ok(result.b64.startsWith('data:audio/mp3;base64,'));
  assert.equal(result.durationSec, 1.5);
  assert.equal(result.format, 'mp3');
});
test('文件任务语音保留嵌套音色参数、拒绝损坏音频并报告远端错误', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  let body;
  let payload = { base_resp: { status_code: 0 }, data: { audio: 'abcd' } };
  const ctx = { providerId: 'test', providerName: '测试接口', baseUrl: 'https://models.example.test',
    credentials: { apiKey: 'test-key' }, timeoutSec: 30,
    fetchImpl: async (_url, init) => { body = JSON.parse(init.body); return json(payload); } };
  const request = { model: 'test-speech', input: '测试', format: 'wav', volume: 0.8, pitch: -2,
    params: { voice_setting: { voice_id: 'saved-voice', emotion: 'calm' }, audio_setting: { channel: 2 },
      stream: true, output_format: 'url', model: 'wrong', text: 'wrong' } };
  globalThis.fetch = ctx.fetchImpl;
  const result = await fileTasksAdapter.audio(ctx, request);
  assert.equal(body.voice_setting.voice_id, 'saved-voice');
  assert.equal(body.voice_setting.emotion, 'calm');
  assert.equal(body.voice_setting.vol, 0.8);
  assert.equal(body.voice_setting.pitch, -2);
  assert.equal(body.audio_setting.channel, 2);
  assert.equal(body.audio_setting.format, 'wav');
  assert.equal(body.model, request.model);
  assert.equal(body.text, request.input);
  assert.equal(body.stream, false);
  assert.equal(body.output_format, 'hex');
  assert.equal(result.b64, 'data:audio/wav;base64,q80=');
  for (const audio of ['', '0', 'aaZZ', 'https-invalid']) {
    payload = { data: { audio } };
    await assert.rejects(() => fileTasksAdapter.audio(ctx, request), /音频/);
  }
  payload = { base_resp: { status_code: 1004, status_msg: 'invalid credentials' } };
  await assert.rejects(() => fileTasksAdapter.audio(ctx, request), /1004.*invalid credentials/);
  await assert.rejects(() => fileTasksAdapter.audio(ctx, { ...request, speed: 3 }), /0.5–2/);
  payload = { data: { audio: 'https://audio.example.test/clip.wav' }, extra_info: { audio_length: 2000 } };
  assert.equal((await fileTasksAdapter.audio(ctx, request)).durationSec, 2);
});

test('文件任务音色查询合并系统及自定义音色并去重', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const ctx = { providerId: 'test', providerName: '测试接口', baseUrl: 'https://models.example.test',
    credentials: { apiKey: 'test-key', groupId: 'test-group' }, timeoutSec: 30,
    fetchImpl: async (url, init) => {
      assert.equal(new URL(url).pathname, '/v1/get_voice');
      assert.equal(new URL(url).searchParams.get('GroupId'), 'test-group');
      assert.equal(init.headers.Authorization, 'Bearer test-key');
      assert.deepEqual(JSON.parse(init.body), { voice_type: 'all' });
      return json({ system_voice: [{ voice_id: 'system-1', voice_name: '沉稳', description: ['清晰'] }],
        voice_cloning: [{ voice_id: 'custom-1' }], voice_generation: [{ voice_id: 'custom-1' }, {}] });
    } };
  globalThis.fetch = ctx.fetchImpl;
  const voices = await fileTasksAdapter.listVoices(ctx);
  assert.deepEqual(voices.map((voice) => voice.id), ['system-1', 'custom-1']);
  assert.equal(voices[0].description, '清晰');
});

test('Sakura 与通用 OIDC 共用发现、PKCE、令牌与用户信息流程', async () => {
  const kinds = Object.keys(db.OIDC_PRESETS);
  assert.equal(kinds.length, 2);
  for (const kind of kinds) {
    const provider = db.createOidcProvider({
      name: db.OIDC_PRESETS[kind].label, kind, issuer: `https://auth.example.test/${kind}`,
      clientId: `test-${kind}`, clientSecret: 'test-secret',
    });
    const seen = [];
    globalThis.fetch = async (url, init = {}) => {
      const parsed = new URL(url);
      assert.equal(parsed.origin, 'https://auth.example.test');
      seen.push({ parsed, init });
      if (parsed.pathname.endsWith('/.well-known/openid-configuration')) return json({
        authorization_endpoint: `${provider.issuer}/authorize`, token_endpoint: `${provider.issuer}/token`,
        userinfo_endpoint: `${provider.issuer}/userinfo`,
      });
      if (parsed.pathname.endsWith('/token')) {
        assert.equal(init.body.get('client_id'), provider.clientId);
        assert.equal(init.body.get('client_secret'), 'test-secret');
        assert.equal(init.body.get('redirect_uri'), oidc.buildRedirectUri(kind, 'https://cut.example.test'));
        return json({ access_token: 'test-access', expires_in: 3600 });
      }
      assert.ok(parsed.pathname.endsWith('/userinfo'));
      assert.equal(init.headers.Authorization, 'Bearer test-access');
      return json({ sub: 'test-subject', name: '测试用户' });
    };
    const redirect = oidc.buildRedirectUri(kind, 'https://cut.example.test/');
    assert.equal(redirect, `https://cut.example.test/api/auth/callback/${kind}`);
    const auth = await oidc.buildAuthorizeRequest(kind, redirect, '/settings');
    const authorizeUrl = new URL(auth.authorizeUrl);
    assert.equal(authorizeUrl.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(authorizeUrl.searchParams.get('redirect_uri'), redirect);
    const state = oidc.parseState(auth.state);
    assert.equal(state.from, '/settings');
    const token = await oidc.exchangeCode(kind, 'test-code', state.verifier, redirect);
    assert.equal((await oidc.fetchUserInfo(kind, token.accessToken)).sub, 'test-subject');
    assert.equal(seen.length, 3);
    db.deleteOidcProvider(provider.id);
  }
  globalThis.fetch = originalFetch;
});

test('旧默认登录文案中性化，但自定义名称和已注册的类型不被破坏', () => {
  const kind = Object.keys(db.OIDC_PRESETS).find((key) => key !== 'sakura');
  const provider = db.createOidcProvider({ name: kind, label: kind.toUpperCase(), kind,
    issuer: 'https://auth.example.test', clientId: 'test' });
  assert.equal(provider.name, '通用 OIDC');
  assert.equal(provider.label, '通用 OIDC');
  assert.equal(provider.kind, kind);
  db.updateOidcProvider(provider.id, { name: '内部账号', label: '企业登录' });
  const current = db.getOidcProvider(provider.id);
  assert.equal(current.name, '内部账号');
  assert.equal(current.label, '企业登录');
  db.deleteOidcProvider(provider.id);
});

test('仓库品牌检查与接入测试同步通过', () => {
  assert.deepEqual(checkRepository().hits, []);
});
