import { hasAdminPassword, listOidcProviders, OIDC_PRESETS } from '@sakura/db';
import { LoginForm } from '@/components/LoginForm';

/**
 * 登录页：三种登录方式
 *  1. 本地账户密码（首次进入时在此初始化）
 *  2. Sakura 账号（Sakura-Auth-Server，可选）
 *  3. 通用 OIDC（可选）
 * 后两者由设置页接入后才显示按钮。
 */
export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string }>;
}) {
  const { from, error } = await searchParams;
  const initialized = hasAdminPassword();
  const oidcProviders = listOidcProviders().filter((provider) => provider.enabled);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0d12] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mb-3 text-3xl">🌸</div>
          <h1 className="text-base font-semibold text-slate-100">Sakura AI Cut</h1>
          <p className="mt-1 text-xs text-slate-500">
            {initialized ? '请选择登录方式' : '首次使用 · 请设置管理员密码'}
          </p>
        </div>

        {error ? (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-center text-[12px] text-red-300">
            {error}
          </div>
        ) : null}

        <LoginForm mode={initialized ? 'login' : 'setup'} from={from} />

        {oidcProviders.length > 0 ? (
          <>
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
          </>
        ) : null}

        <p className="mt-6 text-center text-[11px] leading-relaxed text-slate-600">
          单用户本地应用，不依赖外部登录服务。
          <br />
          本地密码以 scrypt 哈希存储；外部账号使用标准 OIDC 登录。
        </p>
      </div>
    </div>
  );
}
