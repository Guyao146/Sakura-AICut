'use client';

import clsx from 'clsx';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

/**
 * 轻量 UI 基础组件（暗色影棚风格）
 */

export function Button({
  variant = 'default',
  size = 'md',
  className,
  children,
  loading,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost' | 'danger' | 'success';
  size?: 'sm' | 'md';
  loading?: boolean;
}) {
  const variants: Record<string, string> = {
    default: 'bg-[#242a36] hover:bg-[#2f3745] text-slate-100 border border-[#333b4a]',
    primary: 'bg-pink-500 hover:bg-pink-400 text-white border border-pink-400/40',
    ghost: 'bg-transparent hover:bg-white/5 text-slate-300 border border-transparent',
    danger: 'bg-red-600/80 hover:bg-red-500 text-white border border-red-400/30',
    success: 'bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-400/30',
  };
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
        size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-[13px]',
        variants[variant],
        className,
      )}
    >
      {loading ? <span className="inline-block size-3 animate-spin rounded-full border border-white/60 border-t-transparent" /> : null}
      {children}
    </button>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={clsx('field', className)} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={clsx('field', className)} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={clsx('field', className)}>
      {children}
    </select>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="mb-3">
      <label className="form-label">
        {label}
        {hint ? <span className="ml-2 text-[11px] text-slate-500">{hint}</span> : null}
      </label>
      {children}
    </div>
  );
}

export function Card({ title, extra, children, className }: { title?: ReactNode; extra?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={clsx('rounded-xl border border-[#242a36] bg-[#12151c] p-4', className)}>
      {title ? (
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="text-sm font-medium text-slate-200">{title}</div>
          {extra}
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function Badge({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'green' | 'amber' | 'red' | 'blue' | 'pink' }) {
  const tones: Record<string, string> = {
    default: 'bg-white/5 text-slate-300 border-white/10',
    green: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
    amber: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
    red: 'bg-red-500/10 text-red-300 border-red-500/30',
    blue: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
    pink: 'bg-pink-500/10 text-pink-300 border-pink-500/30',
  };
  return (
    <span className={clsx('inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] leading-none', tones[tone])}>
      {children}
    </span>
  );
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
      <div
        className="h-full rounded-full bg-gradient-to-r from-pink-500 to-sky-400 transition-all"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed border-[#2b3240] px-3 py-6 text-center text-xs text-slate-500">{text}</div>;
}

export function statusTone(status: string): 'default' | 'green' | 'amber' | 'red' | 'blue' {
  if (status === 'succeeded') return 'green';
  if (status === 'running') return 'blue';
  if (status === 'failed') return 'red';
  if (status === 'queued' || status === 'pending') return 'amber';
  return 'default';
}

export const STATUS_LABELS: Record<string, string> = {
  pending: '待生成',
  queued: '排队中',
  running: '生成中',
  succeeded: '已完成',
  failed: '失败',
  canceled: '已取消',
};
