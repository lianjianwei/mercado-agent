import { app, BrowserWindow, ipcMain } from 'electron';
import { IPC_CHANNELS } from './shared/ipc-contract';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { openAppDatabase, resolveDatabasePath } from './main/db/database';
import { registerHandlers } from './main/ipc/register-handlers';
import { createDefaultProviderRegistrations } from './main/providers/default-provider-registrations';
import { ProviderRegistry } from './main/providers/provider-registry';
import { SqliteCredentialRepository } from './main/repositories/credential-repository';
import { SqliteAppSettingsRepository } from './main/repositories/app-settings-repository';
import { SqliteProviderConfigRepository } from './main/repositories/provider-config-repository';
import { SqliteProductRepository } from './main/repositories/product-repository';
import { SqliteSnapshotRepository } from './main/repositories/snapshot-repository';
import { createElectronModelSession } from './main/network/electron-model-session';
import { ModelNetworkClient } from './main/network/model-network-client';
import { createMainWindowOptions } from './main/window-options';
import { ConnectionTestService } from './main/services/connection-test-service';
import { ModelProxyService } from './main/services/model-proxy-service';
import { HttpMiaoshouGateway } from './main/gateways/miaoshou/http-miaoshou-gateway';
import { ProductSyncService } from './main/services/product-sync-service';
import { SqliteInfringementRepository } from './main/repositories/infringement-repository';
import { InfringementService } from './main/services/infringement-service';
import { InfringementEngine } from './main/risk/infringement-engine';
import { ActiveProviderMissingError } from './main/providers/provider-registry';
import type { TextModelProvider } from './domain/providers';

let appDatabase: DatabaseSync | null = null;

function createMainWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow(
    createMainWindowOptions(path.join(__dirname, 'preload.js')),
  );

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.once('ready-to-show', () => mainWindow.show());

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(
      path.join(
        __dirname,
        `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
      ),
    );
  }

  return mainWindow;
}

app.whenReady().then(async () => {
  const databasePath = resolveDatabasePath(app.getPath('userData'));
  appDatabase = openAppDatabase(databasePath);
  const appSettings = new SqliteAppSettingsRepository(appDatabase);
  const modelSession = createElectronModelSession();
  const modelProxy = new ModelProxyService(appSettings, modelSession);
  await modelProxy.initialize();
  const modelNetwork = new ModelNetworkClient(modelSession, () => modelProxy.getRoute());
  const providerConfigs = new SqliteProviderConfigRepository(appDatabase);
  const credentials = new SqliteCredentialRepository(appDatabase);
  const products = new SqliteProductRepository(appDatabase);
  const snapshots = new SqliteSnapshotRepository(appDatabase);
  const createProductSyncService = () => {
    const miaoshouCredentials = credentials.getMiaoshou();
    if (!miaoshouCredentials) {
      throw new Error('Miaoshou credentials are not configured');
    }
    return new ProductSyncService(
      new HttpMiaoshouGateway(miaoshouCredentials),
      products,
      snapshots,
    );
  };
  const productSync = {
    syncDefault: (
      signal?: AbortSignal,
      onProgress?: (line: string) => void,
    ) => createProductSyncService().syncDefault(signal, onProgress),
    syncOne: (productId: string, signal?: AbortSignal) =>
      createProductSyncService().syncOne(productId, signal),
  };
  const getAppInfo = () => ({
    version: app.getVersion(),
    platform: process.platform,
  });
  const providerRegistry = new ProviderRegistry(
    providerConfigs,
    createDefaultProviderRegistrations(modelNetwork),
  );
  const infringementRepository = new SqliteInfringementRepository(appDatabase);
  const createInfringementEngine = () => {
    const provider = providerRegistry.createActive(
      'text',
    ) as TextModelProvider;
    if (typeof provider.generate !== 'function') {
      throw new ActiveProviderMissingError('text');
    }
    return new InfringementEngine(provider);
  };
  const infringementService = new InfringementService(
    infringementRepository,
    createInfringementEngine,
  );
  registerHandlers(
    {
      handle: (channel, listener) => {
        ipcMain.handle(channel, listener);
      },
    },
    {
      providerConfigs,
      credentials,
      products,
      productSync,
      snapshots,
      infringementRepository,
      infringementService,
      modelProxy,
      getAppInfo,
      sendProgress: (line) => {
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send(IPC_CHANNELS.productSyncLog, { line });
        }
      },
      connectionTests: new ConnectionTestService(
        providerRegistry,
        undefined,
        () => modelProxy.getRoute(),
      ),
      getDiagnosticSnapshot: () => {
        const proxy = modelProxy.get();
        return {
          app: getAppInfo(),
          databasePath,
          modelNetwork: {
            route: modelProxy.getRoute(),
            proxyAddress: proxy.enabled ? `${proxy.host}:${proxy.port}` : null,
          },
          completeness: {
            textProvider: providerConfigs.list('text').some((item) => item.isActive),
            imageProvider: providerConfigs.list('image').some((item) => item.isActive),
            miaoshou: credentials.getMiaoshou() !== null,
            qiniu: credentials.getQiniu() !== null,
          },
        };
      },
    },
  );

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('before-quit', () => {
  if (appDatabase?.isOpen) {
    appDatabase.close();
  }
  appDatabase = null;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
