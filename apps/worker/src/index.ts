import {
  addJobEvent,
  bootstrap,
  claimNextJob,
  closeDb,
  completeJob,
  dataDir,
  failJob,
  getJob,
  heartbeatJob,
  requeueStalledJobs,
  updateJob,
} from '@sakura/db';
import { HANDLERS } from './handlers';

/**
 * Sakura AI Cut Worker
 * 从 SQLite 队列领取任务并执行：图片生成 / 视频生成 / 时间线渲染 / Agent 执行
 * 不依赖 Redis，单机自托管即可运行；水平扩容时可启动多个实例。
 */

const CONCURRENCY = Math.max(1, Number(process.env.WORKER_CONCURRENCY ?? 3));
const POLL_INTERVAL = Math.max(300, Number(process.env.WORKER_POLL_INTERVAL ?? 1500));
const STALL_CHECK_INTERVAL = 60_000;

const running = new Map<string, AbortController>();
let shuttingDown = false;

function log(message: string): void {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  console.log(`[worker ${time}] ${message}`);
}

async function runJob(jobId: string): Promise<void> {
  const job = getJob(jobId);
  if (!job) return;

  const controller = new AbortController();
  running.set(jobId, controller);
  addJobEvent(jobId, 'info', `开始执行 ${job.type}`);

  const progress = (percent: number, stage?: string) => {
    updateJob(jobId, { progress: percent, ...(stage ? { stageLabel: stage } : {}) });
    heartbeatJob(jobId, stage);
  };
  const logEvent = (message: string, level: 'info' | 'warn' | 'error' = 'info') => {
    addJobEvent(jobId, level, message);
    log(`[${job.type}] ${message}`);
  };
  const isCanceled = () => controller.signal.aborted || getJob(jobId)?.status === 'canceled';

  const handler = HANDLERS[job.type];
  try {
    if (!handler) throw new Error(`没有找到 ${job.type} 的任务处理器`);
    const result = await handler({ job, progress, log: logEvent, isCanceled });
    const latest = getJob(jobId);
    if (latest?.status === 'canceled') {
      addJobEvent(jobId, 'warn', '任务已被取消，结果未写入');
    } else {
      completeJob(jobId, result);
      addJobEvent(jobId, 'info', '任务执行完成');
      log(`任务完成 ${job.type} ${jobId}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = failJob(jobId, message);
    addJobEvent(jobId, 'error', message);
    log(`任务失败 ${job.type} ${jobId}：${message}`);
    if (failed && failed.status === 'pending') {
      log(`已自动重排队（第 ${failed.attempts}/${failed.maxAttempts} 次尝试）`);
    }
  } finally {
    running.delete(jobId);
  }
}

function pump(): void {
  if (shuttingDown) return;
  while (running.size < CONCURRENCY) {
    const job = claimNextJob();
    if (!job) return;
    void runJob(job.id);
  }
}

async function main(): Promise<void> {
  const seeded = bootstrap();
  log('==============================================');
  log(' Sakura AI Cut Worker 已启动');
  log(` 数据目录：${dataDir()}`);
  log(` 并发数：${CONCURRENCY}　轮询间隔：${POLL_INTERVAL}ms`);
  log(` 内置提示词模板：${seeded.seededPrompts} 条（本次新增）`);
  log('==============================================');

  const timer = setInterval(pump, POLL_INTERVAL);
  const stallTimer = setInterval(() => {
    const count = requeueStalledJobs(15 * 60 * 1000);
    if (count > 0) log(`回收了 ${count} 个超时任务，已重新排队`);
  }, STALL_CHECK_INTERVAL);

  pump();

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(timer);
    clearInterval(stallTimer);
    log(`收到 ${signal}，等待 ${running.size} 个进行中的任务结束…`);
    for (const controller of running.values()) controller.abort();
    const waitTimer = setInterval(() => {
      if (running.size === 0 || shuttingDown) {
        clearInterval(waitTimer);
        closeDb();
        log('Worker 已安全退出');
        process.exit(0);
      }
    }, 500);
    setTimeout(() => {
      closeDb();
      log('等待超时，强制退出');
      process.exit(0);
    }, 20_000);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('Worker 启动失败：', error);
  process.exit(1);
});
