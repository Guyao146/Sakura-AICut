import type { VibeProtocolMeta } from '../types/project';
import { assertProtocolStub, vibeMetaSchema } from './vibe';

export const VIBE_CONTENT_POLICY = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; media-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

function inlineJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** 固定 CSP 先于生成代码生效；只用不透明来源 iframe，不开放同源权限。 */
export function buildVibeDocument(code: string, input: VibeProtocolMeta, token = ''): string {
  assertProtocolStub(code);
  const meta = vibeMetaSchema.parse(input);
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${VIBE_CONTENT_POLICY}"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#000}</style></head><body><script>
(() => {
  const expected = ${inlineJson(meta)};
  const token = ${inlineJson(token)};
  let ready = false;
  const send = (type, data = {}) => parent.postMessage({ type, token, ...data }, '*');
  Object.defineProperty(window, 'RTCPeerConnection', { value: undefined, writable: false, configurable: false });
  const fail = (error) => send('sakura:vibe:error', { error: String(error && error.message || error).slice(0, 300) });
  window.addEventListener('error', (event) => fail(event.error || event.message));
  const applyFrame = (t) => {
    if (!Number.isFinite(t) || t < 0 || t > expected.durationSec) throw new Error('预览时间超出范围');
    if (typeof window.__vibeSeek !== 'function') throw new Error('缺少寻帧函数');
    const result = window.__vibeSeek(t);
    if (result && typeof result.then === 'function') throw new Error('寻帧函数必须同步完成');
    for (const animation of document.getAnimations()) animation.pause();
  };
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== parent || !data || data.token !== token) return;
    if (data.type === 'sakura:vibe:hello') { if (ready) send('sakura:vibe:ready', { meta: expected }); return; }
    if (data.type !== 'sakura:vibe:seek') return;
    try {
      applyFrame(data.time);
      send('sakura:vibe:frame', { requestId: data.requestId });
    } catch (error) { fail(error); }
  });
  try {
    const doc = new DOMParser().parseFromString(${inlineJson(code)}, 'text/html');
    const scripts = [];
    for (const node of doc.querySelectorAll('script')) {
      if (node.hasAttribute('src') || (node.type && node.type !== 'text/javascript')) throw new Error('仅支持内联同步脚本');
      scripts.push(node.textContent || '');
      node.remove();
    }
    for (const node of doc.querySelectorAll('meta,base,link,iframe,frame,frameset,object,embed,form')) node.remove();
    for (const source of [doc.head, doc.body]) {
      const target = source === doc.head ? document.head : document.body;
      if (source === doc.body) for (const attr of source.attributes) {
        if (!attr.name.toLowerCase().startsWith('on')) target.setAttribute(attr.name, attr.value);
      }
      for (const node of Array.from(source.childNodes)) target.appendChild(document.importNode(node, true));
    }
    for (const source of scripts) {
      const script = document.createElement('script');
      script.textContent = source;
      document.body.appendChild(script);
    }
    const actual = window.__vibeMeta;
    if (!actual || Object.keys(expected).some((key) => !Number.isFinite(actual[key]) || Math.abs(actual[key] - expected[key]) > 0.000001)) {
      throw new Error('页面元信息与脚本画幅、时长、帧率不一致');
    }
    applyFrame(0);
    ready = true;
    send('sakura:vibe:ready', { meta: expected });
  } catch (error) { fail(error); }
})();
</script></body></html>`;
}
