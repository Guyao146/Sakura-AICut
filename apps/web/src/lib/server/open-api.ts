import { NextResponse } from 'next/server';
import type { TaskStatus } from '@sakura/core';

/**
 * 开放 API（/api/open/*）共用工具：X-API-Key 鉴权与任务状态可读映射。
 * 独立于会话体系：凭 AICUT_OPEN_API_KEYS（逗号分隔多 key）鉴权，
 * 未配置任何 key 时一律 401（fail-closed）。
 */

export function requireOpenApiKey(request: Request): NextResponse | null {
  const configured = (process.env.AICUT_OPEN_API_KEYS ?? '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
  if (configured.length === 0) {
    return NextResponse.json({ error: '开放 API 未启用：服务端未配置 AICUT_OPEN_API_KEYS' }, { status: 401 });
  }
  const provided = request.headers.get('x-api-key')?.trim() ?? '';
  if (!configured.includes(provided)) {
    return NextResponse.json({ error: '无效的 API Key' }, { status: 401 });
  }
  return null;
}

const JOB_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: '排队',
  queued: '排队',
  running: '运行中',
  succeeded: '成功',
  failed: '失败',
  canceled: '已取消',
};

export function jobStatusLabel(status: TaskStatus): string {
  return JOB_STATUS_LABELS[status];
}
