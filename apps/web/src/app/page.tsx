import { bootstrap, listProjects } from '@sakura/db';
import { AppShell } from '@/components/AppShell';
import { NewProjectForm } from '@/components/NewProjectForm';
import { ProjectLibrary } from '@/components/ProjectLibrary';

/**
 * 首页：创作概览 + 项目库（首格为新建项目入口）+ 新建项目表单
 */
export const dynamic = 'force-dynamic';

export default function HomePage() {
  bootstrap();
  const projects = listProjects();

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1600px] space-y-6 p-4 sm:p-6 lg:p-8">
        <section aria-label="创作概览" className="library-hero motion-enter flex flex-wrap items-center justify-between gap-6 rounded-2xl border border-sakura-500/20 p-5 sm:p-7">
          <div className="hero-art" aria-hidden="true">
            <span className="hero-orbit" />
            <span className="hero-frame hero-frame-back" />
            <span className="hero-frame hero-frame-front"><span>✦</span></span>
          </div>
          <div className="relative">
            <p className="mb-3 flex items-center gap-2 text-[11px] font-medium tracking-widest text-pink-300"><span className="hero-spark" aria-hidden="true" />SAKURA · 创作工作室</p>
            <h1 className="text-xl font-semibold tracking-tight text-slate-100 sm:text-2xl">让故事，一步步<span className="hero-title-accent">成为作品。</span></h1>
            <p className="mt-3 max-w-lg text-xs leading-6 text-slate-300">设定方向，打磨剧本，在画布上组织资产与分镜，最后完成剪辑。</p>
            <div className="mt-5 flex items-center gap-2 text-[10px] tracking-wider text-slate-400" aria-hidden="true">
              <span className="text-pink-300">灵感</span><span className="hero-trail" /><span>画布</span><span className="hero-trail" /><span className="text-sky-200">成片</span>
            </div>
          </div>
          <dl className="hero-stats relative flex gap-7 rounded-xl border border-white/10 px-5 py-4 text-xs text-slate-300">
            <div><dt>全部项目</dt><dd className="mt-2 text-3xl font-semibold tabular-nums text-slate-100">{projects.length}</dd></div>
            <div className="border-l border-white/10 pl-7"><dt>已完成</dt><dd className="mt-2 text-3xl font-semibold tabular-nums text-pink-200">{projects.filter((project) => project.status === 'completed').length}</dd></div>
          </dl>
        </section>
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_360px]">
          <ProjectLibrary projects={projects} />
          <section id="new-project" aria-label="新建项目" className="motion-enter min-w-0 scroll-mt-24" style={{ animationDelay: '140ms' }}>
            <NewProjectForm />
            <p className="mt-3 px-1 text-xs leading-5 text-slate-500">生成前，请在全局设置中接入模型服务并配置能力路由。</p>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
