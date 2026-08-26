import type { ProviderFactoryRegistration } from './provider-registry';
import { BearerModelConnectionProvider } from './bearer-model-connection-provider';
import type { ModelNetworkTransport } from '../network/model-network-client';

export function createDefaultProviderRegistrations(
  network: ModelNetworkTransport,
): ProviderFactoryRegistration[] {
  return [
    ['text', 'doubao'],
    ['text', 'deepseek'],
    ['text', 'openai'],
    ['image', 'doubao'],
    ['image', 'openai'],
  ].map(([kind, provider]) => ({
    kind,
    provider,
    create: (configuration) =>
      new BearerModelConnectionProvider(configuration, network),
  })) as ProviderFactoryRegistration[];
}
