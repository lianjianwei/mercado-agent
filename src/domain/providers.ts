export type ConnectionStatus =
  | 'success'
  | 'authentication_error'
  | 'timeout'
  | 'cancelled'
  | 'unavailable'
  | 'error';

export type ConnectionResult = {
  ok: boolean;
  status: ConnectionStatus;
  message: string;
  latencyMs: number;
  route: 'direct' | 'http_proxy';
};

export type MultimodalRequest = {
  prompt: string;
  imageUrls?: string[];
};

export type ImageGenerationRequest = {
  prompt: string;
  referenceImageUrls?: string[];
};

export type ImageResult = {
  url: string;
  dataBase64?: string; // OpenAI 图像默认返回 base64;url 可能为临时值(已弃用)
};

export interface ModelConnectionProvider {
  testConnection(signal: AbortSignal): Promise<ConnectionResult>;
}

export interface TextModelProvider extends ModelConnectionProvider {
  generate(request: MultimodalRequest, signal: AbortSignal): Promise<unknown>;
}

export interface ImageModelProvider extends ModelConnectionProvider {
  generate(
    request: ImageGenerationRequest,
    signal: AbortSignal,
  ): Promise<ImageResult[]>;
  // 可选:一次产出多张(本地 codex 场景,避免每张调一次进程/重复下载参考图)。
  // 返回与 requests 一一对应的结果;某张未生成返回无数据的 ImageResult。不实现则回退一张一调。
  generateBatch?(
    requests: ImageGenerationRequest[],
    signal: AbortSignal,
  ): Promise<ImageResult[]>;
}

export class ProviderAuthenticationError extends Error {
  constructor() {
    super('模型服务拒绝了当前凭证，请检查 API Key。');
    this.name = 'ProviderAuthenticationError';
  }
}

export class ProviderUnavailableError extends Error {
  constructor(message?: string) {
    super(message ?? '暂时无法连接模型服务，请检查 Base URL 和网络后重试。');
    this.name = 'ProviderUnavailableError';
  }
}

export class ProviderRegionRestrictedError extends Error {
  constructor() {
    super('模型服务拒绝当前网络地区访问，请启用可用的 HTTP 代理后重试。');
    this.name = 'ProviderRegionRestrictedError';
  }
}
