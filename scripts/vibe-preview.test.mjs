import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { buildVibeDocument } from '../packages/core/src/pipeline/vibe-document.ts';
import { testCode, testMeta } from './vibe-fixture.mjs';

const require = createRequire(new URL('../apps/worker/package.json', import.meta.url));
const { chromium } = require('playwright');
const live = process.env.VIBE_RENDER_LIVE === '1';
let browser;
let server;
let origin;
let requests = 0;
before(async () => {
  if (!live) return;
  server = createServer((request, response) => { requests += 1; response.end('unexpected'); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ chromiumSandbox: true });
});
after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

test('预览协议使用不透明来源和 postMessage；首尾帧不同且父页面不可访问', { skip: !live }, async () => {
  const page = await browser.newPage();
  await page.route('https://preview.example.test/', (route) => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
  await page.goto('https://preview.example.test/');
  const token = 'preview-session';
  const code = testCode.replace('window.__vibeSeek(0);', `try { parent.document.body.dataset.escaped = 'yes'; } catch {}\nwindow.__vibeSeek(0);`);
  await page.evaluate(({ document, token }) => {
    window.previewMessages = [];
    const iframe = window.document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.style.cssText = 'width:1024px;height:1024px;border:0';
    window.addEventListener('message', (event) => {
      if (event.source === iframe.contentWindow && event.origin === 'null' && event.data?.token === token) window.previewMessages.push(event.data);
    });
    iframe.srcdoc = document;
    window.document.body.appendChild(iframe);
  }, { document: buildVibeDocument(code, testMeta, token), token });
  await page.waitForFunction(() => window.previewMessages.some((m) => m.type === 'sakura:vibe:ready'));
  const frame = page.frames()[1];
  assert.ok(frame);
  await page.evaluate(() => document.querySelector('iframe').contentWindow.postMessage({ type: 'sakura:vibe:seek', token: 'preview-session', requestId: 1, time: 2 }, '*'));
  await page.waitForFunction(() => window.previewMessages.some((m) => m.type === 'sakura:vibe:frame' && m.requestId === 1));
  assert.equal(await frame.locator('#caption').textContent(), '相遇');
  assert.equal(await page.evaluate(() => document.body.dataset.escaped), undefined);
  await page.evaluate(() => document.querySelector('iframe').contentWindow.postMessage({ type: 'sakura:vibe:seek', token: 'invalid', requestId: 2, time: 0 }, '*'));
  assert.equal(await frame.locator('#caption').textContent(), '相遇');
  await page.close();
});

test('预览 CSP 阻断 fetch、图片和脚本外链，不能靠移除 meta 绕过', { skip: !live }, async () => {
  const page = await browser.newPage();
  const before = requests;
  const attempts = `
    document.querySelectorAll('meta').forEach(node => node.remove());
    fetch('${origin}/fetch').catch(() => {});
    var image = new Image(); image.src = '${origin}/image'; document.body.appendChild(image);
    var script = document.createElement('script'); script.src = '${origin}/script'; document.body.appendChild(script);
  `;
  const code = testCode.replace('window.__vibeSeek(0);', attempts + 'window.__vibeSeek(0);');
  await page.setContent(buildVibeDocument(code, testMeta));
  await page.waitForTimeout(300);
  assert.equal(requests, before);
  assert.equal(await page.locator('#caption').textContent(), '开始');
  await page.close();
});

test('父页面禁止框架导航但仍可加载 srcdoc 预览', { skip: !live }, async () => {
  const page = await browser.newPage();
  const seen = [];
  page.on('request', (request) => seen.push(request.url()));
  await page.route('https://preview.example.test/**', (route) => route.fulfill({
    headers: { 'Content-Security-Policy': "frame-src 'none'" },
    contentType: 'text/html', body: '<html><body></body></html>',
  }));
  await page.goto('https://preview.example.test/');
  await page.evaluate((html) => {
    const iframe = document.createElement('iframe');
    iframe.sandbox = 'allow-scripts';
    iframe.srcdoc = html;
    document.body.appendChild(iframe);
  }, buildVibeDocument(testCode, testMeta));
  const frame = page.frames()[1];
  await frame.locator('#caption').waitFor();
  await frame.evaluate(() => { window.location.href = 'https://preview.example.test/api/jobs'; });
  await page.waitForTimeout(200);
  assert.deepEqual(seen, ['https://preview.example.test/']);
  await page.close();
});
