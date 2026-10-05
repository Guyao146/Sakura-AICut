import { NextResponse } from 'next/server';
import { createProject, listProjects } from '@sakura/db';
import { requireOpenApiKey } from '@/lib/server/open-api';

/**
 * 开放 API：项目列表与创建
 * GET  /api/open/projects?limit=n  → { projects: [{ id, name, updatedAt }] }
 * POST /api/open/projects {name}   → { id, name }
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const denied = requireOpenApiKey(request);
  if (denied) return denied;
  const limitParam = Number(new URL(request.url).searchParams.get('limit') ?? NaN);
  const all = listProjects();
  const projects = (Number.isFinite(limitParam) && limitParam > 0 ? all.slice(0, Math.floor(limitParam)) : all).map(
    (project) => ({ id: project.id, name: project.brief.name, updatedAt: project.updatedAt }),
  );
  return NextResponse.json({ projects });
}

export async function POST(request: Request) {
  const denied = requireOpenApiKey(request);
  if (denied) return denied;
  let body: { name?: unknown } = {};
  try {
    body = (await request.json()) as { name?: unknown };
  } catch {
    // 空 / 非 JSON 请求体按缺少 name 处理
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'name 为必填非空字符串' }, { status: 400 });
  const project = createProject({ name });
  return NextResponse.json({ id: project.id, name: project.brief.name }, { status: 201 });
}
