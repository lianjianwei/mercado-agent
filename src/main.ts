import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { openAppDatabase, resolveDatabasePath } from './main/db/database';
import { registerHandlers } from './main/ipc/register-handlers';
import { createDefaultProviderRegistrations } from './main/providers/default-provider-registrations';
import { ProviderRegistry } from './main/providers/provider-registry';
import { SqliteCredentialRepository } from './main/repositories/credential-repository';
import { SqliteAppSettingsRepository } from './main/repositories/app-settings-repository';
import { SqliteProviderConfigRepository } from './main/repositories/provider-config-repository';
import { createElectronModelSession } from './main/network/electron-model-session';
import { ModelNetworkClient } from './main/network/model-network-client';
import { createMainWindowOptions } from './main/window-options';
import { ConnectionTestService } from './main/services/connection-test-service';
import { ModelProxyService } from './main/services/model-proxy-service';

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
  const getAppInfo = () => ({
    version: app.getVersion(),
    platform: process.platform,
  });
  const providerRegistry = new ProviderRegistry(
    providerConfigs,
    createDefaultProviderRegistrations(modelNetwork),
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
      modelProxy,
      getAppInfo,
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
