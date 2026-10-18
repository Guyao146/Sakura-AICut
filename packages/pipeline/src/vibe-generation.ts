import type { VibeScript } from '@sakura/core';
import {
  VIBE_CODE_SYSTEM_PROMPT, VIBE_SCRIPT_SYSTEM_PROMPT, assertProtocolStub,
  extractHtmlDocument, extractJson, parseWithSchema, vibeInstructionsSchema,
  vibeMetaFor, vibeScriptSchema, vibeTopicSchema,
} from '@sakura/core';
import { getProject } from '@sakura/db';
import { runText } from './ai';
import { requireVibeProject } from './vibe-jobs';

export { planVibeFrames, extractHtmlDocument, assertProtocolStub, vibeScriptDuration } from '@sakura/core';

export interface VibeGenerationOptions {
  instructions?: string;
  temperature?: number;
  isCanceled?: () => boolean;
}

function assertNotCanceled(options: VibeGenerationOptions): void {
  if (options.isCanceled?.()) throw new Error('任务已取消，忽略迟到的模型响应');
}

/** 生成只返回经校验的数据；落库由任务编排层持有版本与取消检查。 */
export async function generateVibeScript(
  projectId: string,
  topic: string,
  options: VibeGenerationOptions = {},
): Promise<VibeScript> {
  requireVibeProject(projectId);
  const brief = getProject(projectId)!.brief;
  const validTopic = vibeTopicSchema.parse(topic);
  const instructions = vibeInstructionsSchema.parse(options.instructions);
  assertNotCanceled(options);
  const { text } = await runText({
    messages: [
      { role: 'system', content: VIBE_SCRIPT_SYSTEM_PROMPT },
      { role: 'user', content: [
        `主题：${validTopic}`, `视觉风格：${brief.style}`, `画幅：${brief.aspectRatio}`,
        `目标时长：${brief.targetDurationSec} 秒，总时长必须不超过 150 秒。`,
        `字幕语言：${brief.language}`, instructions,
      ].filter(Boolean).join('\n') },
    ],
    json: true, temperature: options.temperature ?? 0.8, maxTokens: 6000,
  });
  assertNotCanceled(options);
  const script = parseWithSchema(vibeScriptSchema, extractJson(text), 'Vibe 视频脚本');
  vibeMetaFor(brief, script);
  return script;
}

export async function generateVibeCode(projectId: string, options: VibeGenerationOptions = {}): Promise<string> {
  const vibe = requireVibeProject(projectId);
  if (!vibe.script) throw new Error('尚未生成视频脚本，请先执行第一步');
  const brief = getProject(projectId)!.brief;
  const script = parseWithSchema(vibeScriptSchema, vibe.script, 'Vibe 视频脚本');
  const meta = vibeMetaFor(brief, script);
  const instructions = vibeInstructionsSchema.parse(options.instructions);
  assertNotCanceled(options);
  const { text } = await runText({
    messages: [
      { role: 'system', content: VIBE_CODE_SYSTEM_PROMPT },
      { role: 'user', content: [
        `视觉风格：${brief.style}`, `字幕语言：${brief.language}`,
        `window.__vibeMeta 必须精确等于：${JSON.stringify(meta)}`,
        `分镜脚本 JSON：${JSON.stringify(script)}`, instructions,
      ].filter(Boolean).join('\n') },
    ],
    temperature: options.temperature ?? 0.4, maxTokens: 16000,
  });
  assertNotCanceled(options);
  const code = extractHtmlDocument(text);
  assertProtocolStub(code);
  return code;
}
