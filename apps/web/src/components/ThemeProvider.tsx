'use client';

import { useEffect, useState, type MouseEvent } from 'react';

/**
 * 主题系统：四套预设通过覆盖 CSS 变量（--color-pink-* / --color-sakura-* / --color-ink-*）
 * 让全部 Tailwind 工具类自动重染。选择存于 localStorage，根布局内联脚本在首帧前应用，
 * 避免刷新闪烁。切换动画用 View Transitions API 做以点击位置为圆心的整页圆形扩散。
 */

export const THEME_STORAGE_KEY = 'sakura-theme';

export type ThemeId = 'sakura' | 'mindmap' | 'aurora' | 'sunset';

export interface ThemePreset {
  id: ThemeId;
  name: string;
  desc: string;
  /** 色板预览：[底色, 强调色] */
  swatch: [surface: string, accent: string];
}

export const THEMES: ThemePreset[] = [
  { id: 'sakura', name: '樱花', desc: '默认 · 粉霞强调色', swatch: ['#12151c', '#f472b6'] },
  { id: 'mindmap', name: '脑图夜空', desc: '深蓝底 · 青蓝强调色', swatch: ['#0e1424', '#38bdf8'] },
  { id: 'aurora', name: '极光', desc: '墨绿底 · 青碧强调色', swatch: ['#0d1a16', '#2dd4bf'] },
  { id: 'sunset', name: '暮霭', desc: '暖褐底 · 橙红强调色', swatch: ['#1a1110', '#fb923c'] },
];

export const DEFAULT_THEME: ThemeId = 'sakura';

type ViewTransitionLike = { finished: Promise<void> };
type StartViewTransition = ((callback: () => void) => ViewTransitionLike) | undefined;

export function currentTheme(): ThemeId {
  const attr = document.documentElement.dataset.theme;
  return (THEMES.find((theme) => theme.id === attr) ?? THEMES[0]!).id;
}

/**
 * 应用主题。animate 时以点击坐标为圆心做整页圆形扩散过渡；
 * 不支持 View Transitions 或用户关闭动效时直接切换。默认主题移除属性以回到 :root。
 */
export function applyTheme(theme: ThemeId, options: { animate?: boolean; x?: number; y?: number } = {}) {
  const root = document.documentElement;
  const next = THEMES.some((item) => item.id === theme) ? theme : DEFAULT_THEME;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // 无 localStorage 的环境（隐私模式等）只做会话内切换
  }
  const apply = () => {
    if (next === DEFAULT_THEME) delete root.dataset.theme;
    else root.dataset.theme = next;
  };
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const startViewTransition = (document as unknown as { startViewTransition?: StartViewTransition }).startViewTransition;
  if (options.animate && !reduceMotion && startViewTransition) {
    root.style.setProperty('--burst-x', `${options.x ?? root.clientWidth / 2}px`);
    root.style.setProperty('--burst-y', `${options.y ?? root.clientHeight / 2}px`);
    root.dataset.themeAnimating = '1';
    let finished = false;
    const cleanup = () => {
      if (finished) return;
      finished = true;
      delete root.dataset.themeAnimating;
      root.style.removeProperty('--burst-x');
      root.style.removeProperty('--burst-y');
    };
    try {
      const transition = startViewTransition.call(document, apply);
      transition.finished.then(cleanup, cleanup);
      setTimeout(cleanup, 3000);
    } catch {
      cleanup();
      apply();
    }
  } else {
    apply();
  }
}

/**
 * 当前主题与切换方法。主题在挂载后读取（SSR 与首屏一律按默认渲染，由根布局脚本提前应用），
 * 避免服务端/客户端渲染不一致；跨标签页修改通过 storage 事件同步。
 */
export function useCurrentTheme(): {
  theme: ThemeId | null;
  choose: (theme: ThemeId, event?: MouseEvent) => void;
} {
  const [theme, setTheme] = useState<ThemeId | null>(null);
  useEffect(() => {
    const sync = () => setTheme(currentTheme());
    sync();
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const choose = (next: ThemeId, event?: MouseEvent) => {
    applyTheme(next, { animate: true, x: event?.clientX, y: event?.clientY });
    setTheme(next);
  };
  return { theme, choose };
}
