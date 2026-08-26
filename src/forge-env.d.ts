declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MAIN_WINDOW_VITE_NAME: string;

interface Window {
  mercado: {
    getAppInfo(): Promise<{ version: string; platform: string }>;
  };
}
