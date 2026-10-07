import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sakura AI Cut · AI 短剧与电影生成平台',
  description: '无限画布 · 五步生成短剧/电影：项目设定、剧本、资产、分镜、在线剪辑',
};

/** 主题标识（与 components/ThemeProvider 保持一致）；首帧前应用，避免刷新闪烁 */
const THEME_KEY = 'sakura-theme';
const themeInitScript = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');if(t&&['mindmap','aurora','sunset'].indexOf(t)>=0){document.documentElement.dataset.theme=t}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {children}
      </body>
    </html>
  );
}
