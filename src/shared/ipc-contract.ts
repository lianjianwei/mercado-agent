import type {
  AppCredentials,
  ProviderConfig,
  ProviderConfigInput,
  ProviderKind,
} from '../domain/config';
import type { AppCredentialsInput } from './config-schemas';
import type { ConnectionResult } from '../domain/providers';
import type { ModelProxyConfig } from '../domain/proxy';
import type {
  ProductPage,
  ProductPageQuery,
  ProductSyncSummary,
} from '../domain/product';

export const IPC_CHANNELS = {
  appGetInfo: 'app:get-info',
  configListProviders: 'config:list-providers',
  configSaveProvider: 'config:save-provider',
  configActivateProvider: 'config:activate-provider',
  configDeleteProvider: 'config:delete-provider',
  configGetCredentials: 'config:get-credentials',
  configSaveCredentials: 'config:save-credentials',
  diagnosticGetSnapshot: 'diagnostic:get-snapshot',
  diagnosticTestConnection: 'diagnostic:test-connection',
  diagnosticCancelConnection: 'diagnostic:cancel-connection',
  proxyGet: 'proxy:get',
  proxySave: 'proxy:save',
  productPage: 'product:page',
  productSyncDefault: 'product:sync-default',
  productReconcileTracked: 'product:reconcile-tracked',
} as const;

export type IpcErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR';

export type IpcError = {
  code: IpcErrorCode;
  message: string;
  issues?: Array<{ path: string; message: string }>;
};

export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: IpcError };

export type IpcListener = (
  event: unknown,
  payload: unknown,
) => Promise<IpcResult<unknown>>;

export interface IpcRegistrar {
  handle(channel: string, listener: IpcListener): void;
}

export type AppInfo = {
  version: string;
  platform: string;
};

export type DiagnosticSnapshot = {
  app: AppInfo;
  databasePath: string;
  modelNetwork: {
    route: 'direct' | 'http_proxy';
    proxyAddress: string | null;
  };
  completeness: {
    textProvider: boolean;
    imageProvider: boolean;
    miaoshou: boolean;
    qiniu: boolean;
  };
};

export interface DiagnosticApi {
  getSnapshot(): Promise<DiagnosticSnapshot>;
  testConnection(kind: ProviderKind): Promise<ConnectionResult>;
  cancelConnection(kind: ProviderKind): Promise<void>;
}

export interface ProxyConfigApi {
  get(): Promise<ModelProxyConfig>;
  save(input: ModelProxyConfig): Promise<ModelProxyConfig>;
}

export interface ProductApi {
  page(query: ProductPageQuery): Promise<ProductPage>;
  syncDefault(): Promise<ProductSyncSummary>;
  reconcileTracked(productIds: string[]): Promise<ProductSyncSummary>;
}

export interface ConfigApi {
  listProviders(kind: ProviderKind): Promise<ProviderConfig[]>;
  saveProvider(input: ProviderConfigInput): Promise<ProviderConfig>;
  activateProvider(id: string): Promise<void>;
  deleteProvider(id: string): Promise<void>;
  getCredentials(): Promise<AppCredentials>;
  saveCredentials(input: AppCredentialsInput): Promise<void>;
}

export interface DesktopApi {
  app: {
    getInfo(): Promise<AppInfo>;
  };
  config: ConfigApi;
  diagnostics: DiagnosticApi;
  proxy: ProxyConfigApi;
  products: ProductApi;
}
