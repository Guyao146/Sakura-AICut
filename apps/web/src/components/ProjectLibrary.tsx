'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import type { Project } from '@sakura/core';
import { Badge, Button, Input } from './ui';

export type ProjectFilter = 'all' | 'active' | 'completed';
const STAGES: Record<string, string> = { brief: '项目设定', script: '剧本创作', assets: '资产生成', shots: '分镜片段', edit: '在线剪辑', done: '已完成' };

export function filterProjects(projects: Project[], query: string, filter: ProjectFilter): Project[] {
  const keyword = query.trim().toLocaleLowerCase();
  return projects.filter((project) => {
    const matchesStatus = filter === 'all' || (filter === 'completed' ? project.status === 'completed' : !['completed', 'archived'].includes(project.status));
    const text = [project.brief.name, project.brief.logline, ...project.brief.genres].join(' ').toLocaleLowerCase();
    return matchesStatus && (!keyword || text.includes(keyword));
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function ProjectLibrary({ projects }: { projects: Project[] }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ProjectFilter>('all');
  const visible = useMemo(() => filterProjects(projects, query, filter), [projects, query, filter]);
  return (
    <section id="project-library" aria-labelledby="project-library-title" className="project-library min-w-0 scroll-mt-24 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="project-library-title" className="text-sm font-semibold text-slate-200">项目库 <span className="ml-1 font-normal text-slate-500">{projects.length}</span></h2>
        <Input type="search" aria-label="搜索项目" placeholder="搜索名称、故事或题材…" value={query}
          onChange={(event) => setQuery(event.target.value)} className="sm:max-w-64" />
      </div>
      <div className="flex flex-wrap gap-1" aria-label="项目筛选">
        {([['all', '全部项目'], ['active', '创作中'], ['completed', '已完成']] as const).map(([key, label]) => (
          <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}
            className={clsx('choice-chip rounded-lg px-3 py-2 text-xs', filter === key ? 'bg-sakura-500/10 text-pink-200' : 'text-slate-400 hover:bg-white/5')}>
            {label}
          </button>
        ))}
        <span role="status" className="ml-auto self-center text-xs text-slate-500">{visible.length} 个项目</span>
      </div>
      {visible.length === 0 && projects.length > 0 ? (
        <div className="library-empty motion-enter rounded-2xl border border-dashed border-ink-500 bg-ink-800/50 px-5 py-12 text-center">
          <span className="mb-3 block text-3xl text-sakura-500" aria-hidden="true">◇</span>
          <h3 className="text-sm font-medium text-slate-200">没有匹配的项目</h3>
          <p className="mt-2 text-xs leading-6 text-slate-400">换个关键词，或查看全部项目。</p>
          <Button className="mt-4" variant="ghost" onClick={() => { setQuery(''); setFilter('all'); }}>清除筛选</Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <a href="#new-project" aria-label="新建项目"
            className="project-card motion-enter group flex min-w-0 flex-col rounded-2xl border border-dashed border-ink-500 bg-ink-800/40 p-5 transition-colors hover:border-pink-400/40 hover:bg-white/5">
            <div className="project-cover relative -mx-5 -mt-5 mb-5 flex h-24 items-center justify-center rounded-t-2xl p-5">
              <div className="project-cover-art" aria-hidden="true"><span /><span /></div>
              <span className="project-cover-icon relative flex size-10 items-center justify-center rounded-xl border border-white/10 bg-ink-900/40 text-pink-200" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </span>
            </div>
            <h3 className="text-sm font-semibold text-slate-100">新建项目</h3>
            <p className="mt-2 line-clamp-2 min-h-10 text-xs leading-5 text-slate-400">填写名称，建立新的创作空间；其他设定可以在工作室里慢慢完善。</p>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-ink-600 pt-3 text-[11px]">
              <span className="text-slate-500">开始新故事</span>
              <span className="text-pink-300 transition-colors group-hover:text-pink-200" aria-hidden="true">＋</span>
            </div>
          </a>
          {visible.map((project, index) => (
            <Link key={project.id} href={`/studio/${project.id}`} data-stage={project.stage}
              style={{ animationDelay: `${Math.min(index, 6) * 45}ms` }}
              className="project-card motion-enter group flex min-w-0 flex-col rounded-2xl border border-ink-600 bg-ink-800 p-5">
              <div className="project-cover relative -mx-5 -mt-5 mb-5 flex h-24 items-start justify-between gap-3 rounded-t-2xl p-5">
                <div className="project-cover-art" aria-hidden="true"><span /><span /></div>
                <span className="project-cover-icon relative flex size-10 items-center justify-center rounded-xl border border-white/10 bg-ink-900/40 text-pink-200" aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
                    <rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 9h18M8 4v5m8-5v5m-6 4 5 3-5 3z" />
                  </svg>
                </span>
                <span className="relative"><Badge tone={project.status === 'completed' ? 'green' : 'default'}>{project.status === 'archived' ? '已归档' : STAGES[project.stage] ?? project.stage}</Badge></span>
              </div>
              <h3 className="truncate text-sm font-semibold text-slate-100">{project.brief.name}</h3>
              <p className="mt-2 line-clamp-2 min-h-10 break-words text-xs leading-5 text-slate-400">{project.brief.logline || '还没有故事梗概，进入工作室继续构思。'}</p>
              <p className="mt-4 truncate text-[11px] text-slate-500">{project.brief.genres.join(' / ') || '未选题材'} · {project.brief.aspectRatio} · {project.brief.targetDurationSec}s</p>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-ink-600 pt-3 text-[11px]">
                <time dateTime={project.updatedAt} className="text-slate-500">更新于 {project.updatedAt.slice(0, 10)}</time>
                <span className="text-pink-300 transition-colors group-hover:text-pink-200">进入工作室 <span className="project-card-arrow inline-block" aria-hidden="true">↗</span></span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
