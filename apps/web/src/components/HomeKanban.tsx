import Link from 'next/link';

/**
 * 首页看板：两张主导航磁贴。
 *  - 项目空间：锚定本页项目库（首页本身就是项目空间，故为页内定位）
 *  - 全局设置：跳转设置页
 * 外壳顶栏只保留品牌 logo，主导航收敛在这里。
 */
const TILES = [
  {
    href: '#project-library',
    label: '项目空间',
    desc: '浏览、搜索并打开已有项目，进入五步工作台。',
    icon: (
      <>
        <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
        <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
        <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
        <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
      </>
    ),
  },
  {
    href: '/settings',
    label: '全局设置',
    desc: '接入模型服务、配置能力路由与通用偏好。',
    icon: (
      <>
        <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
        <circle cx="16" cy="7" r="2.2" />
        <circle cx="8" cy="17" r="2.2" />
      </>
    ),
  },
] as const;

export function HomeKanban({ projectCount }: { projectCount: number }) {
  return (
    <nav aria-label="看板导航" className="grid gap-4 sm:grid-cols-2">
      {TILES.map((tile, index) => (
        <Link
          key={tile.href}
          href={tile.href}
          className="kanban-tile motion-enter group flex min-w-0 items-start gap-4 rounded-2xl border border-ink-600 bg-ink-800/70 p-5 transition-colors hover:border-pink-400/30 hover:bg-white/5 sm:p-6"
          style={{ animationDelay: `${90 + index * 60}ms` }}
        >
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-ink-900/40 text-pink-200" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              {tile.icon}
            </svg>
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              {tile.label}
              <span className="text-slate-600 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true">→</span>
            </span>
            <span className="mt-1.5 block text-xs leading-5 text-slate-400">{tile.desc}</span>
            <span className="mt-3 inline-flex items-center rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-slate-300">
              {tile.href === '#project-library' ? `${projectCount} 个项目` : '配置中心'}
            </span>
          </span>
        </Link>
      ))}
    </nav>
  );
}
