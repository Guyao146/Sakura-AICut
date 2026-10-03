'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isActiveJob, jobRefreshKey, mergeJobSnapshot, type Job, type JobEvent } from '@sakura/core';

export type StudioJob = Job & { events?: JobEvent[] };

/** API 返回 401 时跳登录页（会话过期或未登录） */
export function redirectToLoginIfUnauthorized(status: number): boolean {
  if (status !== 401) return false;
  if (typeof window === 'undefined') return false;
  window.location.href = `/login?from=${encodeURIComponent(window.location.pathname)}`;
  return true;
}


/** 单一轮询源供画布、Agent 和任务中心共享，保留断网前状态，不用活动任务数量猜测完成。 */
export function useStudioJobs(projectId: string, initialJobs: StudioJob[]) {
  const router = useRouter();
  const [jobs, setJobs] = useState<StudioJob[]>(initialJobs);
  const [error, setError] = useState<string | null>(null);
  const jobsRef = useRef(jobs);
  const accepted = useRef(new Map<string, StudioJob>());
  const request = useRef<AbortController | null>(null);
  const fingerprint = useRef(jobRefreshKey(initialJobs));

  const acceptJob = useCallback((job: Job) => {
    if (job.projectId !== projectId) return;
    accepted.current.set(job.id, job);
    const next = [job, ...jobsRef.current.filter((entry) => entry.id !== job.id)];
    jobsRef.current = next;
    setJobs(next);
  }, [projectId]);

  const reload = useCallback(async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const acceptedAtStart = new Map(accepted.current);
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const tracked = [...new Set([...accepted.current.keys(), ...jobsRef.current.filter(isActiveJob).map((job) => job.id)])].slice(0, 100);
      const query = new URLSearchParams({ projectId, limit: '40', includeActive: '1', ids: tracked.join(',') });
      const response = await fetch(`/api/jobs?${query}`, { cache: 'no-store', signal: controller.signal });
      if (redirectToLoginIfUnauthorized(response.status)) return;
      const payload = await response.json() as { ok: boolean; data?: StudioJob[]; error?: string };
      if (!response.ok || !payload.ok || !Array.isArray(payload.data)) throw new Error(payload.error ?? '任务同步失败');
      if (request.current !== controller) return;
      const list = payload.data.filter((job) => job.projectId === projectId);
      const next = mergeJobSnapshot(list, accepted.current, acceptedAtStart);
      jobsRef.current = next;
      setJobs(next);
      setError(null);
      const key = jobRefreshKey(next);
      if (fingerprint.current !== key) router.refresh();
      fingerprint.current = key;
    } catch (cause) {
      if (request.current === controller) setError(cause instanceof Error && cause.name !== 'AbortError'
        ? cause.message : '任务同步超时，将自动重连');
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) request.current = null;
    }
  }, [projectId, router]);

  useEffect(() => {
    void reload();
    const timer = setInterval(() => { if (!document.hidden) void reload(); }, 3000);
    const onVisible = () => { if (!document.hidden) void reload(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      const controller = request.current;
      request.current = null;
      controller?.abort();
    };
  }, [reload]);

  return { jobs, error, reload, acceptJob };
}
