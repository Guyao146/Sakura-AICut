'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field, Input } from '@/components/ui';
import { loginAction, setupAdminPasswordAction } from '@/app/actions/auth';

/**
 * 登录 / 初始化密码表单
 * mode='setup' 时渲染「密码 + 确认密码」，提交后自动登录
 */
export function LoginForm({ mode, from }: { mode: 'login' | 'setup'; from?: string }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result =
        mode === 'login'
          ? await loginAction(password)
          : await setupAdminPasswordAction(password, confirm);
      if (!result.ok) {
        setError(result.error ?? '操作失败');
        setBusy(false);
        return;
      }
      router.replace(from && from.startsWith('/') ? from : '/');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '网络错误');
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="rounded-xl border border-[#242a36] bg-[#12151c] p-6 shadow-xl shadow-black/30"
    >
      {mode === 'setup' ? (
        <>
          <Field label="设置管理员密码" hint="至少 8 位">
            <Input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoFocus
            />
          </Field>
          <Field label="确认密码">
            <Input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </Field>
        </>
      ) : (
        <Field label="管理员密码">
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoFocus
          />
        </Field>
      )}

      {error ? (
        <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
          {error}
        </div>
      ) : null}

      <Button variant="primary" type="submit" loading={busy} className="w-full">
        {mode === 'setup' ? '完成设置并进入' : '登录'}
      </Button>
    </form>
  );
}
