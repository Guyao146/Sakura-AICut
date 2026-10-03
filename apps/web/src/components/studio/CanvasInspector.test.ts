import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CanvasItem } from '@sakura/core';
import { CanvasInspector } from './CanvasInspector';

for (const kind of ['text', 'image', 'video', 'audio'] as const) {
  for (const role of ['plain', 'character', 'scene', 'prop'] as const) {
    test(`节点面板：${kind}/${role} 均提供输入、优化、生成入口`, () => {
      const item: CanvasItem = { id: 'node', projectId: 'project', kind, role, text: '已有内容',
        x: 0, y: 0, width: 320, height: 180, z: 1, createdAt: '', updatedAt: '' };
      const props = { item, onClose() {}, onFocus() {}, async onUpdate() {}, async onDelete() {},
        async onBringToFront() {}, async onAi() {}, async onSelectVariant() {} };
      const html = renderToStaticMarkup(createElement(CanvasInspector, props));
      assert.match(html, /AI 优化/);
      assert.match(html, /本次输入/);
      assert.match(html, /已有内容/);
      assert.match(html, /生成/);
      assert.match(html, /id="node-content"/);
      assert.match(html, /id="node-ai-instruction"/);
      const busy = renderToStaticMarkup(createElement(CanvasInspector, { ...props,
        jobState: { jobId: 'job', status: 'running', progress: 20, label: '生成中' } }));
      assert.match(busy, /disabled=""/);
      assert.match(busy, /role="status"/);
    });
  }
}
