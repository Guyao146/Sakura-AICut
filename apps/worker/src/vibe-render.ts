import { fork, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { chmod, chown, mkdir, mkdtemp, rename, rm, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createId, vibeMetaFor, planVibeFrames, type VibeProtocolMeta } from '@sakura/core';
import { dataDir, getProject, getVibeProject } from '@sakura/db';

export interface VibeRenderOptions {
  ffmpegPath?: string;
  timeoutMs?: number;
  onProgress?: (percent: number, stage: string) => void;
  onLog?: (message: string, level?: 'info' | 'warn' | 'error') => void;
  isCanceled?: () => boolean;
}

export interface VibeRenderResult {
  outputPath: string;
  outputUrl: string;
  durationSec: number;
  fps: number;
  frameCount: number;
  width: number;
  height: number;
}

const running = new Map<ChildProcess, { browserPid?: number; stopping?: Promise<void> }>();

function killGroup(pid: number): void {
  try { process.kill(-pid, 'SIGKILL'); } catch { /* 进程组已经退出 */ }
}

/** 只终止本函数创建并登记的进程树。浏览器在类 Unix 系统另建进程组，需单独回收。 */
function terminate(child: ChildProcess): Promise<void> {
  const state = running.get(child);
  if (!state || !child.pid) return Promise.resolve();
  if (state.stopping) return state.stopping;
  state.stopping = (async () => {
    if (process.platform === 'win32') {
      if (child.exitCode !== null || child.signalCode !== null) return;
      await new Promise<void>((resolve) => {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 });
        killer.once('error', () => { child.kill('SIGKILL'); resolve(); });
        killer.once('close', () => resolve());
      });
    } else {
      if (state.browserPid) killGroup(state.browserPid);
      // 启动尚未完成时让运行库先处理信号，避免浏览器 PID 还未登记就强杀父进程。
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 1000);
          child.once('exit', () => { clearTimeout(timer); resolve(); });
        });
        if (state.browserPid) killGroup(state.browserPid);
        killGroup(child.pid!);
      }
    }
  })();
  return state.stopping;
}

export async function closeVibeBrowser(): Promise<void> {
  await Promise.all([...running.keys()].map(terminate));
}

/** 整体期限与停滞期限均在父进程监控，页面死循环也能取消并回收。 */
async function renderIsolated(code: string, meta: VibeProtocolMeta, outputPath: string, options: VibeRenderOptions): Promise<void> {
  const workDir = dirname(outputPath);
  const dropRoot = process.platform === 'linux' && process.getuid?.() === 0;
  if (dropRoot) { await chown(workDir, 1000, 1000); await chmod(workDir, 0o700); }
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'PLAYWRIGHT_BROWSERS_PATH']) {
    if (process.env[key]?.trim()) env[key] = process.env[key];
  }
  const cache = process.platform === 'win32' ? process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
    : process.platform === 'darwin' ? join(homedir(), 'Library', 'Caches') : process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
  env.PLAYWRIGHT_BROWSERS_PATH ||= join(cache, 'ms-playwright');
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) env.LOCALAPPDATA = process.env.LOCALAPPDATA;
  Object.assign(env, { HOME: workDir, TMPDIR: workDir, TEMP: workDir, TMP: workDir, NODE_ENV: 'production' });
  const child = fork(fileURLToPath(new URL('./vibe-render-child.ts', import.meta.url)), [], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), env,
    execArgv: ['--import', 'tsx'], detached: process.platform !== 'win32',
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    ...(dropRoot ? { uid: 1000, gid: 1000 } : {}),
  });
  const state: { browserPid?: number; stopping?: Promise<void> } = {};
  running.set(child, state);
  let diagnostic = '';
  child.stderr?.on('data', (chunk: Buffer) => { diagnostic = (diagnostic + chunk.toString()).slice(-2000); });
  const started = Date.now();
  let lastProgress = started;
  const limit = options.timeoutMs ?? 600_000;
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      let done = false;
      child.once('error', () => reject(new Error('无法启动独立渲染进程')));
      child.once('exit', (code) => done && code === 0 ? resolve() : reject(new Error(`渲染进程意外退出：${diagnostic.slice(-500)}`)));
      child.on('message', (message: { type?: string; percent?: number; stage?: string; error?: string; pid?: number }) => {
        try {
          if (message.type === 'browser' && Number.isSafeInteger(message.pid) && message.pid! > 1) {
            state.browserPid = message.pid;
            if (state.stopping && process.platform !== 'win32') killGroup(message.pid!);
          }
          if (message.type === 'error') reject(new Error(message.error || '渲染失败'));
          if (message.type === 'done') { done = true; state.browserPid = undefined; }
          if (message.type === 'progress' && Number.isFinite(message.percent)) {
            lastProgress = Date.now();
            options.onProgress?.(message.percent!, String(message.stage ?? '').slice(0, 200));
          }
        } catch (error) { reject(error); }
      });
      timer = setInterval(() => {
        try {
          if (options.isCanceled?.()) reject(new Error('渲染已取消'));
          else if (Date.now() - started > limit || Date.now() - lastProgress > 45_000) reject(new Error('渲染超时，已终止隔离进程'));
        } catch (error) { reject(error); }
      }, 100);
      child.send({ code, meta, outputPath, ffmpegPath: options.ffmpegPath || process.env.FFMPEG_PATH || 'ffmpeg' },
        (error) => { if (error) reject(new Error('渲染进程通信失败')); });
    });
  } finally {
    clearInterval(timer);
    await terminate(child);
    running.delete(child);
  }
}

export async function renderVibeVideo(projectId: string, options: VibeRenderOptions = {}): Promise<VibeRenderResult> {
  const project = getProject(projectId);
  const vibe = getVibeProject(projectId);
  if (!project || project.mode !== 'vibe' || !vibe?.script || !vibe.code) throw new Error('请先生成 Vibe 脚本和动画代码');
  if (options.isCanceled?.()) throw new Error('渲染已取消');
  const meta = vibeMetaFor(project.brief, vibe.script);
  const { times } = planVibeFrames(meta);
  const workDir = await mkdtemp(join(tmpdir(), 'sakura-render-'));
  const temporary = join(workDir, 'video.mp4');
  let destination: string | undefined;
  let completed = false;
  try {
    await renderIsolated(vibe.code, meta, temporary, options);
    if (options.isCanceled?.()) throw new Error('渲染已取消');
    const size = (await stat(temporary)).size;
    if (size < 32) throw new Error('渲染产物为空');
    const filename = `vibe_${createId(16)}.mp4`;
    const relative = `media/${projectId}/${filename}`;
    const outputPath = join(dataDir(), 'media', projectId, filename);
    destination = outputPath;
    await mkdir(dirname(outputPath), { recursive: true });
    // 临时文件与数据卷可能不在同一分区。
    try { await rename(temporary, outputPath); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
      const { copyFile } = await import('node:fs/promises');
      await copyFile(temporary, outputPath);
    }
    options.onLog?.(`视频编码完成：${times.length} 帧，${size} 字节`);
    if (options.isCanceled?.()) throw new Error('渲染已取消');
    await rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    completed = true;
    return { ...meta, durationSec: times.length / meta.fps, frameCount: times.length, outputPath, outputUrl: `/api/files/${relative}` };
  } finally {
    if (!completed) {
      if (destination) await rm(destination, { force: true, maxRetries: 5, retryDelay: 100 });
      await rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
}
