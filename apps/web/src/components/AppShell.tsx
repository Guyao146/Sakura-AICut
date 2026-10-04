import Link from 'next/link';
import type { ReactNode } from 'react';
import { LogoutButton } from './LogoutButton';

/**
 * 应用外壳：左侧主导航
 */
const NAV = [
  { href: '/', label: '项目空间', icon: '▦' },
  { href: '/settings', label: '全局设置', icon: '⚙' },
];

export function AppShell({ children, active }: { children: ReactNode; active?: string }) {
  return (
    <div className="app-shell min-h-dvh md:flex">
      <a href="#page-content" className="skip-link">跳到主要内容</a>
      <aside className="app-sidebar border-b border-ink-600 bg-[#0e1116] px-4 py-3 md:sticky md:top-0 md:flex md:h-dvh md:w-48 md:shrink-0 md:flex-col md:border-r md:border-b-0 md:px-3 md:py-6 xl:w-56">
        <div className="flex items-center justify-between gap-3 md:block">
          <Link href="/" className="flex items-center gap-2.5 rounded-lg md:mb-8 md:px-2">
            <span className="brand-mark flex size-9 shrink-0 items-center justify-center rounded-xl bg-sakura-500/10 text-lg" aria-hidden="true">🌸</span>
            <span className="text-sm font-semibold tracking-wide text-slate-100">Sakura AI Cut</span>
          </Link>
          <div className="md:hidden"><LogoutButton /></div>
        </div>
        <nav aria-label="主导航" className="mt-4 flex gap-1.5 md:mt-0 md:flex-1 md:flex-col">
          {NAV.map((item) => {
            const isActive =
              (item.href === '/' && (active === 'projects' || !active)) ||
              (item.href === '/settings' && active === 'settings');
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={`nav-link flex flex-1 items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] transition-colors md:flex-none ${
                  isActive ? 'bg-sakura-500/10 text-pink-200 ring-1 ring-inset ring-sakura-500/20' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                }`}
              >
                <span>{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="hidden md:block">
          <div className="mb-4 rounded-xl border border-ink-600 bg-ink-800 p-3 text-[11px] leading-6 text-slate-400">
            <p className="mb-1 font-medium text-slate-200">从灵感到成片</p>
            设定 → 剧本 → 资产<br />分镜 → 剪辑
          </div>
          <LogoutButton />
        </div>
      </aside>
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
