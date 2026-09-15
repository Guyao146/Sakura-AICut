import type { AgentChatMessage } from '@sakura/core';
import { SCRIPT_ASSISTANT_SYSTEM_PROMPT, renderTemplate } from '@sakura/core';
import { addChatMessage, getPromptTemplate, getScreenplay, incrementPromptUse, listChatMessages, loadContent } from '@sakura/db';
import { runText } from './ai';

/**
 * 第二步「AI 小助手」对话：带项目上下文的多轮对话，回复可直接粘贴进剧本
 */

export interface AssistantChatOptions {
  scope?: AgentChatMessage['scope'];
  /** 引用提示词库模板（会先渲染变量再发送） */
  templateId?: string;
  templateVars?: Record<string, string>;
  temperature?: number;
}

export async function assistantChat(
  projectId: string,
  message: string,
  options: AssistantChatOptions = {},
): Promise<{ reply: string; model?: string; history: AgentChatMessage[] }> {
  const scope = options.scope ?? 'screenplay';
  const content = loadContent(projectId);
  const screenplay = getScreenplay(projectId);

  const projectContext = [
    `【项目设定】名称：${content.project.brief.name}；题材：${content.project.brief.genres.join('、')}；风格：${content.project.brief.style}；画幅：${content.project.brief.aspectRatio}；目标时长：${content.project.brief.targetDurationSec} 秒；语言：${content.project.brief.language}`,
    screenplay
      ? `【现有剧本】标题：${screenplay.title}\n梗概：${screenplay.synopsis || '（空）'}\n人物：${screenplay.characters
          .map((c) => `${c.name}（${c.role}，${c.age}，${c.appearance}）`)
          .join('；') || '（空）'}\n场景：${screenplay.locations.map((l) => l.name).join('、') || '（空）'}\n节拍：${screenplay.beats
          .map((b, i) => `${i + 1}.${b.title}`)
          .join(' → ') || '（空）'}`
      : '【现有剧本】尚未生成，可以从零开始创作。',
  ].join('\n\n');

  let finalUserMessage = message;
  if (options.templateId) {
    const template = getPromptTemplate(options.templateId);
    if (template) {
      const rendered = renderTemplate(template.template, {
        ...(options.templateVars ?? {}),
        projectName: content.project.brief.name,
        genre: content.project.brief.genres.join('、'),
        style: content.project.brief.style,
        duration: String(content.project.brief.targetDurationSec),
      });
      finalUserMessage = `${rendered}\n\n---\n附加要求：${message}`;
      incrementPromptUse(template.id);
    }
  }

  const history = listChatMessages(projectId, scope, 20).filter((item) => item.role !== 'system');
  const reply = await runText({
    messages: [
      { role: 'system', content: `${SCRIPT_ASSISTANT_SYSTEM_PROMPT}\n\n${projectContext}` },
      ...history.map((item) => ({
        role: item.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: item.content,
      })),
      { role: 'user', content: finalUserMessage },
    ],
    temperature: options.temperature ?? 0.8,
    maxTokens: 4000,
  });

  addChatMessage({ projectId, scope, role: 'user', content: message, templateId: options.templateId ?? null });
  addChatMessage({
    projectId,
    scope,
    role: 'assistant',
    content: reply.text,
    model: reply.model ?? null,
    tokenUsage: reply.usage?.totalTokens ?? null,
  });

  return { reply: reply.text, model: reply.model, history: listChatMessages(projectId, scope, 50) };
}
