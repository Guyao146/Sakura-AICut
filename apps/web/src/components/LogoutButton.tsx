'use client';

import { useState } from 'react';
import { logoutAction } from '@/app/actions/auth';

/** 顶栏右侧的注销按钮：调用 server action 清除会话后跳登录页 */
export function LogoutButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void logoutAction();
      }}
      className="flex items-center gap-2 rounded-lg border border-[#242a36] px-3 py-2 text-[12px] text-slate-400 transition-colors hover:border-red-500/30 hover:text-red-300 disabled:opacity-50"
    >
      <span>⏻</span>
      {busy ? '正在注销…' : '注销登录'}
    </button>
  );
}
