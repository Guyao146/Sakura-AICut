import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Job } from '../types/job';
import {
  getCanvasJobItemIds,
  getCanvasJobResults,
  getCanvasNodeJobStates,
  getCanvasRetryIds,
  hasJobFailures,
  isActiveJob,
  jobRefreshKey,
  mergeJobSnapshot,
} from './jobs';

/**
 * 节点级生成状态的回归测试。
 * 重点覆盖上一轮的误判场景：用「url 是否为空」判断生成结束，会导致
 * 「重新生成」立刻被标记完成、失败/取消无法识别、刷新页面后状态丢失。
 */

function makeJob(patch: Partial<Job> & Pick<Job, 'id'>): Job {
  return {
    projectId: 'p1',
    type: 'canvas.generate',
    status: 'pending',
    progress: 0,
    priority: 5,
    payload: {},
    attempts: 0,
    maxAttempts: 3,
    scheduledAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  };
}

test('isActiveJob：只有 pending / queued / running 算进行中', () => {
  assert.equal(isActiveJob(makeJob({ id: 'j1', status: 'pending' })), true);
  assert.equal(isActiveJob(makeJob({ id: 'j2', status: 'queued' })), true);
  assert.equal(isActiveJob(makeJob({ id: 'j3', status: 'running' })), true);
  assert.equal(isActiveJob(makeJob({ id: 'j4', status: 'succeeded' })), false);
  assert.equal(isActiveJob(makeJob({ id: 'j5', status: 'failed' })), false);
  assert.equal(isActiveJob(makeJob({ id: 'j6', status: 'canceled' })), false);
});

test('getCanvasJobItemIds：只认 canvas.generate 的字符串数组', () => {
  assert.deepEqual(
    getCanvasJobItemIds(makeJob({ id: 'j1', payload: { canvasItemIds: ['a', 'b', 'a'] } })),
    ['a', 'b'],
  );
  assert.deepEqual(getCanvasJobItemIds(makeJob({ id: 'j2', payload: {} })), []);
  assert.deepEqual(getCanvasJobItemIds(makeJob({ id: 'j3', type: 'image.generate', payload: { canvasItemIds: ['a'] } })), []);
  // 非法值要被过滤，不能把 null / 数字混进去
  assert.deepEqual(
    getCanvasJobItemIds(makeJob({ id: 'j4', payload: { canvasItemIds: ['a', null, '', 3, { id: 1 }] } as never })),
    ['a'],
  );
});

test('getCanvasJobResults：只保留带 itemId 与布尔 ok 的条目', () => {
  const job = makeJob({
    id: 'j1',
    result: {
      results: [
        { itemId: 'a', ok: true },
        { itemId: 'b', ok: false, error: '供应商限流' },
        { itemId: 'c' },
        { ok: true },
        null,
      ],
    },
  });
  assert.deepEqual(getCanvasJobResults(job), [
    { itemId: 'a', ok: true },
    { itemId: 'b', ok: false, error: '供应商限流' },
  ]);
});

test('hasJobFailures：批次成功但个别节点失败也算需关注', () => {
  assert.equal(hasJobFailures(makeJob({ id: 'j1', status: 'failed' })), true);
  assert.equal(hasJobFailures(makeJob({ id: 'j2', status: 'succeeded', result: { status: 'failed' } })), true);
  assert.equal(hasJobFailures(makeJob({ id: 'j3', status: 'succeeded', result: { failed: 1 } })), true);
  assert.equal(
    hasJobFailures(makeJob({ id: 'j4', status: 'succeeded', result: { results: [{ itemId: 'a', ok: false }] } })),
    true,
  );
  assert.equal(
    hasJobFailures(makeJob({ id: 'j5', status: 'succeeded', result: { results: [{ itemId: 'a', ok: true }] } })),
    false,
  );
  assert.equal(hasJobFailures(makeJob({ id: 'j6', status: 'succeeded', result: {} })), false);
});

