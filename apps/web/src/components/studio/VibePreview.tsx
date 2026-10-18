'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { buildVibeDocument, createId, vibeMetaSchema, type VibeProtocolMeta } from '@sakura/core';
import { Button } from '@/components/ui';

/** 不读取 iframe 的 Window 属性；只接收当前帧、当前令牌的消息。 */
export function VibePreview({ code, meta }: { code: string; meta: VibeProtocolMeta }) {
  const container = useRef<HTMLDivElement>(null);
  const iframe = useRef<HTMLIFrameElement>(null);
  const [width, setWidth] = useState(320);
  const [mounted, setMounted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const playingRef = useRef(playing);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  const token = useMemo(() => createId(24), [code, meta.durationSec, meta.width, meta.height, meta.fps]);
  const document = useMemo(() => {
    try { return { html: buildVibeDocument(code, meta, token), error: null }; }
    catch (cause) { return { html: '', error: cause instanceof Error ? cause.message : '动画代码无效' }; }
  }, [code, meta, token]);

  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => { setMounted(false); setPlaying(false); setReady(false); setError(null); setTime(0); }, [token]);

  useEffect(() => {
    if (!mounted) return;
    let waitingSince = 0;
    let currentTime = time;
    let requestId = 0;
    let initialized = false;
    const send = (value: number) => {
      waitingSince = performance.now();
      iframe.current?.contentWindow?.postMessage({ type: 'sakura:vibe:seek', token, time: value, requestId: ++requestId }, '*');
    };
    const listener = (event: MessageEvent) => {
      if (event.source !== iframe.current?.contentWindow || event.origin !== 'null' || event.data?.token !== token) return;
      const data = event.data;
      if (data.type === 'sakura:vibe:ready') {
        if (!vibeMetaSchema.safeParse(data.meta).success) return;
        initialized = true;
        setReady(true);
        send(currentTime);
      } else if (data.type === 'sakura:vibe:frame' && data.requestId === requestId) waitingSince = 0;
      else if (data.type === 'sakura:vibe:error') {
        setError(String(data.error).slice(0, 300)); setPlaying(false); setReady(false); setMounted(false);
      }
    };
    window.addEventListener('message', listener);
    const started = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      if ((!initialized && now - started > 10_000) || (waitingSince && now - waitingSince > 3000)) {
        setError('动画页面没有响应，预览已停止'); setPlaying(false); setMounted(false); return;
      }
      if (!initialized) iframe.current?.contentWindow?.postMessage({ type: 'sakura:vibe:hello', token }, '*');
      if (playingRef.current && initialized && !waitingSince) {
        currentTime = (currentTime + 1 / meta.fps) % meta.durationSec;
        setTime(currentTime);
        send(currentTime);
      }
    }, 1000 / meta.fps);
    return () => { window.removeEventListener('message', listener); clearInterval(timer); };
  }, [mounted, token, meta.durationSec, meta.fps]);

  const scale = Math.min(width / meta.width, 420 / meta.height);
  return (
    <div ref={container} className="space-y-2">
      <p className="text-[11px] leading-5 text-slate-400">代码在隔离页面中运行，禁止外部资源。点击后预览；可随时停止。</p>
      <div className="mx-auto overflow-hidden rounded-lg border border-ink-600 bg-black" style={{ width: meta.width * scale, height: meta.height * scale }}>
        {mounted && document.html ? <iframe ref={iframe} title="动画预览" srcDoc={document.html}
          sandbox="allow-scripts" referrerPolicy="no-referrer" allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'"
          style={{ width: meta.width, height: meta.height, transform: `scale(${scale})`, transformOrigin: 'top left', border: 0, pointerEvents: 'none' }} /> : null}
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={Boolean(document.error)} onClick={() => { setError(null); setMounted(!mounted); setPlaying(false); setReady(false); }}>
          {mounted ? '停止预览' : '启动隔离预览'}
        </Button>
        <Button size="sm" disabled={!ready || !mounted} onClick={() => setPlaying(!playing)}>{playing ? '暂停' : '播放'}</Button>
        <span className="text-[10px] text-slate-500">{time.toFixed(1)} / {meta.durationSec.toFixed(1)} 秒</span>
      </div>
      {error || document.error ? <p role="alert" className="text-xs text-red-300">{error || document.error}</p> : null}
    </div>
  );
}
