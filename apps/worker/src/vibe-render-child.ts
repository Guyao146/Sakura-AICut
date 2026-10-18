import { chromium } from 'playwright';
import type { Browser } from 'playwright';
import type { VibeProtocolMeta } from '@sakura/core';
import { buildVibeDocument, vibeMetaSchema } from '@sakura/core';
import { encodeVibeFrames } from './vibe-encode';

/** 独立渲染子进程：不加载数据库，不接收应用密钥，不开放网络。 */
interface RenderInput { code: string; meta: VibeProtocolMeta; outputPath: string; ffmpegPath: string }

process.once('message', async (input: RenderInput) => {
  let browser: Browser | undefined;
  const progress = (percent: number, stage: string) => process.send?.({ type: 'progress', percent, stage });
  try {
    const meta = vibeMetaSchema.parse(input.meta);
    const document = buildVibeDocument(input.code, meta);
    progress(2, '启动隔离浏览器');
    browser = await chromium.launch({
      headless: true, chromiumSandbox: true, timeout: 20_000,
      args: ['--disable-dev-shm-usage', '--hide-scrollbars', '--disable-background-networking',
        '--host-resolver-rules=MAP * ~NOTFOUND', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
    });
    const processSession = await browser.newBrowserCDPSession();
    const { processInfo } = await processSession.send('SystemInfo.getProcessInfo');
    const browserPid = processInfo.find((entry) => entry.type === 'browser')?.id;
    if (!browserPid) throw new Error('无法跟踪隔离浏览器进程');
    process.send?.({ type: 'browser', pid: browserPid });
    await processSession.detach();
    const context = await browser.newContext({
      viewport: { width: meta.width, height: meta.height }, deviceScaleFactor: 1,
      offline: true, serviceWorkers: 'block', acceptDownloads: false, permissions: [],
    });
    await context.route('**/*', (route) => route.abort('blockedbyclient'));
    await context.routeWebSocket('**/*', (socket) => socket.close());
    const page = await context.newPage();
    let pageError: string | null = null;
    context.on('page', (popup) => { if (popup !== page) void popup.close().catch(() => {}); });
    page.on('dialog', (dialog) => void dialog.dismiss().catch(() => {}));
    page.on('pageerror', (error) => { pageError = error.message.slice(0, 300); });
    await page.clock.install({ time: 0 });
    await page.clock.pauseAt(0);
    progress(6, '加载动画与校验帧协议');
    const srcdoc = document.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const shell = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="frame-src 'none'; base-uri 'none'"><style>html,body{margin:0;overflow:hidden}iframe{border:0;width:100vw;height:100vh;display:block}</style></head><body><iframe name="vibe" sandbox="allow-scripts" srcdoc="${srcdoc}"></iframe></body></html>`;
    await page.setContent(shell, { waitUntil: 'load', timeout: 15_000 });
    if (pageError) throw new Error(`动画脚本错误：${pageError}`);
    const frame = page.frame({ name: 'vibe' });
    if (!frame) throw new Error('隔离动画页面未加载');
    const actual = vibeMetaSchema.parse(await frame.evaluate('window.__vibeMeta'));
    if ((Object.keys(meta) as Array<keyof VibeProtocolMeta>).some((key) => Math.abs(actual[key] - meta[key]) > 1e-6)) {
      throw new Error('页面元信息与项目脚本不一致');
    }
    await frame.evaluate(`(() => { if (typeof window.__vibeSeek !== 'function') throw new Error('缺少寻帧函数'); })()`);
    await frame.evaluate('document.fonts.ready');
    await encodeVibeFrames(page, frame, meta, input.outputPath, input.ffmpegPath, (percent, stage) => {
      if (pageError) throw new Error(`动画脚本错误：${pageError}`);
      progress(percent, stage);
    });
    await browser.close();
    browser = undefined;
    process.send?.({ type: 'done' });
  } catch (error) {
    process.send?.({ type: 'error', error: error instanceof Error ? error.message.slice(0, 1200) : '渲染失败' });
  } finally {
    if (browser) await browser.close().catch(() => {});
    process.disconnect?.();
  }
});
