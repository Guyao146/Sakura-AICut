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
  // 本机以 127.0.0.1（或局域网 IP）访问 dev 服务器时，Next 默认按跨域拦截 HMR 等开发资源，
  // 会卡住 Turbopack 的客户端水合（页面可渲染但完全无交互）。这里放行本机回环 origin。
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  typescript: { ignoreBuildErrors: false },
  experimental: {
    // 音乐通过独立上传路由接收；为 32 MiB 文件预留 multipart 开销。
    proxyClientMaxBodySize: '33mb',
    // 上传接口放宽请求体大小
    serverActions: { bodySizeLimit: '10mb' },
  },
  // srcdoc 不受 frame-src 限制，但自身导航会被拦截；全站设置覆盖客户端路由切换。
  async headers() {
    return [{ source: '/:path*', headers: [{ key: 'Content-Security-Policy', value: "frame-src 'none'" }] }];
  },
  serverExternalPackages: [],
};

export default nextConfig;
