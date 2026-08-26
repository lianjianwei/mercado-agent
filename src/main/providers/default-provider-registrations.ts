import type { ProviderFactoryRegistration } from './provider-registry';
import { BearerModelConnectionProvider } from './bearer-model-connection-provider';

export function createDefaultProviderRegistrations(): ProviderFactoryRegistration[] {
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
      new BearerModelConnectionProvider(configuration),
  })) as ProviderFactoryRegistration[];
}
