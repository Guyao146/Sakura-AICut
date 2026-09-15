'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, Empty, Select, Textarea } from '@/components/ui';
import { clearChatAction, sendChatAction } from '@/app/actions/project';
import type { PromptTemplate } from '@sakura/core';

/**
 * 第二步的 AI 小助手：带项目上下文的多轮对话，可挂提示词库模板
 */

interface Message {
  id: string;
  role: string;
  content: string;
}

export function ScriptAssistant({
  projectId,
  initialMessages,
  promptTemplates = [],
}: {
  projectId: string;
  initialMessages: Message[];
  promptTemplates?: PromptTemplate[];
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, busy]);

  async function send() {
    if (!input.trim() || busy) return;
    const text = input.trim();
    setInput('');
    setError(null);
    setBusy(true);
    setMessages((prev) => [...prev, { id: `local_${Date.now()}`, role: 'user', content: text }]);

    const result = await sendChatAction(projectId, text, { templateId: templateId || undefined });
    if (result.ok && result.data) {
      setMessages(result.data.history.map((item) => ({ id: item.id, role: item.role, content: item.content })));
      router.refresh();
    } else {
      setError(result.error ?? '生成失败');
    }
    setBusy(false);
  }

  const templates = promptTemplates.filter((template) => template.category === 'screenplay');

  return (
    <div className="rounded-lg border border-[#242a36] bg-[#0e1116] p-2">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Badge tone="pink">AI 小助手</Badge>
          <span className="text-[11px] text-slate-500">可写剧本 / 改台词 / 出反转</span>
        </div>
        <div className="flex items-center gap-1">
          {templates.length > 0 && (
            <Select
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
              className="!w-32 !py-0.5 !text-[11px]"
            >
              <option value="">不使用模板</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </Select>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              const result = await clearChatAction(projectId);
              if (result.ok) {
                setMessages([]);
                router.refresh();
              }
            }}
          >
            清空
          </Button>
        </div>
      </div>

      <div className="mb-2 max-h-[260px] space-y-2 overflow-y-auto pr-1">
        {messages.length === 0 ? (
          <Empty text="试试问：「帮我写一段 90 秒的都市逆袭短剧大纲」" />
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={
                message.role === 'user'
                  ? 'ml-6 rounded-lg bg-pink-500/10 p-2 text-[12px] leading-relaxed text-pink-50'
                  : 'mr-6 rounded-lg bg-white/5 p-2 text-[12px] leading-relaxed text-slate-200'
              }
            >
              <div className="mb-0.5 text-[10px] text-slate-500">{message.role === 'user' ? '我' : '助手'}</div>
              <div className="whitespace-pre-wrap">{message.content}</div>
            </div>
          ))
        )}
        {busy && <div className="text-[11px] text-slate-500">助手正在思考…</div>}
        <div ref={bottomRef} />
      </div>

      {error && <div className="mb-2 rounded-md border border-red-500/30 bg-red-500/10 p-2 text-[11px] text-red-300">{error}</div>}

      <Textarea
        rows={2}
        value={input}
        placeholder="描述你的需求，Enter 发送（Shift+Enter 换行）"
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void send();
          }
        }}
      />
      <div className="mt-2 flex justify-end">
        <Button variant="primary" size="sm" loading={busy} onClick={() => void send()}>
          发送
        </Button>
      </div>
    </div>
  );
}
