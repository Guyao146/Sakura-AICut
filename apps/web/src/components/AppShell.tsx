import Link from 'next/link';
import type { ReactNode } from 'react';
import { LogoutButton } from './LogoutButton';

/**
 * 应用外壳：极简顶栏（左上角品牌 logo，右上角全局设置与注销）。
 * 项目入口在首页项目库首格承载，外壳不再承担页面跳转。
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
          <div className="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto">
            <Link href="/settings" className="flex items-center gap-2 rounded-lg border border-[#242a36] px-3 py-2 text-[12px] text-slate-400 transition-colors hover:border-pink-400/40 hover:text-pink-200">
              <span aria-hidden="true">⚙</span>全局设置
            </Link>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main id="page-content" tabIndex={-1} className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
