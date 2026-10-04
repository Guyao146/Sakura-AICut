import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_BRIEF, type Project } from '@sakura/core';
import { filterProjects, ProjectLibrary } from './ProjectLibrary';
import { AppShell } from './AppShell';
import { HomeKanban } from './HomeKanban';
import { WorkflowNav } from './studio/WorkflowNav';
import { Button } from './ui';

const projects: Project[] = [
  { id: 'draft', brief: { ...DEFAULT_BRIEF, name: 'Sakura Story', logline: '雨夜相遇' }, stage: 'brief', status: 'draft', createdAt: '', updatedAt: '2026-01-01' },
  { id: 'done', brief: { ...DEFAULT_BRIEF, name: '完成的故事' }, stage: 'done', status: 'completed', createdAt: '', updatedAt: '2026-02-01' },
  { id: 'archived', brief: { ...DEFAULT_BRIEF, name: '归档故事' }, stage: 'script', status: 'archived', createdAt: '', updatedAt: '2026-03-01' },
];

test('项目库按更新时间排序，不改动输入数组', () => {
  assert.deepEqual(filterProjects(projects, '', 'all').map((p) => p.id), ['archived', 'done', 'draft']);
  assert.equal(projects[0].id, 'draft');
});

test('项目库支持名称、故事和题材搜索，与状态筛选组合', () => {
  assert.equal(filterProjects(projects, '  SAKURA  ', 'active')[0]?.id, 'draft');
  assert.equal(filterProjects(projects, '雨夜', 'all')[0]?.id, 'draft');
  assert.equal(filterProjects(projects, '都市逆袭', 'all').length, 3);
  assert.deepEqual(filterProjects(projects, '', 'active').map((p) => p.id), ['draft']);
  assert.deepEqual(filterProjects(projects, '', 'completed').map((p) => p.id), ['done']);
  assert.equal(filterProjects(projects, '不存在', 'all').length, 0);
});

test('项目库空态提供新建入口，卡片显示中文阶段与项目链接', () => {
  const empty = renderToStaticMarkup(createElement(ProjectLibrary, { projects: [] }));
  assert.match(empty, /href="#new-project"/);
  const html = renderToStaticMarkup(createElement(ProjectLibrary, { projects }));
  assert.match(html, /aria-label="搜索项目"/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /href="\/studio\/draft"/);
  assert.match(html, /项目设定/);
  assert.match(html, /已归档/);
  assert.doesNotMatch(html, />brief</);
});

test('流程导航始终显示步骤名称，当前步骤与完成状态分别表达', () => {
  const progress = ['brief', 'script', 'assets', 'shots', 'edit'].map((stage, index) => ({
    stage, index, title: ['项目设定', '剧本创作', '资产生成', '分镜片段', '在线剪辑'][index],
    percent: index === 0 ? 100 : 0, done: index === 0, stats: '待完善',
  }));
  const html = renderToStaticMarkup(createElement(WorkflowNav, { progress, stage: 'assets', onSelect() {} }));
  assert.equal((html.match(/<button/g) ?? []).length, 5);
  assert.equal((html.match(/aria-current="step"/g) ?? []).length, 1);
  assert.match(html, /aria-label="创作流程"/);
  for (const { title } of progress) assert.ok(html.includes(title));
  assert.match(html, /✓/);
  assert.doesNotMatch(html, /hidden xl:inline/);
  assert.equal((html.match(/class="workflow-step /g) ?? []).length, 5);
});

test('项目卡片错峰入场延迟有上限，装饰不进入辅助技术名称', () => {
  const many = Array.from({ length: 12 }, (_, index) => ({ ...projects[0], id: `project-${index}` }));
  const html = renderToStaticMarkup(createElement(ProjectLibrary, { projects: many }));
  const delays = [...html.matchAll(/animation-delay:(\d+)ms/g)].map((match) => Number(match[1]));
  assert.equal(delays.length, 12);
  assert.deepEqual(delays.slice(0, 3), [0, 45, 90]);
  assert.ok(delays.every((value) => value <= 270));
  assert.equal((html.match(/class="project-cover-art" aria-hidden="true"/g) ?? []).length, 12);
  assert.equal((html.match(/data-stage="brief"/g) ?? []).length, 12);
});

test('应用外壳为极简顶栏：左上角 logo 与注销，不含主导航磁贴', () => {
  const html = renderToStaticMarkup(createElement(AppShell, { children: createElement('div', null, '页面内容') }));
  assert.match(html, /跳到主要内容/);
  assert.match(html, /href="\/"/);
  assert.match(html, /Sakura AI Cut/);
  assert.match(html, /注销登录/);
  assert.doesNotMatch(html, /aria-label="主导航"/);
  assert.doesNotMatch(html, /kanban-tile/);
  assert.equal((html.match(/aria-current="page"/g) ?? []).length, 0);
});

test('首页看板磁贴承载主导航：项目空间锚定项目库，全局设置跳转设置页', () => {
  const html = renderToStaticMarkup(createElement(HomeKanban, { projectCount: 3 }));
  assert.match(html, /aria-label="看板导航"/);
  assert.match(html, /href="#project-library"/);
  assert.match(html, /href="\/settings"/);
  assert.match(html, /项目空间/);
  assert.match(html, /全局设置/);
  assert.match(html, /3 个项目/);
  assert.equal((html.match(/<a /g) ?? []).length, 2);
});

test('主按钮保留加载和禁用语义，视觉样式不影响其它变体', () => {
  const loading = renderToStaticMarkup(createElement(Button, { variant: 'primary', loading: true }, '创建'));
  assert.match(loading, /ui-button-primary/);
  assert.match(loading, /disabled=""/);
  assert.match(loading, /animate-spin/);
  const ghost = renderToStaticMarkup(createElement(Button, { variant: 'ghost' }, '取消'));
  assert.match(ghost, /ui-button /);
  assert.doesNotMatch(ghost, /ui-button-primary|disabled=""/);
});
