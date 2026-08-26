import {
  DISABLED_MODEL_PROXY,
  type AppSettingsRepository,
  type ModelProxyConfig,
} from '../../domain/proxy';
import { modelProxyConfigSchema } from '../../shared/config-schemas';
import {
  ModelProxyApplyError,
  ModelProxyPersistenceError,
} from '../network/model-network-errors';
import type {
  ElectronProxyConfig,
  ModelSessionAdapter,
  NetworkRoute,
} from '../network/model-network-client';

export class ModelProxyService {
  private current: ModelProxyConfig = { ...DISABLED_MODEL_PROXY };

  constructor(
    private readonly repository: AppSettingsRepository,
    private readonly session: ModelSessionAdapter,
  ) {}

  async initialize(): Promise<ModelProxyConfig> {
    const stored = this.repository.getModelProxy();
    await this.apply(stored);
    this.current = stored;
    return stored;
  }

  get(): ModelProxyConfig {
    return { ...this.current };
  }

  getRoute(): NetworkRoute {
    return this.current.enabled ? 'http_proxy' : 'direct';
  }

  async save(input: ModelProxyConfig): Promise<ModelProxyConfig> {
    const next = modelProxyConfigSchema.parse(input);
    const previous = this.current;
    await this.apply(next);
    try {
      this.repository.saveModelProxy(next);
      this.current = next;
      return { ...next };
    } catch {
      try {
        await this.apply(previous);
      } catch {
        throw new ModelProxyPersistenceError(
          '代理配置保存和恢复均失败，请重启应用恢复数据库中的原配置。',
        );
      }
      throw new ModelProxyPersistenceError();
    }
  }

  private async apply(value: ModelProxyConfig): Promise<void> {
    try {
      await this.session.setProxy(this.toElectronConfig(value));
      await this.session.closeAllConnections();
    } catch {
      throw new ModelProxyApplyError();
    }
  }

  private toElectronConfig(value: ModelProxyConfig): ElectronProxyConfig {
    if (!value.enabled) return { mode: 'direct' };
    return {
      mode: 'fixed_servers',
      proxyRules: `http://${value.host}:${value.port}`,
    };
  }
}
