import { describe, expect, it } from 'vitest';

import type { AppSettingsRepository, ModelProxyConfig } from '../../src/domain/proxy';
import type { ElectronProxyConfig, ModelSessionAdapter } from '../../src/main/network/model-network-client';
import { ModelProxyService } from '../../src/main/services/model-proxy-service';

const enabledProxy: ModelProxyConfig = {
  enabled: true,
  protocol: 'http',
  host: '127.0.0.1',
  port: 7890,
};

class FakeRepository implements AppSettingsRepository {
  current: ModelProxyConfig = { enabled: false, protocol: 'http', host: '', port: null };
  saved: ModelProxyConfig[] = [];
  saveError?: Error;
  getModelProxy() { return this.current; }
  saveModelProxy(value: ModelProxyConfig) {
    if (this.saveError) throw this.saveError;
    this.saved.push(value);
    this.current = value;
  }
}

class FakeSession implements ModelSessionAdapter {
  setProxyCalls: ElectronProxyConfig[] = [];
  closeCalls = 0;
  setProxyError?: Error;
  async setProxy(config: ElectronProxyConfig) {
    this.setProxyCalls.push(config);
    if (this.setProxyError) throw this.setProxyError;
  }
  async closeAllConnections() { this.closeCalls += 1; }
  async fetch() { return new Response('{}', { status: 200 }); }
}

describe('ModelProxyService', () => {
  it('initializes the model session in direct mode when disabled', async () => {
    const repository = new FakeRepository();
    const session = new FakeSession();
    const service = new ModelProxyService(repository, session);
    await service.initialize();
    expect(session.setProxyCalls).toEqual([{ mode: 'direct' }]);
  });

  it('applies an enabled HTTP proxy and closes existing model connections', async () => {
    const repository = new FakeRepository();
    const session = new FakeSession();
    const service = new ModelProxyService(repository, session);
    await service.save(enabledProxy);
    expect(session.setProxyCalls.at(-1)).toEqual({
      mode: 'fixed_servers',
      proxyRules: 'http://127.0.0.1:7890',
    });
    expect(session.closeCalls).toBe(1);
    expect(repository.saved).toEqual([enabledProxy]);
  });

  it('does not persist when applying the proxy fails', async () => {
    const repository = new FakeRepository();
    const session = new FakeSession();
    session.setProxyError = new Error('ERR_PROXY_CONNECTION_FAILED');
    const service = new ModelProxyService(repository, session);
    await expect(service.save(enabledProxy)).rejects.toThrow(
      '无法应用模型网络代理配置',
    );
    expect(repository.saved).toEqual([]);
  });

  it('restores the old route when persistence fails', async () => {
    const repository = new FakeRepository();
    repository.saveError = new Error('disk full');
    const session = new FakeSession();
    const service = new ModelProxyService(repository, session);
    await expect(service.save(enabledProxy)).rejects.toThrow('已恢复原配置');
    expect(session.setProxyCalls).toEqual([
      { mode: 'fixed_servers', proxyRules: 'http://127.0.0.1:7890' },
      { mode: 'direct' },
    ]);
  });
});
