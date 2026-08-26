export type ModelProxyConfig = {
  enabled: boolean;
  protocol: 'http';
  host: string;
  port: number | null;
};

export const DISABLED_MODEL_PROXY: ModelProxyConfig = {
  enabled: false,
  protocol: 'http',
  host: '',
  port: null,
};

export interface AppSettingsRepository {
  getModelProxy(): ModelProxyConfig;
  saveModelProxy(value: ModelProxyConfig): void;
}
