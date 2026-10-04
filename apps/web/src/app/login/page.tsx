import type { ReactNode } from 'react';
import { hasAdminPassword, listOidcProviders, OIDC_PRESETS } from '@sakura/db';
import { LoginForm } from '@/components/LoginForm';

/**
 * 登录页:三种登录方式
 *  1. 本地账户密码(首次进入时在此初始化)
 *  2. Sakura 账号(Sakura-Auth-Server,可选)
 *  3. 通用 OIDC(可选)
 * 后两者由设置页接入后才显示按钮。
 *
 * 布局采用品牌化分栏:左侧渐变品牌面板(桌面端),右侧表单;窄屏仅表单,
 * 由表单上方的紧凑品牌行承接识别。品牌色取自项目自身的 sakura token。
 */
export const dynamic = 'force-dynamic';

/** 登录页动效(仅本页作用域):渐变缓移 / 入场错峰 / 装饰慢转 / 按钮光晕 */
const LOGIN_CSS = `
.aicut-brand{background-size:170% 170%;animation:aicut-pan 16s ease-in-out infinite alternate}
@keyframes aicut-pan{from{background-position:0% 0%}to{background-position:100% 100%}}
.aicut-deco{animation:aicut-spin 90s linear infinite;transform-origin:center}
@keyframes aicut-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
@keyframes aicut-rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
.aicut-in{animation:aicut-rise .8s cubic-bezier(.22,.61,.36,1) both}
.aicut-form-panel{animation:aicut-slide .9s cubic-bezier(.22,.61,.36,1) both}
@keyframes aicut-slide{from{opacity:0;transform:translateX(28px)}to{opacity:1;transform:none}}
.aicut-brand li{transition:transform .2s ease}
.aicut-brand li:hover{transform:translateX(4px)}
.aicut-form-panel button[type="submit"]{transition:transform .2s ease,box-shadow .2s ease}
.aicut-form-panel button[type="submit"]:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 10px 30px rgba(236,72,153,.35)}
@media (prefers-reduced-motion: reduce){
  .aicut-brand,.aicut-deco,.aicut-in,.aicut-form-panel{animation:none !important}
  .aicut-in{opacity:1 !important;transform:none !important}
}`;

/** 五瓣樱花标(white 填充 + mask 挖出花心,渐变自花心透出) */
function Flower({ size = 28, maskId }: { size?: number; maskId: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <mask id={maskId}>
        <rect width="24" height="24" fill="#fff" />
        <circle cx="12" cy="11.8" r="2.1" fill="#000" />
      </mask>
      <g fill="currentColor" mask={`url(#${maskId})`}>
        <circle cx="12" cy="6.5" r="4.1" />
        <circle cx="6.77" cy="10.3" r="4.1" />
        <circle cx="8.77" cy="16.45" r="4.1" />
        <circle cx="15.23" cy="16.45" r="4.1" />
        <circle cx="17.23" cy="10.3" r="4.1" />
      </g>
    </svg>
  );
}

function FeatureIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

