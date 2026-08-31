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
    codexAvailable: () => invoke(IPC_CHANNELS.configCodexAvailable),
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
    page: (query) => invoke(IPC_CHANNELS.productPage, query),
    detail: (productId) =>
      invoke(IPC_CHANNELS.productDetail, { productId }),
    syncDefault: () => invoke(IPC_CHANNELS.productSyncDefault),
    onSyncLog: (listener) => {
      const onEvent = (_event: Electron.IpcRendererEvent, payload: unknown) => {
        if (
          payload
          && typeof payload === 'object'
          && 'line' in payload
          && typeof (payload as { line: unknown }).line === 'string'
        ) {
          listener((payload as { line: string }).line);
        }
      };
      ipcRenderer.on(IPC_CHANNELS.productSyncLog, onEvent);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.productSyncLog, onEvent);
    },
    syncOne: (productId) =>
      invoke(IPC_CHANNELS.productSyncOne, { productId }),
    clear: () => invoke(IPC_CHANNELS.productClear),
  },
  edit: {
    generate: (productId) =>
      invoke(IPC_CHANNELS.editGenerate, { productId }),
    draft: (productId) =>
      invoke(IPC_CHANNELS.editDraft, { productId }),
    saveDraft: (productId, draft) =>
      invoke(IPC_CHANNELS.editSaveDraft, { productId, draft }),
    saveToMiaoshou: (productId) =>
      invoke(IPC_CHANNELS.editSaveToMiaoshou, { productId }),
    onEditLog: (listener) => {
      const onEvent = (_event: Electron.IpcRendererEvent, payload: unknown) => {
        if (
          payload
          && typeof payload === 'object'
          && 'line' in payload
          && typeof (payload as { line: unknown }).line === 'string'
        ) {
          listener((payload as { line: string }).line);
        }
      };
      ipcRenderer.on(IPC_CHANNELS.editLog, onEvent);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.editLog, onEvent);
    },
    images: {
      generateImages: (productId) =>
        invoke(IPC_CHANNELS.imagesGenerate, { productId }),
      getImages: (productId) =>
        invoke(IPC_CHANNELS.imagesGet, { productId }),
      uploadImages: (productId) =>
        invoke(IPC_CHANNELS.imagesUpload, { productId }),
      regenerateImages: (productId, targets) =>
        invoke(IPC_CHANNELS.imagesRegenerate, { productId, targets }),
    },
  },
  netProfit: {
    getConfig: () => invoke(IPC_CHANNELS.netProfitGetConfig),
    saveConfig: (config) => invoke(IPC_CHANNELS.netProfitSaveConfig, { config }),
    refreshRates: () => invoke(IPC_CHANNELS.netProfitRefreshRates),
  },
  infringement: {
    analyze: (productId) =>
      invoke(IPC_CHANNELS.infringementAnalyze, { productId }),
    analyzeBatch: (productIds) =>
      invoke(IPC_CHANNELS.infringementAnalyzeBatch, { productIds }),
    onBatchLog: (listener) => {
      const onEvent = (_event: Electron.IpcRendererEvent, payload: unknown) => {
        if (
          payload
          && typeof payload === 'object'
          && 'line' in payload
          && typeof (payload as { line: unknown }).line === 'string'
        ) {
          listener((payload as { line: string }).line);
        }
      };
      ipcRenderer.on(IPC_CHANNELS.infringementBatchLog, onEvent);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.infringementBatchLog, onEvent);
    },
    history: (productId) =>
      invoke(IPC_CHANNELS.infringementHistory, { productId }),
    current: (productId) =>
      invoke(IPC_CHANNELS.infringementCurrent, { productId }),
  },
  images: {
    generateImages: (productId) =>
      invoke(IPC_CHANNELS.imagesGenerate, { productId }),
    getImages: (productId) =>
      invoke(IPC_CHANNELS.imagesGet, { productId }),
    uploadImages: (productId) =>
      invoke(IPC_CHANNELS.imagesUpload, { productId }),
    regenerateImages: (productId, targets) =>
      invoke(IPC_CHANNELS.imagesRegenerate, { productId, targets }),
  },
  clipboard: {
    copyImage: (src) => invoke(IPC_CHANNELS.clipboardImage, { src }),
    copyText: (text) => invoke(IPC_CHANNELS.clipboardText, { text }),
  },
};

contextBridge.exposeInMainWorld('mercado', desktopApi);
