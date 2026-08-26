import { describe, expect, it, vi } from 'vitest';

import type {
  ProviderConfig,
  ProviderConfigRepository,
  ProviderKind,
} from '../../src/domain/config';
import type { ModelConnectionProvider } from '../../src/domain/providers';
import {
  ActiveProviderMissingError,
  ProviderRegistry,
  UnsupportedProviderError,
} from '../../src/main/providers/provider-registry';

function configuration(
  kind: ProviderKind,
  provider: ProviderConfig['provider'],
  isActive = true,
): ProviderConfig {
  return {
    id: `${kind}-${provider}`,
    kind,
    provider,
    name: `${provider} local`,
    apiKey: 'secret-key',
    baseUrl: 'https://example.test/v1',
    model: 'model-1',
    isActive,
    createdAt: '2026-08-27T00:00:00.000Z',
    updatedAt: '2026-08-27T00:00:00.000Z',
  };
}

function repository(configurations: ProviderConfig[]): ProviderConfigRepository {
  return {
    list: (kind) => configurations.filter((item) => item.kind === kind),
    save: vi.fn(),
    activate: vi.fn(),
    delete: vi.fn(),
  };
}

const connectionProvider: ModelConnectionProvider = {
  testConnection: vi.fn(),
};

describe('ProviderRegistry', () => {
  it('creates a registered provider from the active configuration', () => {
    const active = configuration('text', 'openai');
    const factory = vi.fn(() => connectionProvider);
    const registry = new ProviderRegistry(repository([active]), [
      { kind: 'text', provider: 'openai', create: factory },
    ]);

    expect(registry.createActive('text')).toBe(connectionProvider);
    expect(factory).toHaveBeenCalledWith(active);
  });

  it('rejects an unknown provider instead of falling back silently', () => {
    const active = configuration('text', 'deepseek');
    const registry = new ProviderRegistry(repository([active]), []);

    expect(() => registry.createActive('text')).toThrow(UnsupportedProviderError);
  });

  it('keeps text and image registrations separate', () => {
    const text = configuration('text', 'openai');
    const image = configuration('image', 'openai');
    const registry = new ProviderRegistry(repository([text, image]), [
      { kind: 'text', provider: 'openai', create: () => connectionProvider },
    ]);

    expect(registry.createActive('text')).toBe(connectionProvider);
    expect(() => registry.createActive('image')).toThrow(
      UnsupportedProviderError,
    );
  });

  it('reports when a kind has no active configuration', () => {
    const inactive = configuration('image', 'doubao', false);
    const registry = new ProviderRegistry(repository([inactive]), []);

    expect(() => registry.createActive('image')).toThrow(
      ActiveProviderMissingError,
    );
  });
});
