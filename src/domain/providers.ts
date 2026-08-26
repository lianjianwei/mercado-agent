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
}

export class ProviderAuthenticationError extends Error {
  constructor() {
    super('模型服务拒绝了当前凭证，请检查 API Key。');
    this.name = 'ProviderAuthenticationError';
  }
}

export class ProviderUnavailableError extends Error {
  constructor() {
    super('暂时无法连接模型服务，请检查 Base URL 和网络后重试。');
    this.name = 'ProviderUnavailableError';
  }
}
