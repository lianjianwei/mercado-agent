export type ProviderKind = 'text' | 'image';
export type TextProviderName = 'doubao' | 'deepseek' | 'openai';
export type ImageProviderName = 'doubao' | 'openai' | 'codex';

// OpenAI 的推理强度参数(reasoning_effort)。仅 OpenAI 文本模型使用;DeepSeek/豆包目前
// 未加(厂商是否支持不确定)。值为 OpenAI 官方枚举。
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

type ProviderConfigInputBase = {
  id?: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
};

export type ProviderConfigInput = ProviderConfigInputBase &
  (
    | { kind: 'text'; provider: TextProviderName }
    | { kind: 'image'; provider: ImageProviderName }
  );

export type ProviderConfig = {
  id: string;
  kind: ProviderKind;
  provider: TextProviderName | ImageProviderName;
  name: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MiaoshouCredential = {
  appKey: string;
  appSecret: string;
  baseUrl: string;
};

export type QiniuCredential = {
  accessKey: string;
  secretKey: string;
  bucket: string;
  domain: string;
  region: string;
};

export type AppCredentials = {
  miaoshou: MiaoshouCredential | null;
  qiniu: QiniuCredential | null;
};

export class ProviderConfigNotFoundError extends Error {
  constructor() {
    super('Provider configuration was not found');
    this.name = 'ProviderConfigNotFoundError';
  }
}

export interface ProviderConfigRepository {
  list(kind: ProviderKind): ProviderConfig[];
  save(input: ProviderConfigInput): ProviderConfig;
  activate(id: string): void;
  delete(id: string): void;
}

export interface CredentialRepository {
  getMiaoshou(): MiaoshouCredential | null;
  saveMiaoshou(value: MiaoshouCredential): void;
  getQiniu(): QiniuCredential | null;
  saveQiniu(value: QiniuCredential): void;
}
