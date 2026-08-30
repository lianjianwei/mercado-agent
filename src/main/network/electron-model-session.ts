import { session } from 'electron';

import type { ModelSessionAdapter } from './model-network-client';

export function createElectronModelSession(): ModelSessionAdapter {
  const modelSession = session.fromPartition('persist:model-network');
  return {
    setProxy: (config) => modelSession.setProxy(config),
    closeAllConnections: () => modelSession.closeAllConnections(),
    fetch: (input, init) => modelSession.fetch(input, init),
  };
}

// 直连会话:不设代理、直接用全局 fetch。给不被地区限制且无需代理的模型
// (豆包、DeepSeek)使用,避免被模型代理拖慢(实测 deepseek 走代理→直连耗时翻倍)。
export function createDirectModelSession(): ModelSessionAdapter {
  return {
    setProxy: async () => {},
    closeAllConnections: async () => {},
    fetch: (input, init) => fetch(input, init),
  };
}
