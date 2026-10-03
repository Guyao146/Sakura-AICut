'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, Card, Empty, Field, Input } from '@/components/ui';
import { deleteOidcProviderAction, saveOidcProviderAction, toggleOidcProviderAction } from '@/app/actions/oidc';
import type { SettingsData } from './SettingsClient';

/**
 * 第三方登录标签页：接入 Sakura-Auth-Server 或 通用 OIDC
 * 两者都是标准 OIDC（授权码 + PKCE），填 issuer / client_id / client_secret 即可
 *
 * 注意：不从 @sakura/db 导入运行时常量（OIDC_PRESETS），否则会把 node:sqlite
 * 打进客户端 bundle；预设值在此本地维护，与服务端保持一致。
 */
type OidcProviderKind = 'sakura' | 'authentik';

const PRESETS: Record<OidcProviderKind, { label: string; scope: string; icon: string }> = {
  sakura: { label: 'Sakura 账号', scope: 'openid profile email', icon: '🌸' },
  authentik: { label: '通用 OIDC', scope: 'openid profile email', icon: '🔐' },
};

interface OidcProviderRow {
  id: string;
  name: string;
  kind: OidcProviderKind;
  issuer: string;
  clientId: string;
  hasSecret: boolean;
  scope: string;
  enabled: boolean;
  label: string;
}

function emptyForm(kind: OidcProviderKind): OidcProviderRow {
  return {
    id: '',
    name: PRESETS[kind].label,
    kind,
    issuer: kind === 'sakura' ? 'http://localhost:9000' : '',
    clientId: '',
    hasSecret: false,
    scope: PRESETS[kind].scope,
    enabled: true,
    label: '',
  };
}

export function OidcTab({ data }: { data: SettingsData }) {
  const router = useRouter();
  const providers = data.oidcProviders;
  const [editing, setEditing] = useState<OidcProviderRow | null>(null);
  const [secretInput, setSecretInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = (row: OidcProviderRow) => {
    setSecretInput('');
    setError(null);
    setEditing(row);
  };

  const save = async () => {
    if (!editing || busy) return;
    setBusy(true);
    setError(null);
    const result = await saveOidcProviderAction({
      id: editing.id || undefined,
      name: editing.name,
      kind: editing.kind,
      issuer: editing.issuer,
      clientId: editing.clientId,
      // 新建时直接写入；编辑时空串表示「不修改」（updateOidcProvider 同语义）
      clientSecret: secretInput.trim() || undefined,
      scope: editing.scope,
      enabled: editing.enabled,
      label: editing.label,
    });
    if (!result.ok) {
      setError(result.error ?? '保存失败');
      setBusy(false);
      return;
    }
    setEditing(null);
    router.refresh();
    setBusy(false);
  };

  if (editing) {
    return (
      <Card title={editing.id ? `编辑「${editing.name}」` : `接入 ${PRESETS[editing.kind].label}`}>
        <div className="grid gap-3 lg:grid-cols-2">
          <Field label="名称" hint="显示在登录按钮与管理列表">
            <Input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} />
          </Field>
          <Field label="登录按钮文案" hint="留空用预设">
            <Input
              value={editing.label}
              onChange={(event) => setEditing({ ...editing, label: event.target.value })}
              placeholder={PRESETS[editing.kind].label}
            />
          </Field>
          <Field label="Issuer" hint="OIDC 签发地址">
            <Input
              value={editing.issuer}
              onChange={(event) => setEditing({ ...editing, issuer: event.target.value })}
              placeholder="https://auth.example.com"
            />
          </Field>
          <Field label="Client ID">
            <Input value={editing.clientId} onChange={(event) => setEditing({ ...editing, clientId: event.target.value })} />
          </Field>
          <Field label="Client Secret" hint="公开客户端（PKCE 无密钥）留空；编辑时不填表示不修改">
            <Input
              type="password"
              value={secretInput}
              onChange={(event) => setSecretInput(event.target.value)}
              placeholder={editing.hasSecret ? '已配置（不填表示不修改）' : '公开客户端留空'}
            />
          </Field>
          <Field label="Scope" hint="默认 openid profile email">
            <Input value={editing.scope} onChange={(event) => setEditing({ ...editing, scope: event.target.value })} />
          </Field>
        </div>
        <div className="mb-3 rounded-lg border border-[#2b3240] bg-[#12151c] p-3 text-[11px] leading-relaxed text-slate-500">
          回调地址（在提供商控制台注册）：
          <br />
          <code className="text-slate-400">
            {typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'}/api/auth/callback/{editing.kind}
          </code>
          <br />
          两类提供商均走标准 OAuth2 授权码 + PKCE。Sakura-Auth-Server 建议公开客户端（不带密钥）；
          通用 OIDC 建议机密客户端并填 Client Secret。
        </div>
        {error ? (
          <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">{error}</div>
        ) : null}
        <div className="flex gap-2">
          <Button variant="primary" loading={busy} onClick={save}>
            保存
          </Button>
          <Button variant="ghost" onClick={() => setEditing(null)} disabled={busy}>
            取消
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card title="已接入的登录方式">
        {providers.length === 0 ? (
          <Empty text="尚未接入任何第三方登录。下面选一个开始。" />
        ) : (
          <div className="space-y-2">
            {providers.map((provider) => (
              <div
                key={provider.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-[#242a36] bg-[#12151c] px-3 py-2.5"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="text-lg">{PRESETS[provider.kind].icon}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-slate-200">{provider.name}</span>
                      <Badge tone={provider.enabled ? 'green' : 'default'}>{provider.enabled ? '已启用' : '已停用'}</Badge>
                      <Badge tone="blue">{provider.kind === 'sakura' ? 'Sakura' : '通用 OIDC'}</Badge>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-slate-500">
                      {provider.issuer} · {provider.clientId}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await toggleOidcProviderAction(provider.id, !provider.enabled);
                      router.refresh();
                    }}
                  >
                    {provider.enabled ? '停用' : '启用'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => startEdit(provider)}>
                    编辑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await deleteOidcProviderAction(provider.id);
                      router.refresh();
                    }}
                  >
                    删除
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="接入新的登录方式">
        <div className="grid gap-3 lg:grid-cols-2">
          <Button variant="default" onClick={() => startEdit(emptyForm('sakura'))} className="h-auto justify-start py-4">
            <span className="mr-2 text-xl">🌸</span>
            <div className="text-left">
              <div className="text-[13px] font-medium">Sakura 账号</div>
              <div className="text-[11px] text-slate-500">Sakura-Auth-Server，轻量自托管 IdP</div>
            </div>
          </Button>
          <Button variant="default" onClick={() => startEdit(emptyForm('authentik'))} className="h-auto justify-start py-4">
            <span className="mr-2 text-xl">🔐</span>
            <div className="text-left">
              <div className="text-[13px] font-medium">通用 OIDC</div>
              <div className="text-[11px] text-slate-500">标准 OIDC / OAuth2 提供商</div>
            </div>
          </Button>
        </div>
        <div className="mt-3 text-[11px] leading-relaxed text-slate-500">
          三种登录方式可共存：本地密码始终可用，第三方登录按需接入、可随时停用。
          <br />
          两类提供商都走标准 OIDC（授权码 + PKCE），回调地址在编辑表单里给出。
        </div>
      </Card>
    </div>
  );
}
