import type {
  AppCredentials,
  ProviderConfig,
  ProviderConfigInput,
  ProviderKind,
} from '../domain/config';
import type { AppCredentialsInput } from './config-schemas';

export const IPC_CHANNELS = {
  appGetInfo: 'app:get-info',
  configListProviders: 'config:list-providers',
  configSaveProvider: 'config:save-provider',
  configActivateProvider: 'config:activate-provider',
  configDeleteProvider: 'config:delete-provider',
  configGetCredentials: 'config:get-credentials',
  configSaveCredentials: 'config:save-credentials',
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
}
