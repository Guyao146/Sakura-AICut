import type { ReplicateAnalysis } from '@sakura/core';
import { runText } from './ai';

/**
 * 爆款复刻（⑩，对齐小云雀爆款复刻入口）
 *
 * 输入参考视频链接或文案，让文本模型拆解「为什么火」（钩子、结构、节奏、画风），
 * 再据此产出一份可落地的新剧本大纲。纯文本推理，不调用视频模型。
 */

const REPLICATE_SYSTEM_PROMPT = `你是一位短视频爆款拆解专家。用户会给你一个参考视频的链接或文案，你需要：
1. 分析它为什么火（开头 3 秒钩子、情绪曲线、反转设计、结尾行动号召）
2. 拆解它的文案结构与叙事节奏
3. 判断它的画风、配乐与剪辑风格
4. 提炼可复用的分镜手法
5. 在保留爆款 DNA 的前提下，产出一份全新的剧本大纲（换主题、换场景，不要照抄）

严格按 JSON 输出，不要输出任何额外文字。JSON 结构：
{
  "hooks": ["钩子1", "钩子2"],
  "structure": "文案结构描述",
  "plot": "剧情框架摘要",
  "styleNotes": "配乐与画风判断",
  "shotIdeas": ["分镜建议1", "分镜建议2"],
  "outline": "新剧本大纲（含开头钩子、3-4 个节拍、反转与结尾）"
}`;

/** 判断输入是视频链接还是纯文案 */
export function isVideoUrl(text: string): boolean {
  return /^https?:\/\/\S+/i.test(text.trim());
}

export interface ReplicateOptions {
  /** 是否沿用参考的画风与节奏（默认 true） */
  keepStyle?: boolean;
}

/** 解析参考内容，产出爆款 DNA 与新大纲 */
export async function analyzeReference(
  reference: string,
  options: ReplicateOptions = {},
): Promise<ReplicateAnalysis> {
  const trimmed = reference.trim();
  if (!trimmed) throw new Error('请输入参考视频链接或文案');

  const userPrompt = isVideoUrl(trimmed)
    ? `参考视频链接：${trimmed}\n（你无法直接看视频，请基于链接中的平台特征、标题语义与常见爆款模式做合理拆解）`
    : `参考文案：\n${trimmed}`;

  const result = await runText({
    messages: [
      { role: 'system', content: REPLICATE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: options.keepStyle === false ? `${userPrompt}\n\n要求：大幅改变画风与节奏，只借用叙事结构。` : userPrompt,
      },
    ],
    json: true,
    temperature: 0.8,
  });

  const parsed = parseAnalysis(result.text);
  return parsed;
}

/** 解析模型返回的 JSON，做容错 */
export function parseAnalysis(text: string): ReplicateAnalysis {
  const fallback: ReplicateAnalysis = {
    hooks: [],
    structure: '',
    plot: '',
    styleNotes: '',
    shotIdeas: [],
    outline: text.slice(0, 2000),
  };
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1) return fallback;
    const json = JSON.parse(text.slice(start, end + 1)) as Partial<ReplicateAnalysis>;
    return {
      hooks: Array.isArray(json.hooks) ? json.hooks.filter((item) => typeof item === 'string') : [],
      structure: typeof json.structure === 'string' ? json.structure : '',
      plot: typeof json.plot === 'string' ? json.plot : '',
      styleNotes: typeof json.styleNotes === 'string' ? json.styleNotes : '',
      shotIdeas: Array.isArray(json.shotIdeas)
        ? json.shotIdeas.filter((item) => typeof item === 'string')
        : [],
      outline: typeof json.outline === 'string' ? json.outline : fallback.outline,
    };
  } catch {
    return fallback;
  }
}
