import Link from 'next/link';
import { bootstrap, listProjects } from '@sakura/db';
import { AppShell, PageHeader } from '@/components/AppShell';
import { NewProjectForm } from '@/components/NewProjectForm';
import { Badge } from '@/components/ui';

/**
 * 首页：项目列表 + 新建项目
 */
export const dynamic = 'force-dynamic';

export default function HomePage() {
  bootstrap();
  const projects = listProjects();

  return (
    <AppShell active="projects">
      <PageHeader
        title="我的项目"
        subtitle="无限画布 · 五步生成 AI 短剧 / 电影：设定 → 剧本 → 资产 → 分镜 → 剪辑"
        extra={<Badge tone="pink">{projects.length} 个项目</Badge>}
      />
      <div className="grid gap-4 p-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-3">
          {projects.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#2b3240] p-10 text-center text-sm text-slate-500">
              还没有项目。右侧填写项目设定，创建你的第一部 AI 短剧。
            </div>
          ) : (
            projects.map((project) => (
              <Link
                key={project.id}
                href={`/studio/${project.id}`}
                className="block rounded-xl border border-[#242a36] bg-[#12151c] p-4 transition-colors hover:border-pink-400/40"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-medium text-slate-100">{project.brief.name}</div>
                    <div className="mt-1 truncate text-[11px] text-slate-500">
                      {project.brief.genres.join(' / ') || '未选题材'} · {project.brief.style} ·{' '}
                      {project.brief.aspectRatio} · 目标 {project.brief.targetDurationSec}s
                    </div>
                    {project.brief.logline ? (
                      <div className="mt-1 truncate text-[11px] text-slate-600">{project.brief.logline}</div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={project.status === 'completed' ? 'green' : 'default'}>{project.stage}</Badge>
                    <span className="text-[11px] text-slate-500">
                      {new Date(project.updatedAt).toLocaleString('zh-CN', { hour12: false })}
                    </span>
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
        <NewProjectForm />
      </div>
    </AppShell>
  );
}