test('getCanvasRetryIds：进行中的任务不能重试', () => {
  const job = makeJob({ id: 'j1', status: 'running', payload: { canvasItemIds: ['a', 'b'] } });
  assert.deepEqual(getCanvasRetryIds(job), []);
});

test('getCanvasRetryIds：只重试失败的节点，成功的绝不重复生成', () => {
  const job = makeJob({
    id: 'j1',
    status: 'succeeded',
    payload: { canvasItemIds: ['a', 'b', 'c'] },
    result: {
      results: [
        { itemId: 'a', ok: true },
        { itemId: 'b', ok: false, error: '超时' },
      ],
    },
  });
  // 已成功的批次只重试明确失败的节点；c 没有结果记录，不自动重试（可在画布手动再生成，避免误扣额度）
  assert.deepEqual(getCanvasRetryIds(job), ['b']);
});

test('getCanvasRetryIds：整批取消时全部重试', () => {
  const job = makeJob({ id: 'j1', status: 'canceled', payload: { canvasItemIds: ['a', 'b'] } });
  assert.deepEqual(getCanvasRetryIds(job), ['a', 'b']);
});

test('getCanvasNodeJobStates：运行中的任务让节点显示「生成中」，刷新页面也保留', () => {
  const job = makeJob({
    id: 'j1',
    status: 'running',
    progress: 40,
    payload: { canvasItemIds: ['a', 'b'] },
  });
  const states = getCanvasNodeJobStates([job], 'p1');
  assert.equal(states.get('a')?.status, 'running');
  assert.equal(states.get('a')?.label, '生成中');
  assert.equal(states.get('a')?.progress, 40);
  assert.equal(states.get('b')?.status, 'running');
});

test('getCanvasNodeJobStates：正在处理其它节点时，本节点显示「排队中」', () => {
  const job = makeJob({
    id: 'j1',
    status: 'running',
    payload: { canvasItemIds: ['a', 'b'] },
    result: { currentItemId: 'a' },
  });
  const states = getCanvasNodeJobStates([job], 'p1');
  assert.equal(states.get('a')?.status, 'running');
  assert.equal(states.get('b')?.status, 'queued');
  assert.equal(states.get('b')?.label, '排队中');
});

test('getCanvasNodeJobStates：批次成功但部分失败，逐节点给出成功/失败', () => {
  const job = makeJob({
    id: 'j1',
    status: 'succeeded',
    payload: { canvasItemIds: ['a', 'b'] },
    result: {
      results: [
        { itemId: 'a', ok: true },
        { itemId: 'b', ok: false, error: '内容审核未通过' },
      ],
    },
  });
  const states = getCanvasNodeJobStates([job], 'p1');
  assert.equal(states.get('a')?.status, 'succeeded');
  assert.equal(states.get('a')?.label, '已完成');
  assert.equal(states.get('b')?.status, 'failed');
  assert.equal(states.get('b')?.label, '生成失败');
  assert.equal(states.get('b')?.error, '内容审核未通过');
});

test('getCanvasNodeJobStates：重新生成时新任务覆盖旧的成功状态', () => {
  // 旧的：节点已有图，旧逻辑会误判为「已完成」
  const old = makeJob({
    id: 'j1',
    status: 'succeeded',
    createdAt: '2026-01-01T00:00:00.000Z',
    payload: { canvasItemIds: ['a'] },
    result: { results: [{ itemId: 'a', ok: true }] },
  });
  // 新的：重新生成，还在排队
  const next = makeJob({
    id: 'j2',
    status: 'pending',
    createdAt: '2026-01-02T00:00:00.000Z',
    payload: { canvasItemIds: ['a'] },
  });
  const states = getCanvasNodeJobStates([old, next], 'p1');
  assert.equal(states.get('a')?.status, 'pending');
  assert.equal(states.get('a')?.label, '排队中');
});

