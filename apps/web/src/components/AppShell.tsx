import Link from 'next/link';
import type { ReactNode } from 'react';
import { LogoutButton } from './LogoutButton';

/**
 * 应用外壳：极简顶栏（左上角品牌 logo，右侧注销）。
 * 主导航磁贴近在首页「看板」承载，外壳不再承担页面跳转。
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell min-h-dvh">
      <a href="#page-content" className="skip-link">跳到主要内容</a>
      <header className="app-topbar sticky top-0 z-40 border-b border-ink-600 bg-ink-900/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <Link href="/" aria-label="Sakura AI Cut 主页" className="flex shrink-0 items-center gap-2.5 rounded-lg">
            <span className="brand-mark flex size-8 shrink-0 items-center justify-center rounded-lg bg-sakura-500/10 text-base" aria-hidden="true">🌸</span>
            <span className="text-sm font-semibold tracking-wide text-slate-100">Sakura AI Cut</span>
          </Link>
          <div className="flex w-full shrink-0 items-center justify-end sm:w-auto"><LogoutButton /></div>
        </div>
      </header>
      <main id="page-content" tabIndex={-1} className="min-w-0 flex-1">{children}</main>
    </div>
  );
}

export function PageHeader({ title, subtitle, extra }: { title: string; subtitle?: string; extra?: ReactNode }) {
  return (
    <header className="page-header flex flex-wrap items-center justify-between gap-3 border-b border-ink-600 bg-ink-900/90 px-4 py-5 sm:px-6 lg:px-8">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight text-slate-100">{title}</h1>
        {subtitle ? <p className="mt-1 text-xs leading-5 text-slate-400">{subtitle}</p> : null}
      </div>
      {extra ? <div className="flex shrink-0 items-center gap-2">{extra}</div> : null}
    </header>
  );
}
