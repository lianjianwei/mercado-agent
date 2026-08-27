import type { ProviderFactoryRegistration } from './provider-registry';
import { BearerModelConnectionProvider } from './bearer-model-connection-provider';
import { DoubaoTextProvider } from './text/doubao';
import { DeepSeekTextProvider } from './text/deepseek';
import { OpenAiTextProvider } from './text/openai';
import type { ModelNetworkTransport } from '../network/model-network-client';
import type { ProviderConfig } from '../../domain/config';

type TextProviderClass =
  | typeof DoubaoTextProvider
  | typeof DeepSeekTextProvider
  | typeof OpenAiTextProvider;

const textProviders: Record<string, TextProviderClass> = {
  doubao: DoubaoTextProvider,
  deepseek: DeepSeekTextProvider,
  openai: OpenAiTextProvider,
};

function createTextProvider(
  Provider: TextProviderClass,
  configuration: ProviderConfig,
  network: ModelNetworkTransport,
) {
  return new Provider(
    {
      baseUrl: configuration.baseUrl,
      apiKey: configuration.apiKey,
      model: configuration.model,
    },
    network,
  );
}

export function createDefaultProviderRegistrations(
  network: ModelNetworkTransport,
): ProviderFactoryRegistration[] {
  const text = (['doubao', 'deepseek', 'openai'] as const).map((provider) => ({
    kind: 'text' as const,
    provider,
    create: (configuration: ProviderConfig) =>
      createTextProvider(textProviders[provider], configuration, network),
  }));

  const image = (
    ['doubao', 'openai'] as const
  ).map((provider) => ({
    kind: 'image' as const,
    provider,
    create: (configuration: ProviderConfig) =>
      new BearerModelConnectionProvider(configuration, network),
  }));

  return [...text, ...image] as ProviderFactoryRegistration[];
}
