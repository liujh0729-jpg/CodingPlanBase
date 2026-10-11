import {
  CHANNEL_TYPE_AIPDD,
  CHANNEL_TYPE_ANTHROPIC,
  CHANNEL_TYPE_CUSTOM,
  CHANNEL_TYPE_OPENAI,
  DEFAULT_API_PREFIX,
  type ChannelProtocol,
} from './gateway.constants';

/**
 * 上游标准模板（对齐 new-api `constant/channel.go` 的类型编号与默认地址）。
 *
 * 只收录本系统转发得动的源：报文协议必须是 OpenAI 兼容或 Anthropic 兼容，
 * 其余差异（火山方舟 `/api/v3`、阿里 `/compatible-mode/v1`、智谱 `/api/paas/v4`）
 * 由 `apiPrefix` 消化，转发路径与模型清单路径都从它推出来，不再各存一份。
 * 需要私有报文的源（Azure OpenAI 的 deployment + api-version、Gemini 原生 `:generateContent`、
 * Cohere `/v1/chat`、AWS Bedrock 签名、百度/腾讯/MiniMax 私有报文、智谱 V3）不在这里半截支持——
 * 没有对应适配器就不进模板，否则建出来的渠道每次调用都失败。
 */
export interface ChannelPreset {
  /** 表单里选模板用的稳定 key。 */
  key: string;
  /** new-api 的渠道类型编号。 */
  type: number;
  nameZh: string;
  nameEn: string;
  protocol: ChannelProtocol;
  /** 默认上游地址（不含路径前缀）。 */
  baseUrl: string;
  /** 上游路径前缀：客户端的 `/v1/...` 会换成这一段。 */
  apiPrefix: string;
  /** 密钥填写口径提示；多密钥一律换行分隔，所以只在格式特殊时提示。 */
  keyHint?: string;
  website: string;
  /** 能否在渠道表单里手建；托管渠道由 AIPDD 接入向导维护，不进模板下拉。 */
  creatable: boolean;
}

