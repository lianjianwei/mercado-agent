import type { ProviderFactoryRegistration } from './provider-registry';
import { DoubaoTextProvider } from './text/doubao';
import { DeepSeekTextProvider } from './text/deepseek';
import { OpenAiTextProvider } from './text/openai';
import { OpenAiImageProvider } from './image/openai';
import { ProviderUnavailableError } from '../../domain/providers';
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

  const image = (['openai'] as const).map((provider) => ({
    kind: 'image' as const,
    provider,
    create: (configuration: ProviderConfig) =>
      new OpenAiImageProvider(
        { baseUrl: configuration.baseUrl, apiKey: configuration.apiKey, model: configuration.model },
        network,
        (url, signal) => downloadBytes(network, url, signal),
      ),
  }));

  return [...text, ...image] as ProviderFactoryRegistration[];
}

async function downloadBytes(network: ModelNetworkTransport, url: string, signal: AbortSignal): Promise<Buffer> {
  const response = await network.fetch(url, { method: 'GET', signal });
  if (!response.ok) throw new ProviderUnavailableError('参考图下载失败。');
  return Buffer.from(await response.arrayBuffer());
}
