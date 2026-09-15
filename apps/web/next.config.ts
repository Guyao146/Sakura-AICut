import type { NextConfig } from 'next';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(appDir, '..', '..');

const nextConfig: NextConfig = {
  // monorepo 中直接引用 TS 源码包
  transpilePackages: ['@sakura/core', '@sakura/db', '@sakura/pipeline'],
  // 生产镜像使用 standalone，减小体积
  output: 'standalone',
  outputFileTracingRoot: repoRoot,
  // 建表语句已在构建期内嵌为 TS 字符串（packages/db/scripts/embed-schema.mjs），
  // 因此 standalone 产物无需再追踪 schema.sql；保留 db 包描述即可。
  outputFileTracingIncludes: {
    '/**': ['../../packages/db/package.json'],
  },
  images: { unoptimized: true },
  typescript: { ignoreBuildErrors: false },
  experimental: {
    // 上传接口放宽请求体大小
    serverActions: { bodySizeLimit: '10mb' },
  },
  serverExternalPackages: [],
};

export default nextConfig;