export const CHANNEL_PRESETS: ChannelPreset[] = [
  {
    key: 'openai',
    type: CHANNEL_TYPE_OPENAI,
    nameZh: 'OpenAI',
    nameEn: 'OpenAI',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com',
    apiPrefix: '/v1',
    website: 'https://platform.openai.com',
    creatable: true,
  },
  {
    key: 'deepseek',
    type: 43,
    nameZh: 'DeepSeek',
    nameEn: 'DeepSeek',
    protocol: 'openai',
    baseUrl: 'https://api.deepseek.com',
    apiPrefix: '/v1',
    website: 'https://platform.deepseek.com',
    creatable: true,
  },
  {
    key: 'volcengine',
    type: 45,
    nameZh: '字节火山方舟 / 豆包',
    nameEn: 'VolcEngine',
    protocol: 'openai',
    baseUrl: 'https://ark.cn-beijing.volces.com',
    apiPrefix: '/api/v3',
    keyHint: '方舟 API Key（Bearer）；模型名用推理接入点 ID',
    website: 'https://console.volcengine.com/ark',
    creatable: true,
  },
  {
    key: 'ali',
    type: 17,
    nameZh: '阿里通义（DashScope 兼容模式）',
    nameEn: 'Ali',
    protocol: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com',
    apiPrefix: '/compatible-mode/v1',
    website: 'https://bailian.console.aliyun.com',
    creatable: true,
  },
  {
    key: 'zhipu',
    type: 26,
    nameZh: '智谱 GLM（V4）',
    nameEn: 'ZhipuV4',
    protocol: 'openai',
    baseUrl: 'https://open.bigmodel.cn',
    apiPrefix: '/api/paas/v4',
    website: 'https://open.bigmodel.cn',
    creatable: true,
  },
  {
    key: 'moonshot',
    type: 25,
    nameZh: '月之暗面 Kimi',
    nameEn: 'Moonshot',
    protocol: 'openai',
    baseUrl: 'https://api.moonshot.cn',
    apiPrefix: '/v1',
    website: 'https://platform.moonshot.cn',
    creatable: true,
  },
  {
    key: 'siliconflow',
    type: 40,
    nameZh: '硅基流动 SiliconFlow',
    nameEn: 'SiliconFlow',
    protocol: 'openai',
    baseUrl: 'https://api.siliconflow.cn',
    apiPrefix: '/v1',
    website: 'https://cloud.siliconflow.cn',
    creatable: true,
  },
  {
    key: 'xai',
    type: 48,
    nameZh: 'xAI Grok',
    nameEn: 'xAI',
    protocol: 'openai',
    baseUrl: 'https://api.x.ai',
    apiPrefix: '/v1',
    website: 'https://console.x.ai',
    creatable: true,
  },
  {
    key: 'mistral',
    type: 42,
    nameZh: 'Mistral',
    nameEn: 'Mistral',
    protocol: 'openai',
    baseUrl: 'https://api.mistral.ai',
    apiPrefix: '/v1',
    website: 'https://console.mistral.ai',
    creatable: true,
  },
  {
    key: 'perplexity',
    type: 27,
    nameZh: 'Perplexity',
    nameEn: 'Perplexity',
    protocol: 'openai',
    baseUrl: 'https://api.perplexity.ai',
    apiPrefix: '/v1',
    website: 'https://www.perplexity.ai',
    creatable: true,
  },
  {
    key: 'openrouter',
    type: 20,
    nameZh: 'OpenRouter',
    nameEn: 'OpenRouter',
    protocol: 'openai',
    baseUrl: 'https://openrouter.ai',
    apiPrefix: '/api/v1',
    website: 'https://openrouter.ai',
    creatable: true,
  },
  {
    key: 'gemini',
    type: 24,
    nameZh: 'Google Gemini（OpenAI 兼容端点）',
    nameEn: 'Gemini',
    protocol: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com',
    apiPrefix: '/v1beta/openai',
    keyHint:
      'AI Studio API Key；这里走的是 Google 的 OpenAI 兼容端点，不是原生 generateContent',
    website: 'https://aistudio.google.com',
    creatable: true,
  },
  {
    key: 'anthropic',
    type: CHANNEL_TYPE_ANTHROPIC,
    nameZh: 'Anthropic Claude',
    nameEn: 'Anthropic',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    apiPrefix: '/v1',
    keyHint: 'sk-ant-... ；拉取模型清单用 x-api-key',
    website: 'https://console.anthropic.com',
    creatable: true,
  },
  {
    key: 'custom',
    type: CHANNEL_TYPE_CUSTOM,
    nameZh: '自定义（OpenAI 兼容中转）',
    nameEn: 'Custom',
    protocol: 'openai',
    baseUrl: '',
    apiPrefix: DEFAULT_API_PREFIX,
    keyHint: 'Base URL 必填；网关/中转站只要兼容 OpenAI 报文就能接',
    website: '',
    creatable: true,
  },
  {
    key: 'aipdd',
    type: CHANNEL_TYPE_AIPDD,
    nameZh: 'AIPDD（目录同步托管）',
    nameEn: 'AIPDD',
    protocol: 'openai',
    baseUrl: 'https://api.aipdd.work',
    apiPrefix: DEFAULT_API_PREFIX,
    keyHint: '由「系统设置 → AIPDD 接入」自动创建与维护，一般不需要手建',
    website: '',
    creatable: false,
  },
];

const BY_KEY = new Map(CHANNEL_PRESETS.map((item) => [item.key, item]));
const BY_TYPE = new Map(CHANNEL_PRESETS.map((item) => [item.type, item]));

/** 渠道表单里的模板下拉：托管渠道不在其中。 */
export function creatablePresets(): ChannelPreset[] {
  return CHANNEL_PRESETS.filter((item) => item.creatable);
}

export function findPresetByKey(key: string): ChannelPreset | null {
  return BY_KEY.get(String(key || '').trim()) || null;
}

export function findPresetByType(type: number): ChannelPreset | null {
  return BY_TYPE.get(Number(type)) || null;
}

/** 合法类型编号：模板表里的都算（含托管 AIPDD）。 */
export function isKnownChannelType(type: number): boolean {
  return BY_TYPE.has(Number(type));
}
