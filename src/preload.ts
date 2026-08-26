import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('mercado', {
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),
});
