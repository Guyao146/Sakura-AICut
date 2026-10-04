import clsx from 'clsx';
import type { StudioData } from './types';

export function WorkflowNav({ progress, stage, onSelect }: {
  progress: StudioData['progress']; stage: string; onSelect: (stage: string) => void;
}) {
  return (
    <nav aria-label="创作流程" className="studio-workflow border-t border-ink-600/70 bg-ink-800/40 px-3 py-2 sm:px-5">
      <div className="grid min-w-[640px] grid-cols-5 gap-2">
        {progress.map((item, index) => (
          <button key={item.stage} type="button" aria-current={stage === item.stage ? 'step' : undefined}
            onClick={() => onSelect(item.stage)} title={`${item.title} · ${item.stats} · ${item.percent}%`}
            className={clsx('workflow-step relative flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2 text-left',
              stage === item.stage ? 'border-sakura-500/30 bg-sakura-500/10 text-pink-200' : 'border-transparent text-slate-400 hover:bg-white/5')}>
            <span className={clsx('flex size-6 shrink-0 items-center justify-center rounded-lg text-xs',
              item.percent >= 100 ? 'bg-emerald-500/15 text-emerald-300' : stage === item.stage ? 'bg-sakura-500/20 text-pink-200' : 'bg-white/5 text-slate-500')} aria-hidden="true">
              {item.percent >= 100 ? '✓' : index + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium">{item.title}</span>
              <span className="mt-0.5 hidden truncate text-[10px] text-slate-500 lg:block">{item.stats}</span>
            </span>
            <span className="hidden text-[10px] tabular-nums opacity-70 sm:block">{item.percent}%</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