const FEATURES: { icon: ReactNode; title: string; desc: string }[] = [
  {
    icon: <><rect x="1.75" y="1.75" width="12.5" height="12.5" rx="2" /><circle cx="6" cy="6" r="1.4" /><circle cx="10.5" cy="10.5" r="1.4" /><path d="M2 14 14 2" /></>,
    title: '无限画布',
    desc: '剧本、资产、分镜、剪辑一画布贯通',
  },
  {
    icon: <><path d="M8 1.8l1.3 4.9L14.2 8l-4.9 1.3L8 14.2 6.7 9.3 1.8 8l4.9-1.3z" /><path d="M13 12.5v3M11.5 14h3" /></>,
    title: '自动规划 Agent',
    desc: '从一句话需求，规划并执行创作任务',
  },
  {
    icon: <><path d="M8 1.8A6.2 6.2 0 1 1 1.8 8" /><path d="M14.4 1.8v3.2h-3.2" /></>,
    title: '本地优先',
    desc: '自部署管理素材，自由接入模型服务',
  },
];

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string }>;
}) {
  const { from, error } = await searchParams;
  const initialized = hasAdminPassword();
  const oidcProviders = listOidcProviders().filter((provider) => provider.enabled);
  const heading = initialized ? '欢迎回来' : '初始化';
  const subtitle = initialized
    ? '登录 Sakura AI Cut,继续你的创作。'
    : '设置管理员密码,开始使用。';

  return (
    <div className="flex min-h-dvh">
      <style dangerouslySetInnerHTML={{ __html: LOGIN_CSS }} />
      {/* 桌面品牌面板；平板与手机给表单保留完整宽度。 */}
      <aside className="aicut-brand relative hidden w-[44%] shrink-0 flex-col justify-between overflow-hidden bg-[linear-gradient(150deg,#f472b6_0%,#c0559e_45%,#7c3aed_100%)] px-10 py-10 text-white lg:flex xl:px-16">
        <div className="aicut-deco pointer-events-none absolute -bottom-20 -right-16 select-none text-white/10" aria-hidden="true">
          <Flower size={260} maskId="flower-deco" />
        </div>

        <div className="relative flex flex-1 flex-col justify-center">
          <div className="aicut-in inline-flex size-16 items-center justify-center rounded-2xl bg-white/15 shadow-lg shadow-black/10" style={{ animationDelay: '0.05s' }}>
            <Flower size={40} maskId="flower-brand" />
          </div>
          <h1 className="aicut-in mt-7 text-3xl font-bold" style={{ animationDelay: '0.15s' }}>Sakura AI Cut</h1>
          <p className="aicut-in mt-2 text-[15px] text-white/85" style={{ animationDelay: '0.25s' }}>在无限画布上,把一句话长成一部片子。</p>

          <ul className="aicut-in mt-10 list-none space-y-5 p-0" style={{ animationDelay: '0.35s' }}>
            {FEATURES.map((feature) => (
              <li key={feature.title} className="flex items-start gap-3">
                <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/15">
                  <FeatureIcon>{feature.icon}</FeatureIcon>
                </span>
                <span>
                  <b className="block text-sm font-semibold leading-5">{feature.title}</b>
                  <small className="block text-[13px] leading-relaxed text-white/70">{feature.desc}</small>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="aicut-in relative text-xs text-white/60" style={{ animationDelay: '0.55s' }}>Sakura AI Cut · 本地优先的 AI 短剧流水线</p>
      </aside>

      {/* 右:表单面板 */}
      <main className="aicut-form-panel flex min-w-0 flex-1 flex-col items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-md">
          {/* 窄屏紧凑品牌行 */}
          <div className="aicut-in mb-10 flex items-center gap-2.5 lg:hidden" style={{ animationDelay: '0.2s' }}>
            <span className="inline-flex size-8 items-center justify-center rounded-xl bg-pink-500/20 text-pink-400">
              <Flower size={20} maskId="flower-compact" />
            </span>
            <b className="text-[15px] text-slate-100">Sakura AI Cut</b>
          </div>

          <h2 className="aicut-in text-2xl font-semibold tracking-tight text-slate-100" style={{ animationDelay: '0.3s' }}>{heading}</h2>
          <p className="aicut-in mt-2 text-sm text-slate-400" style={{ animationDelay: '0.4s' }}>{subtitle}</p>

          <div className="aicut-in mt-6" style={{ animationDelay: '0.5s' }}>
            {error ? (
              <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-center text-[12px] text-red-300">
                {error}
              </div>
            ) : null}

            <LoginForm mode={initialized ? 'login' : 'setup'} from={from} />
          </div>

          {oidcProviders.length > 0 ? (
            <div className="aicut-in" style={{ animationDelay: '0.6s' }}>
              <div className="my-5 flex items-center gap-3 text-[11px] text-slate-600">
                <span className="h-px flex-1 bg-[#242a36]" />
                <span>或使用第三方登录</span>
                <span className="h-px flex-1 bg-[#242a36]" />
              </div>
              <div className="space-y-2">
                {oidcProviders.map((provider) => {
                  const preset = OIDC_PRESETS[provider.kind];
                  return (
                    <a
                      key={provider.id}
                      href={`/api/auth/login/${provider.kind}${from ? `?from=${encodeURIComponent(from)}` : ''}`}
                      className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#333b4a] bg-[#1a1f28] px-3.5 py-2.5 text-[13px] text-slate-200 transition-colors hover:border-[#4a5568] hover:bg-[#222936]"
                    >
                      <span>{preset.icon}</span>
                      {provider.label || preset.label}
                    </a>
                  );
                })}
              </div>
            </div>
          ) : null}

          <p className="aicut-in mt-8 text-center text-[11px] leading-relaxed text-slate-600" style={{ animationDelay: '0.7s' }}>
            单用户本地应用,不依赖外部登录服务。
            <br />
            本地密码以 scrypt 哈希存储;外部账号使用标准 OIDC 登录。
          </p>
        </div>
      </main>
    </div>
  );
}
