'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { connectGatewayAction, refreshGatewayAction } from '@/app/actions/gateway';
import { revokeGatewayAuthorizationAction, startGatewayAuthorizationAction, syncAuthorizedGatewayAction } from '@/app/actions/gateway-oauth';
import type { GatewayConnectionSummary, GatewaySyncResult } from '@/lib/gateway';
import { Button, Card, Field, Input, Select } from '@/components/ui';

export function GatewayConnectCard({ connections, authorization }: {
  connections: GatewayConnectionSummary[];
  authorization: { authorized: boolean; gatewayUrl: string };
}) {
  const router = useRouter();
  const [providerId, setProviderId] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [name, setName] = useState('');
  const [allowPrivateNetwork, setAllowPrivateNetwork] = useState(false);
  const [renewAuthorization, setRenewAuthorization] = useState(false);
  const [busy, setBusy] = useState<'connect' | 'refresh' | 'authorize' | 'sync' | 'revoke' | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<GatewaySyncResult | null>(null);
  const [authorizationUrl, setAuthorizationUrl] = useState('');
  const [authorizationError, setAuthorizationError] = useState('');
  const [authorizationNotice, setAuthorizationNotice] = useState('');
  const previousConnections = useRef(connections);
  const selected = connections.find((connection) => connection.providerId === providerId)
    ?? (result?.connection.providerId === providerId ? result.connection : undefined);

  useEffect(() => {
    if (providerId && previousConnections.current.some((item) => item.providerId === providerId)
      && !connections.some((item) => item.providerId === providerId)) {
      setProviderId('');
      setBaseUrl('');
      setApiKey('');
      setName('');
      setAllowPrivateNetwork(false);
      setRenewAuthorization(false);
      setResult(null);
      setError('');
    }
    previousConnections.current = connections;
  }, [connections, providerId]);

  function selectConnection(id: string) {
    const connection = connections.find((item) => item.providerId === id);
    setProviderId(id);
    setBaseUrl(connection?.baseUrl ?? '');
    setName(connection?.name ?? '');
    setAllowPrivateNetwork(connection?.allowPrivateNetwork ?? false);
    setApiKey('');
    setRenewAuthorization(false);
    setResult(null);
    setError('');
  }

  async function run(operation: 'connect' | 'refresh') {
    if (busy) return;
    setBusy(operation);
    setError('');
    setResult(null);
    setAuthorizationError('');
    setAuthorizationNotice('');
    try {
      const response = operation === 'refresh'
        ? await refreshGatewayAction(providerId)
        : await connectGatewayAction({ providerId: providerId || undefined, baseUrl, apiKey, name, allowPrivateNetwork, renewAuthorization });
      if (!response.ok || !response.data) {
        setError(response.error ?? '网关接入失败，请重试');
        return;
      }
      const value = response.data;
      setResult(value);
      setProviderId(value.connection.providerId);
      setBaseUrl(value.connection.baseUrl);
      setName(value.connection.name);
      setApiKey('');
      setRenewAuthorization(false);
      router.refresh();
    } catch {
      setError('请求未完成，请检查网络或重新登录后重试');
    } finally { setBusy(null); }
  }

  async function startAuthorization() {
    if (busy) return;
    setBusy('authorize');
    setAuthorizationError('');
    setAuthorizationNotice('');
    try {
      const response = await startGatewayAuthorizationAction(authorizationUrl || authorization.gatewayUrl || baseUrl);
      if (!response.ok || !response.data) {
        setAuthorizationError(response.error ?? '无法发起账号授权，请检查网址');
        return;
      }
      // 由网关页面登录并确认授权；本站不接触网关账号密码。
      window.location.href = response.data.authorizeUrl;
    } catch {
      setAuthorizationError('无法跳转到网关授权页，请稍后重试');
    } finally { setBusy(null); }
  }

  async function syncAuthorization() {
    if (busy) return;
    setBusy('sync');
    setAuthorizationError('');
    setAuthorizationNotice('');
    try {
      const response = await syncAuthorizedGatewayAction();
      if (!response.ok || !response.data) {
        setAuthorizationError(response.error ?? '同步网关配置失败，请重试');
        return;
      }
      setResult(response.data);
      setProviderId(response.data.connection.providerId);
      setBaseUrl(response.data.connection.baseUrl);
      setName(response.data.connection.name);
      setAuthorizationNotice('已使用账号授权同步模型配置');
      router.refresh();
    } catch {
      setAuthorizationError('同步网关配置失败，请稍后重试');
    } finally { setBusy(null); }
  }

  async function revokeAuthorization() {
    if (busy) return;
    setBusy('revoke');
    setAuthorizationError('');
    setAuthorizationNotice('');
    try {
      const response = await revokeGatewayAuthorizationAction();
      if (!response.ok) {
        setAuthorizationError(response.error ?? '取消授权失败，请重试');
        return;
      }
      setAuthorizationNotice('已取消保存在本站的网关账号授权');
      router.refresh();
    } catch {
      setAuthorizationError('取消授权失败，请稍后重试');
    } finally { setBusy(null); }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run('connect');
  }

  const authorizationGateway = authorization.gatewayUrl || result?.connection.baseUrl;
  const authorized = authorization.authorized || Boolean(result);
  const connection = result?.connection ?? selected;
  return (
    <Card title="网关快捷接入">
      <form onSubmit={submit} aria-label="网关快捷接入" aria-busy={Boolean(busy)} className="min-w-0">
        <p className="mb-3 text-xs leading-6 text-slate-400">
          输入部署网址，登录网关账号并确认授权后自动拉取可用模型；也可以直接填写网关本地调用 Key 验证权限。
          账号授权只读取模型配置，不会拿到你的账号密码或原始调用 Key。
        </p>
        <div className="mb-4 rounded-lg border border-ink-600 bg-ink-800/50 p-3">
          <div className="text-xs font-medium text-slate-200">账号授权（推荐）</div>
          <div className="mt-2 grid gap-x-4 sm:grid-cols-2">
            <Field label="网关部署网址" hint="用于账号授权；填写部署根网址">
              <Input aria-label="账号授权网关网址" type="url" maxLength={2048} value={authorizationUrl} disabled={Boolean(busy)}
                placeholder={authorizationGateway || 'https://gateway.example.com'} onChange={(event) => setAuthorizationUrl(event.target.value)} />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="primary" loading={busy === 'authorize'} disabled={Boolean(busy) || (!authorizationUrl.trim() && !authorizationGateway)}
              onClick={() => void startAuthorization()}>
              登录网关并授权
            </Button>
            {authorized ? <Button type="button" loading={busy === 'sync'} disabled={Boolean(busy)} onClick={() => void syncAuthorization()}>
              同步授权配置
            </Button> : null}
            {authorized ? <Button type="button" variant="ghost" loading={busy === 'revoke'} disabled={Boolean(busy)} onClick={() => void revokeAuthorization()}>
              取消账号授权
            </Button> : null}
          </div>
          {authorizationError ? <p role="alert" className="mt-3 text-xs leading-6 text-red-300">{authorizationError}</p> : null}
          {authorizationNotice ? <p role="status" className="mt-3 text-xs leading-6 text-emerald-300">{authorizationNotice}</p> : null}
          {authorized ? <p className="mt-2 break-all text-[11px] leading-5 text-slate-500">
            已授权：{authorizationGateway}。访问令牌保存在本站；模型调用仍由网关侧使用来源 Key 转发，不会暴露原始 Key。
          </p> : <p className="mt-2 text-[11px] leading-5 text-slate-500">
            授权后网关会自动登记本站应用；之后可以为其他网关再单独授权。回调地址由本站部署根网址生成，和回调网址不同的部署需配置 SAKURA_PUBLIC_BASE_URL。
          </p>}
        </div>
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">或使用本地调用 Key</div>
        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label="接入记录">
            <Select aria-label="网关接入记录" value={providerId} disabled={Boolean(busy)} onChange={(event) => selectConnection(event.target.value)}>
              <option value="">新增网关接入</option>
              {connections.map((item) => <option key={item.providerId} value={item.providerId}>{item.name} · {item.baseUrl}</option>)}
              {result && !connections.some((item) => item.providerId === result.connection.providerId)
                ? <option value={result.connection.providerId}>{result.connection.name}</option> : null}
            </Select>
          </Field>
          <Field label="接入名称" hint="可选">
            <Input aria-label="网关接入名称" value={name} maxLength={100} disabled={Boolean(busy)} placeholder="网关接入" onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="网关部署网址" hint="填写部署根网址，可包含路径前缀">
            <Input aria-label="网关部署网址" type="url" required value={baseUrl} maxLength={2048} readOnly={Boolean(providerId)} disabled={Boolean(busy)} placeholder="https://gateway.example.com" onChange={(event) => setBaseUrl(event.target.value)} />
          </Field>
          <Field label="本地调用 Key" hint={providerId ? '留空保留已加密保存的 Key' : '在网关的本地调用 Key 页面获取'}>
            <Input aria-label="网关本地调用 Key" type="password" autoComplete="off" spellCheck={false} required={!providerId} value={apiKey} maxLength={4096} disabled={Boolean(busy)} onChange={(event) => setApiKey(event.target.value)} />
          </Field>
        </div>
        <label className="mb-2 flex items-start gap-2 text-xs leading-5 text-slate-400">
          <input className="mt-1" type="checkbox" checked={allowPrivateNetwork} disabled={Boolean(busy)} onChange={(event) => setAllowPrivateNetwork(event.target.checked)} />
          <span>允许本机 / 内网地址（仅连接可信部署；HTTP 会明文传输 Key）</span>
        </label>
        {providerId ? <label className="mb-2 flex items-start gap-2 text-xs leading-5 text-slate-400">
          <input className="mt-1" type="checkbox" checked={renewAuthorization} disabled={Boolean(busy)} onChange={(event) => setRenewAuthorization(event.target.checked)} />
          <span>重新登记接入授权（原授权失效时使用，将在网关创建新记录）</span>
        </label> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="submit" variant="primary" loading={busy === 'connect'} disabled={Boolean(busy) || !baseUrl.trim() || (!providerId && !apiKey.trim())}>
            验证并拉取配置
          </Button>
          {providerId ? <Button type="button" loading={busy === 'refresh'} disabled={Boolean(busy) || Boolean(apiKey) || renewAuthorization || allowPrivateNetwork !== selected?.allowPrivateNetwork} onClick={() => void run('refresh')}>
            刷新已保存配置
          </Button> : null}
        </div>
        {error ? <p role="alert" className="mt-3 text-xs leading-6 text-red-300">{error}</p> : null}
        {result ? <p role="status" className="mt-3 text-xs leading-6 text-emerald-300">
          {result.created ? '已验证并接入' : '已验证并同步'}，共 {result.connection.modelCount} 个可用模型。凭据已加密保存。
        </p> : null}
        {result?.warning ? <p role="status" className="mt-2 text-xs leading-6 text-amber-300">{result.warning}</p> : null}
        {connection ? <dl className="mt-3 grid gap-2 rounded-lg border border-ink-600 bg-ink-800/50 p-3 text-xs sm:grid-cols-2">
          <div className="min-w-0"><dt className="text-slate-500">调用 Key</dt><dd className="mt-1 break-words text-slate-300">{connection.keyName || '未命名'}</dd></div>
          <div><dt className="text-slate-500">上次同步权限</dt><dd className="mt-1 text-slate-300">{connection.modelAccessMode === 'all' ? '全部已发布模型' : '受限模型'} · {connection.modelCount} 个</dd></div>
          <div><dt className="text-slate-500">网关版本</dt><dd className="mt-1 text-slate-300">{connection.gatewayVersion}</dd></div>
          <div><dt className="text-slate-500">上次同步</dt><dd className="mt-1 break-all text-slate-300">{connection.syncedAt}</dd></div>
        </dl> : null}
        <p className="mt-3 text-[11px] leading-5 text-slate-500">
          仅导入文本对话模型，不导入网关上游密钥，不改动已有模型路由。可在「模型路由」选择文本默认模型。接入令牌只用于配置同步，模型调用仍使用本地调用 Key；取消授权不等于停用调用 Key。
        </p>
      </form>
    </Card>
  );
}