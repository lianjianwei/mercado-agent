import { contextBridge, ipcRenderer } from 'electron';

import {
  IPC_CHANNELS,
  type DesktopApi,
  type IpcResult,
} from './shared/ipc-contract';

class DesktopApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DesktopApiError';
  }
}

async function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, payload)) as IpcResult<T>;
  if (!result.ok) {
    throw new DesktopApiError(result.error.code, result.error.message);
  }
  return result.data;
}

const desktopApi: DesktopApi = {
  app: {
    getInfo: () => invoke(IPC_CHANNELS.appGetInfo),
  },
  config: {
    listProviders: (kind) =>
      invoke(IPC_CHANNELS.configListProviders, kind),
    saveProvider: (input) =>
      invoke(IPC_CHANNELS.configSaveProvider, input),
    activateProvider: (id) =>
      invoke(IPC_CHANNELS.configActivateProvider, { id }),
    deleteProvider: (id) =>
      invoke(IPC_CHANNELS.configDeleteProvider, { id }),
    getCredentials: () => invoke(IPC_CHANNELS.configGetCredentials),
    saveCredentials: (input) =>
      invoke(IPC_CHANNELS.configSaveCredentials, input),
  },
  diagnostics: {
    getSnapshot: () => invoke(IPC_CHANNELS.diagnosticGetSnapshot),
    testConnection: (kind) =>
      invoke(IPC_CHANNELS.diagnosticTestConnection, kind),
    cancelConnection: (kind) =>
      invoke(IPC_CHANNELS.diagnosticCancelConnection, kind),
  },
  proxy: {
    get: () => invoke(IPC_CHANNELS.proxyGet),
    save: (input) => invoke(IPC_CHANNELS.proxySave, input),
  },
  products: {
    syncDefault: () => invoke(IPC_CHANNELS.productSyncDefault),
    reconcileTracked: (productIds) =>
      invoke(IPC_CHANNELS.productReconcileTracked, { productIds }),
  },
};

contextBridge.exposeInMainWorld('mercado', desktopApi);
