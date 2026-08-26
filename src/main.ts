import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { openAppDatabase, resolveDatabasePath } from './main/db/database';
import { createMainWindowOptions } from './main/window-options';

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

app.whenReady().then(() => {
  appDatabase = openAppDatabase(resolveDatabasePath(app.getPath('userData')));

  ipcMain.handle('app:get-info', () => ({
    version: app.getVersion(),
    platform: process.platform,
  }));

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
