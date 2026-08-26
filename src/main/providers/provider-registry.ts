import type {
  ProviderConfig,
  ProviderConfigRepository,
  ProviderKind,
} from '../../domain/config';
import type { ModelConnectionProvider } from '../../domain/providers';

export type ProviderFactoryRegistration = {
  kind: ProviderKind;
  provider: ProviderConfig['provider'];
  create(configuration: ProviderConfig): ModelConnectionProvider;
};

export class ActiveProviderMissingError extends Error {
  constructor(kind: ProviderKind) {
    super(`${kind === 'text' ? '文本' : '生图'}模型尚未启用配置。`);
    this.name = 'ActiveProviderMissingError';
  }
}

export class UnsupportedProviderError extends Error {
  constructor(kind: ProviderKind, provider: string) {
    super(`不支持当前${kind === 'text' ? '文本' : '生图'}模型服务：${provider}。`);
    this.name = 'UnsupportedProviderError';
  }
}

export class ProviderRegistry {
  private readonly registrations = new Map<
    string,
    ProviderFactoryRegistration
  >();

  constructor(
    private readonly repository: ProviderConfigRepository,
    registrations: ProviderFactoryRegistration[],
  ) {
    for (const registration of registrations) {
      this.registrations.set(
        this.registrationKey(registration.kind, registration.provider),
        registration,
      );
    }
  }

  createActive(kind: ProviderKind): ModelConnectionProvider {
    const configuration = this.repository
      .list(kind)
      .find((candidate) => candidate.isActive);

    if (!configuration) throw new ActiveProviderMissingError(kind);

    const registration = this.registrations.get(
      this.registrationKey(kind, configuration.provider),
    );
    if (!registration) {
      throw new UnsupportedProviderError(kind, configuration.provider);
    }

    return registration.create(configuration);
  }

  private registrationKey(kind: ProviderKind, provider: string): string {
    return `${kind}:${provider}`;
  }
}
