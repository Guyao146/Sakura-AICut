import { PROTOCOL_LABELS, type ProviderPreset, type ProviderProtocol } from '../types/provider';

/**
 * 按协议提供接入模板，不推荐特定服务商或模型。
 * 地址与模型 ID 由管理员填写，已有配置不受模板调整影响。
 */
const PROTOCOL_PRESETS: Array<{ key: string; protocol: ProviderProtocol; description: string }> = [
  { key: 'compatible', protocol: 'openai', description: '兼容对话、图片、视频与语音接口；支持流式文本和异步任务。' },
  { key: 'content-tasks', protocol: 'volcengine', description: '使用 /api/v3 接口，视频通过内容生成任务提交与查询。' },
  { key: 'signed-media', protocol: 'kling', description: '使用 AK/SK 签名鉴权，支持图片和视频任务。' },
  { key: 'file-tasks', protocol: 'minimax', description: '视频任务完成后通过文件接口获取结果，可配置 GroupId。' },
  { key: 'service-tasks', protocol: 'dashscope', description: '兼容模式文本接口与原生异步图片、视频任务接口。' },
  { key: 'messages', protocol: 'anthropic', description: '使用 /v1/messages 接口，支持文本和图片理解。' },
  { key: 'content-generation', protocol: 'gemini', description: '使用 generateContent 接口及长任务接口，支持多模态生成。' },
];

export const PROVIDER_PRESETS: ProviderPreset[] = PROTOCOL_PRESETS.map(({ key, protocol, description }) => ({
  key,
  protocol,
  label: PROTOCOL_LABELS[protocol],
  baseUrl: '',
  docsUrl: '',
  description,
  credentialFields: protocol === 'kling'
    ? [{ key: 'accessKey', label: 'AccessKey' }, { key: 'secretKey', label: 'SecretKey' }]
    : protocol === 'minimax'
      ? [{ key: 'apiKey', label: 'API Key' }, { key: 'groupId', label: 'GroupId（可选）' }]
      : [{ key: 'apiKey', label: 'API Key' }],
  defaultModels: [],
}));

export function findPreset(key: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((preset) => preset.key === key);
}
