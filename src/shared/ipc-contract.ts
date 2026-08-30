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
  ProductDetail,
  ProductPage,
  ProductPageQuery,
  ProductSyncSummary,
  SyncOneResult,
} from '../domain/product';
import type { InfringementRun } from '../domain/infringement';
import type { EditDraft } from '../domain/edit';
import type { FxRates, NetProfitConfig } from '../domain/net-profit';
import type { AiImagesResult } from '../domain/images';

export const IPC_CHANNELS = {
  appGetInfo: 'app:get-info',
  configListProviders: 'config:list-providers',
  configSaveProvider: 'config:save-provider',
  configActivateProvider: 'config:activate-provider',
  configDeleteProvider: 'config:delete-provider',
  configGetCredentials: 'config:get-credentials',
  configSaveCredentials: 'config:save-credentials',
  configCodexAvailable: 'config:codex-available',
  diagnosticGetSnapshot: 'diagnostic:get-snapshot',
  diagnosticTestConnection: 'diagnostic:test-connection',
  diagnosticCancelConnection: 'diagnostic:cancel-connection',
  proxyGet: 'proxy:get',
  proxySave: 'proxy:save',
  productPage: 'product:page',
  productDetail: 'product:detail',
  productSyncDefault: 'product:sync-default',
  productSyncLog: 'product:sync-log',
  productSyncOne: 'product:sync-one',
  productClear: 'product:clear',
  editGenerate: 'edit:generate',
  editDraft: 'edit:draft',
  editSaveDraft: 'edit:save-draft',
  editLog: 'edit:log',
  infringementAnalyze: 'infringement:analyze',
  infringementAnalyzeBatch: 'infringement:analyze-batch',
  infringementBatchLog: 'infringement:batch-log',
  infringementHistory: 'infringement:history',
  infringementCurrent: 'infringement:current',
  netProfitGetConfig: 'netProfit:get-config',
  netProfitSaveConfig: 'netProfit:save-config',
  netProfitRefreshRates: 'netProfit:refresh-rates',
  imagesGenerate: 'images:generate',
  imagesGet: 'images:get',
  imagesUpload: 'images:upload',
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

export type NetProfitSnapshot = {
  config: NetProfitConfig;
  fxRates: FxRates;
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
  detail(productId: string): Promise<ProductDetail>;
  syncDefault(): Promise<ProductSyncSummary>;
  onSyncLog(listener: (line: string) => void): () => void;
  syncOne(productId: string): Promise<SyncOneResult>;
  clear(): Promise<void>;
}

export interface EditApi {
  generate(productId: string): Promise<EditDraft>;
  draft(productId: string): Promise<EditDraft | null>;
  saveDraft(productId: string, draft: EditDraft): Promise<EditDraft>;
  onEditLog(listener: (line: string) => void): () => void;
  images: ImageApi;
}

export interface NetProfitApi {
  getConfig(): Promise<NetProfitSnapshot>;
  saveConfig(config: NetProfitConfig): Promise<NetProfitConfig>;
  refreshRates(): Promise<FxRates>;
}

export interface ImageApi {
  generateImages(productId: string): Promise<AiImagesResult>;
  // 读取已生成的图(不重新生成)。
  getImages(productId: string): Promise<AiImagesResult | null>;
  // 把已生成的图压缩 + 上传七牛,不重新生成,并写回 AI 产品图片。
  uploadImages(productId: string): Promise<AiImagesResult>;
}

export type InfringementBatchFailure = { productId: string; message: string };

export type InfringementBatchSummary = {
  discovered: number;
  succeeded: number;
  failed: number;
  failures: InfringementBatchFailure[];
};

export interface InfringementApi {
  analyze(productId: string): Promise<InfringementRun>;
  analyzeBatch(productIds: string[]): Promise<InfringementBatchSummary>;
  onBatchLog(listener: (line: string) => void): () => void;
  history(productId: string): Promise<InfringementRun[]>;
  current(productId: string): Promise<InfringementRun | null>;
}

export interface ConfigApi {
  listProviders(kind: ProviderKind): Promise<ProviderConfig[]>;
  saveProvider(input: ProviderConfigInput): Promise<ProviderConfig>;
  activateProvider(id: string): Promise<void>;
  deleteProvider(id: string): Promise<void>;
  getCredentials(): Promise<AppCredentials>;
  saveCredentials(input: AppCredentialsInput): Promise<void>;
  codexAvailable(): Promise<{ available: boolean }>;
}

export interface DesktopApi {
  app: {
    getInfo(): Promise<AppInfo>;
  };
  config: ConfigApi;
  diagnostics: DiagnosticApi;
  proxy: ProxyConfigApi;
  products: ProductApi;
  edit: EditApi;
  netProfit: NetProfitApi;
  infringement: InfringementApi;
  images: ImageApi;
}
