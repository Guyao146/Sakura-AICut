import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Node } from '@xyflow/react';
import type { CanvasItem } from '@sakura/core';
import { canvasGenerationTargets, clampDockPosition, reconcileCanvasNodes } from './canvas-state';

/**
 * 画布状态回归测试：刷新后选中/拖动状态不丢，生成目标不会选到无提示词的节点。
 */

function makeItem(patch: Partial<CanvasItem> & Pick<CanvasItem, 'id' | 'kind'>): CanvasItem {
  return {
    projectId: 'p1',
    text: '',
    url: '',
    x: 0,
    y: 0,
    z: 0,
    width: 200,
    height: 120,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  };
}

test('reconcileCanvasNodes：保留 React Flow 维护的位置、选中与拖动状态', () => {
  const previous: Node[] = [
    { id: 'a', position: { x: 10, y: 20 }, data: {}, selected: true, dragging: true, measured: { width: 200, height: 120 } },
  ];
  // 服务端刷新回来的节点坐标不同（例如自动布局），不能覆盖用户正在拖动的状态
  const incoming: Node[] = [{ id: 'a', position: { x: 999, y: 999 }, data: {} }];
  const merged = reconcileCanvasNodes(previous, incoming);
  assert.deepEqual(merged[0]!.position, { x: 10, y: 20 });
  assert.equal(merged[0]!.selected, true);
  assert.equal(merged[0]!.dragging, true);
  assert.deepEqual(merged[0]!.measured, { width: 200, height: 120 });
});

test('reconcileCanvasNodes：服务端内容字段（如 url）照常更新', () => {
  const previous: Node[] = [{ id: 'a', position: { x: 1, y: 2 }, data: { url: '' } }];
  const incoming: Node[] = [{ id: 'a', position: { x: 1, y: 2 }, data: { url: 'https://x/y.png' } }];
  const merged = reconcileCanvasNodes(previous, incoming);
  assert.deepEqual(merged[0]!.data, { url: 'https://x/y.png' });
});

test('reconcileCanvasNodes：新增节点直接放行，删除的节点不再保留', () => {
  const previous: Node[] = [
    { id: 'a', position: { x: 1, y: 2 }, data: {} },
    { id: 'deleted', position: { x: 0, y: 0 }, data: {} },
  ];
  const incoming: Node[] = [
    { id: 'a', position: { x: 1, y: 2 }, data: {} },
    { id: 'b', position: { x: 3, y: 4 }, data: {} },
  ];
  const merged = reconcileCanvasNodes(previous, incoming);
  assert.deepEqual(merged.map((node) => node.id), ['a', 'b']);
});

test('reconcileCanvasNodes：任务状态与生成参数更新，不覆盖缩放尺寸或选中状态', () => {
  const onGenerate = () => '16:9';
  const previous: Node[] = [{ id: 'a', position: { x: 10, y: 20 }, width: 320, height: 240,
    resizing: true, selected: true, data: { jobState: { status: 'pending' } } }];
  const incoming: Node[] = [{ id: 'a', position: { x: 0, y: 0 }, width: 200, height: 120,
    data: { jobState: { status: 'failed', error: '模型拒绝' }, onGenerate } }];
  const merged = reconcileCanvasNodes(previous, incoming)[0]!;
  assert.deepEqual(merged.data, incoming[0]!.data);
  assert.equal(merged.data.onGenerate, onGenerate);
  assert.equal(merged.width, 320);
  assert.equal(merged.height, 240);
  assert.equal(merged.resizing, true);
  assert.equal(merged.selected, true);
});

test('canvasGenerationTargets：没有选中时回退全部有提示词的文字节点', () => {
  const items = [
    makeItem({ id: 'a', kind: 'text', text: '樱花树下的少女' }),
    makeItem({ id: 'b', kind: 'text', text: '   ' }),
    makeItem({ id: 'c', kind: 'image', text: '已经生成过' }),
  ];
  assert.deepEqual(canvasGenerationTargets(items, [], new Set()), ['a']);
});

test('canvasGenerationTargets：有选中时只用选中的，过滤空提示词与非文字/图片节点', () => {
  const items = [
    makeItem({ id: 'a', kind: 'text', text: '樱花树下的少女' }),
    makeItem({ id: 'b', kind: 'text', text: '' }),
    makeItem({ id: 'c', kind: 'video', text: '视频节点' }),
    makeItem({ id: 'd', kind: 'image', text: '重新生成' }),
  ];
  // 选中了视频节点也不能回退到生成全画布
  assert.deepEqual(canvasGenerationTargets(items, ['c'], new Set()), []);
  assert.deepEqual(canvasGenerationTargets(items, ['a', 'b', 'c', 'd'], new Set()), ['a', 'd']);
});

test('canvasGenerationTargets：正在生成的节点不重复提交', () => {
  const items = [makeItem({ id: 'a', kind: 'text', text: '樱花树下的少女' })];
  assert.deepEqual(canvasGenerationTargets(items, ['a'], new Set(['a'])), []);
});

test('clampDockPosition：工具栏不超出可视区域，异常输入兜底为 0', () => {
  assert.deepEqual(clampDockPosition({ x: -10, y: -10 }, { width: 800, height: 600 }, { width: 240, height: 48 }), { x: 0, y: 0 });
  assert.deepEqual(clampDockPosition({ x: 1000, y: 1000 }, { width: 800, height: 600 }, { width: 240, height: 48 }), { x: 560, y: 552 });
  assert.deepEqual(clampDockPosition({ x: Number.NaN, y: Number.NaN }, { width: 800, height: 600 }, { width: 240, height: 48 }), { x: 0, y: 0 });
  // 画布比工具栏还窄时，x 上限为 0；高度够放下工具栏时 y 仍按实际可用高度限制
  assert.deepEqual(clampDockPosition({ x: 500, y: 500 }, { width: 100, height: 100 }, { width: 240, height: 48 }), { x: 0, y: 52 });
});
