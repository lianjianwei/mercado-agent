import type { DesktopApi } from './shared/ipc-contract';

declare global {
  const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
  const MAIN_WINDOW_VITE_NAME: string;

  interface Window {
    mercado: DesktopApi;
  }
}