test('getCanvasNodeJobStates：进行中的老任务优先于更新的已完成任务', () => {
  const running = makeJob({
    id: 'j1',
    status: 'running',
    createdAt: '2026-01-01T00:00:00.000Z',
    payload: { canvasItemIds: ['a'] },
  });
  const newer = makeJob({
    id: 'j2',
    status: 'succeeded',
    createdAt: '2026-01-03T00:00:00.000Z',
    payload: { canvasItemIds: ['a'] },
    result: { results: [{ itemId: 'a', ok: true }] },
  });
  const states = getCanvasNodeJobStates([running, newer], 'p1');
  assert.equal(states.get('a')?.jobId, 'j1');
});

test('getCanvasNodeJobStates：只处理当前项目的任务', () => {
  const other = makeJob({ id: 'j1', projectId: 'p2', status: 'running', payload: { canvasItemIds: ['a'] } });
  const states = getCanvasNodeJobStates([other], 'p1');
  assert.equal(states.size, 0);
});

test('mergeJobSnapshot：请求过程中提交或取消的任务不会被旧快照覆盖', () => {
  const pending = makeJob({ id: 'j1', status: 'pending' });
  const canceled = makeJob({ id: 'j1', status: 'canceled', updatedAt: '2026-01-01T00:01:00.000Z' });
  const newlySubmitted = makeJob({ id: 'j2' });
  const accepted = new Map([['j1', pending]]);
  const atStart = new Map(accepted);
  accepted.set('j1', canceled);
  accepted.set('j2', newlySubmitted);
  assert.deepEqual(mergeJobSnapshot([pending], accepted, atStart), [canceled, newlySubmitted]);
  assert.equal(accepted.size, 2);
  const confirmed = mergeJobSnapshot([canceled, newlySubmitted], accepted, new Map(accepted));
  assert.deepEqual(confirmed, [canceled, newlySubmitted]);
  assert.equal(accepted.size, 0);
});

test('mergeJobSnapshot：即使请求晚于本地更新，也不接受时间戳更旧的状态', () => {
  const canceled = makeJob({ id: 'j1', status: 'canceled', updatedAt: '2026-01-02T00:00:00.000Z' });
  const accepted = new Map([['j1', canceled]]);
  assert.deepEqual(mergeJobSnapshot([makeJob({ id: 'j1' })], accepted, new Map(accepted)), [canceled]);
});

test('getCanvasRetryIds：部分完成后取消，仅重试失败与尚未执行的节点', () => {
  const job = makeJob({ id: 'j1', status: 'canceled', payload: { canvasItemIds: ['a', 'b', 'c'] },
    result: { results: [{ itemId: 'a', ok: true }, { itemId: 'b', ok: false, error: '限流' }] } });
  assert.deepEqual(getCanvasRetryIds(job), ['b', 'c']);
  const states = getCanvasNodeJobStates([job], 'p1');
  assert.equal(states.get('a')?.status, 'succeeded');
  assert.equal(states.get('b')?.status, 'failed');
  assert.equal(states.get('c')?.status, 'canceled');
});

test('jobRefreshKey：活动数量不变时，完成或产物变化仍触发刷新，顺序不影响刷新', () => {
  const first = makeJob({ id: 'j1', status: 'running' });
  const second = makeJob({ id: 'j2', status: 'pending' });
  assert.equal(jobRefreshKey([first, second]), jobRefreshKey([second, first]));
  assert.notEqual(jobRefreshKey([first]), jobRefreshKey([second]));
  assert.notEqual(jobRefreshKey([first]), jobRefreshKey([{ ...first, result: { results: [{ itemId: 'a', ok: true }] } }]));
  assert.equal(hasJobFailures({ status: 'succeeded', result: { failed: ['节点失败'] } }), true);
});

test('jobRefreshKey：只更新心跳不触发刷新，状态/产物变化才刷新', () => {
  const base = makeJob({ id: 'j1', status: 'running', progress: 10, heartbeatAt: '2026-01-01T00:00:00.000Z' });
  const key1 = jobRefreshKey([base]);
  const key2 = jobRefreshKey([makeJob({ ...base, heartbeatAt: '2026-01-01T00:01:00.000Z' })]);
  assert.equal(key1, key2);
  const key3 = jobRefreshKey([makeJob({ ...base, progress: 50 })]);
  assert.notEqual(key1, key3);
});
