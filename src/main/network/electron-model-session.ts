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
