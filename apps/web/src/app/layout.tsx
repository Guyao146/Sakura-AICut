import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sakura AI Cut · AI 短剧与电影生成平台',
  description: '无限画布 · 五步生成短剧/电影：项目设定、剧本、资产、分镜、在线剪辑',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
