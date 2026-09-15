import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * 应用外壳：左侧主导航
 */
const NAV = [
  { href: '/', label: '项目', icon: '🎬' },
  { href: '/settings', label: '设置', icon: '⚙️' },
];

export function AppShell({ children, active }: { children: ReactNode; active?: string }) {
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-52 shrink-0 flex-col border-r border-[#1c2129] bg-[#0e1116] px-3 py-4">
        <Link href="/" className="mb-6 flex items-center gap-2 px-2">
          <span className="text-lg">🌸</span>
          <span className="text-sm font-semibold tracking-wide text-slate-100">Sakura AI Cut</span>
        </Link>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map((item) => {
            const isActive =
              (item.href === '/' && (active === 'projects' || !active)) ||
              (item.href === '/settings' && active === 'settings');
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] transition-colors ${
                  isActive ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                }`}
              >
                <span>{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="rounded-lg border border-[#242a36] bg-[#12151c] p-3 text-[11px] leading-relaxed text-slate-500">
          无限画布 · AI 短剧/电影生成
          <br />
          五步流程：设定 → 剧本 → 资产 → 分镜 → 剪辑
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}

export function PageHeader({ title, subtitle, extra }: { title: string; subtitle?: string; extra?: ReactNode }) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-[#1c2129] px-6 py-4">
      <div>
        <h1 className="text-base font-semibold text-slate-100">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
      </div>
      <div className="flex items-center gap-2">{extra}</div>
    </header>
  );
}
