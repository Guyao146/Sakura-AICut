import Link from 'next/link';
import type { ReactNode } from 'react';
import { LogoutButton } from './LogoutButton';

/**
 * 应用外壳：顶部看板磁贴式主导航（项目空间 / 全局设置）
 */
const NAV = [
  { href: '/', label: '项目空间', icon: '▦', desc: '项目库 · 五步工作台入口' },
  { href: '/settings', label: '全局设置', icon: '⚙', desc: '接入 · 模型路由 · 偏好' },
];

export function AppShell({ children, active }: { children: ReactNode; active?: string }) {
  return (
    <div className="app-shell min-h-dvh">
      <a href="#page-content" className="skip-link">跳到主要内容</a>
      <header className="app-topbar sticky top-0 z-40 border-b border-ink-600 bg-ink-900/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <Link href="/" className="flex shrink-0 items-center gap-2.5 rounded-lg">
            <span className="brand-mark flex size-9 shrink-0 items-center justify-center rounded-xl bg-sakura-500/10 text-lg" aria-hidden="true">🌸</span>
            <span className="text-sm font-semibold tracking-wide text-slate-100">Sakura AI Cut</span>
          </Link>
          <nav aria-label="主导航" className="flex min-w-0 flex-1 flex-wrap gap-2">
            {NAV.map((item) => {
              const isActive =
                (item.href === '/' && (active === 'projects' || !active)) ||
                (item.href === '/settings' && active === 'settings');
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={`nav-link kanban-tile flex min-w-0 flex-1 items-center gap-3 rounded-xl border px-3.5 py-2.5 ${
                    isActive ? 'border-sakura-500/30 bg-sakura-500/10 text-pink-200' : 'border-ink-600 bg-ink-800/60 text-slate-300 hover:border-pink-400/30 hover:bg-white/5 hover:text-slate-100'
                  }`}
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/5 text-base" aria-hidden="true">{item.icon}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium">{item.label}</span>
                    <span className="mt-0.5 block truncate text-[10px] text-slate-500">{item.desc}</span>
                  </span>
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto w-full sm:w-auto md:shrink-0"><LogoutButton /></div>
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
