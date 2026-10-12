'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Card, Empty, Field, Input } from '@/components/ui';
import { cancelPairingAction, createPairingAction, deleteGrantAction, readPeerTopicsAction, refreshEcosystemAction, revokeGrantAction } from '@/app/actions/ecosystem';
import type { GrantView, PairingView, SharedTopicView } from '@/lib/ecosystem';

const time = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false });
export function EcosystemTab({ data }: { data: { pairings: PairingView[]; grants: GrantView[] } }) {
  const [name, setName] = useState('SakuraSeeking');
  const [peerBaseUrl, setPeerBaseUrl] = useState('http://127.0.0.1:3210');
  const [allowRender, setAllowRender] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [view, setView] = useState(data);
  const [now, setNow] = useState<number | null>(null);
  const [topics, setTopics] = useState<Record<string, SharedTopicView[]>>({});
  useEffect(() => { setView(data); }, [data]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  async function refresh() {
    const result = await refreshEcosystemAction();
    if (!result.ok) throw new Error(result.error);
    setView(result.data);
  }
  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) void refresh().catch(() => {}); }, 10_000);
    return () => clearInterval(timer);
  }, []);
  async function run(work: () => Promise<void>) {
    setBusy(true); setMessage('');
    try { await work(); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : '操作失败，请重试'); }
    finally { setBusy(false); }
  }
  return <div className="space-y-4">
    <Card title="生态授权" extra={<Badge tone="pink">一次性配对 · 双向授权</Badge>}>
      <p className="text-xs leading-6 text-slate-400">在这里生成配对码，然后到 SakuraSeeking 的「连接与授权」输入。名称和对端地址必须一致；配对码有效 10 分钟。默认仅可创建与读取该授权关联的项目、查询任务状态。双方都可撤销授权，静态 Key 不受影响。</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="应用名称"><Input aria-label="应用名称" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} /></Field>
        <Field label="对端服务地址" hint="从制作端能够访问的最终地址"><Input aria-label="对端服务地址" value={peerBaseUrl} maxLength={2048} onChange={(event) => setPeerBaseUrl(event.target.value)} /></Field>
      </div>
      <label className="mb-4 flex items-center gap-2 text-xs text-slate-400"><input type="checkbox" checked={allowRender} onChange={(event) => setAllowRender(event.target.checked)} />另外授权提交渲染（消耗制作资源；不会自动执行）</label>
      <Button variant="primary" disabled={busy || !name.trim() || !peerBaseUrl.trim()} onClick={() => void run(async () => {
        const result = await createPairingAction({ name, peerBaseUrl, allowRender });
        if (!result.ok) throw new Error(result.error);
        setView((current) => ({ ...current, pairings: [result.data, ...current.pairings] }));
      })}>生成配对码</Button>
      <div className="mt-4 space-y-2">{!view.pairings.length ? <Empty text="暂无待使用的配对码" /> : view.pairings.map((pairing) => {
        const seconds = now === null ? null : Math.max(0, Math.ceil((Date.parse(pairing.expiresAt) - now) / 1000));
        return <div key={pairing.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-pink-400/30 p-3">
          <div className="min-w-0 flex-1"><strong className="font-mono text-xl tracking-[0.3em] text-pink-300">{pairing.code}</strong><div className="mt-1 break-all text-xs text-slate-400">{pairing.name} · {pairing.peerBaseUrl}</div><small className="text-slate-500">{seconds === null ? `失效于 ${time(pairing.expiresAt)}` : seconds === 0 ? '已过期' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} 后失效`}</small></div>
          <Button size="sm" onClick={() => void navigator.clipboard.writeText(pairing.code).then(() => setMessage('配对码已复制')).catch(() => setMessage('无法访问剪贴板，请手动复制'))}>复制</Button>
          <Button size="sm" disabled={busy} onClick={() => void run(async () => { const result = await cancelPairingAction({ id: pairing.id }); if (!result.ok) throw new Error(result.error); })}>取消</Button>
        </div>;
      })}</div>
    </Card>
    <Card title="已授权的应用" extra={<Button size="sm" disabled={busy} onClick={() => void run(async () => {})}>刷新连接</Button>}>
      {!view.grants.length ? <Empty text="尚未建立连接" /> : <div className="space-y-3">{view.grants.map((grant) => <div key={grant.id} className="rounded-lg border border-ink-600 p-3">
        <div className="flex flex-wrap items-center gap-2"><strong className="text-sm">{grant.name}</strong><Badge tone={grant.revokedAt ? 'red' : 'green'}>{grant.revokedAt ? '已吊销' : '已授权'}</Badge><span className="text-xs text-slate-500">{time(grant.pairedAt)}</span></div>
        <p className="my-2 break-all text-xs text-slate-400">{grant.peerBaseUrl}<br />权限：{grant.scope}</p>
        <div className="flex flex-wrap gap-2">{!grant.revokedAt && <Button size="sm" disabled={busy} onClick={() => void run(async () => {
          const result = await readPeerTopicsAction({ id: grant.id });
          if (!result.ok) throw new Error(result.error);
          setTopics((current) => ({ ...current, [grant.id]: result.data }));
          setMessage(`已读取 ${result.data.length} 条明确共享的来源选题`);
        })}>读取共享选题</Button>}
          <Button size="sm" variant={grant.revokedAt ? 'ghost' : 'danger'} disabled={busy} onClick={() => {
            if (!grant.revokedAt && !window.confirm('撤销这项双向授权？已创建的项目不会删除。')) return;
            void run(async () => {
              const result = await revokeGrantAction({ id: grant.id });
              if (!result.ok) throw new Error(result.error);
              setTopics((current) => { const next = { ...current }; delete next[grant.id]; return next; });
              setMessage(result.data.notified ? '双向授权已撤销' : '本机已吊销；对端通知失败。后续调用会验证授权，恢复网络后可重试通知。');
            });
          }}>{grant.revokedAt ? '重试通知对端' : '吊销授权'}</Button>
          {grant.revokedAt && <Button size="sm" disabled={busy} onClick={() => void run(async () => { const result = await deleteGrantAction({ id: grant.id }); if (!result.ok) throw new Error(result.error); })}>删除记录</Button>}
        </div>
        {!grant.revokedAt && topics[grant.id] && <div className="mt-3 space-y-2">{topics[grant.id].length === 0 ? <Empty text="对端尚未共享带来源的选题；浏览器收藏不会自动上传" /> : topics[grant.id].map((topic) => <article key={topic.key} className="rounded border border-ink-600 p-3 text-xs">
          <strong>{topic.title}</strong><p className="my-2 text-slate-400">{topic.reason}</p><a href={topic.source.sourceUrl} target="_blank" rel="noreferrer" className="text-pink-300">{topic.source.sourceName} · 查看原始来源 ↗</a><p className="mt-1 text-slate-500">平台：{topic.source.platform ?? '未标注'} · 采集：{time(topic.source.observedAt)} · 来源快照，仍需核验</p>
        </article>)}</div>}
      </div>)}</div>}
    </Card>
    {message && <p role="status" className="rounded-lg border border-pink-400/20 p-3 text-xs leading-6 text-pink-300">{message}</p>}
    <p className="text-xs leading-6 text-slate-500">凭证仅存于服务端。公网服务需 HTTPS；仅信任自己部署的服务地址。本页面读取的是对端主动共享的快照，不会自动创建项目、导入剧本或调用生成模型。</p>
  </div>;
}