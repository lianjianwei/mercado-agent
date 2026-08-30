import type { ProviderFactoryRegistration } from './provider-registry';
import { DoubaoTextProvider } from './text/doubao';
import { DeepSeekTextProvider } from './text/deepseek';
import { OpenAiTextProvider } from './text/openai';
import { OpenAiImageProvider } from './image/openai';
import { CodexImageProvider, type CodexProxyConfig } from './image/codex';
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
  network: ModelNetworkTransport, // 走模型代理的网络:openai(文本/生图) + codex
  options?: {
    direct?: ModelNetworkTransport; // 直连网络:豆包/DeepSeek(无需代理,避免被代理拖慢)
    codex?: {
      proxy: () => CodexProxyConfig | null;
      scratchDir: string;
    };
  },
): ProviderFactoryRegistration[] {
  const direct = options?.direct ?? network;
  const text = (
    [
      ['doubao', direct],
      ['deepseek', direct],
      ['openai', network],
    ] as const
  ).map(([provider, transport]) => ({
    kind: 'text' as const,
    provider,
    create: (configuration: ProviderConfig) =>
      createTextProvider(textProviders[provider], configuration, transport),
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

  const codexOptions = options?.codex;
  const codexRegistration: ProviderFactoryRegistration[] = codexOptions
    ? [{
        kind: 'image' as const,
        provider: 'codex' as const,
        create: (configuration: ProviderConfig) =>
          new CodexImageProvider(
            { model: configuration.model, scratchDir: codexOptions.scratchDir, proxy: codexOptions.proxy },
            (url, signal) => downloadBytes(network, url, signal),
          ),
      }]
    : [];

  return [...text, ...image, ...codexRegistration] as ProviderFactoryRegistration[];
}

async function downloadBytes(network: ModelNetworkTransport, url: string, signal: AbortSignal): Promise<Buffer> {
  const response = await network.fetch(url, { method: 'GET', signal });
  if (!response.ok) throw new ProviderUnavailableError('参考图下载失败。');
  return Buffer.from(await response.arrayBuffer());
}
