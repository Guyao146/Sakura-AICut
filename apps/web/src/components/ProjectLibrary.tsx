'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import type { Project } from '@sakura/core';
import { deleteProjectAction } from '@/app/actions/project';
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
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null);
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
            <div
              key={project.id}
              data-stage={project.stage}
              style={{ animationDelay: `${Math.min(index, 6) * 45}ms` }}
              className="project-card motion-enter group relative flex min-w-0 flex-col rounded-2xl border border-ink-600 bg-ink-800 p-5"
            >
              <Link href={`/studio/${project.id}`} aria-label={`进入工作室：${project.brief.name}`} className="flex min-w-0 flex-1 flex-col">
                <div className="project-cover relative -mx-5 -mt-5 mb-5 flex h-24 items-start justify-between gap-3 rounded-t-2xl p-5">
                  <div className="project-cover-art" aria-hidden="true"><span /><span /></div>
                  <span className="project-cover-icon relative flex size-10 items-center justify-center rounded-xl border border-white/10 bg-ink-900/40 text-pink-200" aria-hidden="true">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
                      <rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 9h18M8 4v5m8-5v5m-6 4 5 3-5 3z" />
                    </svg>
                  </span>
                  <span className="relative mr-9"><Badge tone={project.status === 'completed' ? 'green' : 'default'}>{project.status === 'archived' ? '已归档' : STAGES[project.stage] ?? project.stage}</Badge></span>
                </div>
                <h3 className="truncate text-sm font-semibold text-slate-100">{project.brief.name}</h3>
                <p className="mt-2 line-clamp-2 min-h-10 break-words text-xs leading-5 text-slate-400">{project.brief.logline || '还没有故事梗概，进入工作室继续构思。'}</p>
                <p className="mt-4 truncate text-[11px] text-slate-500">{project.brief.genres.join(' / ') || '未选题材'} · {project.brief.aspectRatio} · {project.brief.targetDurationSec}s</p>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-ink-600 pt-3 text-[11px]">
                  <time dateTime={project.updatedAt} className="text-slate-500">更新于 {project.updatedAt.slice(0, 10)}</time>
                  <span className="text-pink-300 transition-colors group-hover:text-pink-200">进入工作室 <span className="project-card-arrow inline-block" aria-hidden="true">↗</span></span>
                </div>
              </Link>
              <button
                type="button"
                aria-label={`删除项目「${project.brief.name}」`}
                title="删除项目"
                onClick={() => setPendingDelete(project)}
                className="absolute right-4 top-4 z-10 flex size-8 items-center justify-center rounded-lg border border-white/10 bg-ink-900/60 text-slate-400 opacity-0 backdrop-blur transition-colors hover:border-red-400/50 hover:text-red-300 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50 group-hover:opacity-100 group-focus-within:opacity-100"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 7h16M9.5 7V4.8c0-.5.4-.8.9-.8h3.2c.5 0 .9.3.9.8V7M6.5 7l.9 12.2c0 .5.4.8.9.8h7.4c.5 0 .9-.3.9-.8L17.5 7" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
      {pendingDelete ? (
        <DeleteProjectDialog project={pendingDelete} onClose={() => setPendingDelete(null)} />
      ) : null}
    </section>
  );
}

/**
 * 删除项目的二次确认对话框：点击卡片删除按钮（第一次）后弹出，
 * 必须再点「确认删除」（第二次）才真正删除；删除中禁用关闭，失败可重试。
 */
function DeleteProjectDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);

  const confirmDelete = async () => {
    setBusy(true);
    setError(null);
    const result = await deleteProjectAction(project.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? '删除失败，请重试');
      return;
    }
    router.refresh();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-project-title"
      onClick={() => { if (!busy) onClose(); }}
    >
      <div className="w-full max-w-sm rounded-2xl border border-ink-600 bg-ink-800 p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <h2 id="delete-project-title" className="text-sm font-semibold text-slate-100">删除项目「{project.brief.name}」？</h2>
        <p className="mt-2 text-xs leading-6 text-slate-400">
          将永久删除该项目及其资产、分镜片段、剧本与剪辑数据，<span className="font-medium text-red-300">此操作不可恢复</span>。
        </p>
        {error ? <p className="mt-2 text-xs text-red-300" role="alert">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            autoFocus
            className="ui-button rounded-lg border border-ink-600 px-4 py-2 text-xs text-slate-300 transition-colors hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void confirmDelete()}
            disabled={busy}
            className="rounded-lg bg-red-500/90 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? '删除中…' : '确认删除'}
          </button>
        </div>
      </div>
    </div>
  );
}
