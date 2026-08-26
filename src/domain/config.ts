export type ProviderKind = 'text' | 'image';
export type TextProviderName = 'doubao' | 'deepseek' | 'openai';
export type ImageProviderName = 'doubao' | 'openai';

type ProviderConfigInputBase = {
  id?: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  model: string;
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
