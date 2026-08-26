import { describe, expect, it } from 'vitest';

import {
  appCredentialsInputSchema,
  providerConfigInputSchema,
} from '../../src/shared/config-schemas';

describe('provider configuration input', () => {
  it('rejects an empty API key', () => {
    const result = providerConfigInputSchema.safeParse({
      kind: 'text',
      provider: 'openai',
      name: 'OpenAI',
      apiKey: '',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5',
    });

    expect(result.success).toBe(false);
  });

  it('rejects DeepSeek as an image provider', () => {
    const result = providerConfigInputSchema.safeParse({
      kind: 'image',
      provider: 'deepseek',
      name: '非法生图配置',
      apiKey: 'secret',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-image',
    });

    expect(result.success).toBe(false);
  });

  it('accepts a valid custom Base URL without supplying a default', () => {
    const result = providerConfigInputSchema.safeParse({
      kind: 'text',
      provider: 'doubao',
      name: '公司代理',
      apiKey: 'secret',
      baseUrl: 'https://models.example.com/doubao/v3',
      model: 'doubao-seed',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.baseUrl).toBe('https://models.example.com/doubao/v3');
    }
  });
});

describe('application credential input', () => {
  it('rejects an empty credential update', () => {
    expect(appCredentialsInputSchema.safeParse({}).success).toBe(false);
  });

  it('rejects missing Miaoshou and Qiniu required fields', () => {
    expect(
      appCredentialsInputSchema.safeParse({
        miaoshou: { appKey: '', appSecret: '', baseUrl: '' },
      }).success,
    ).toBe(false);
    expect(
      appCredentialsInputSchema.safeParse({
        qiniu: {
          accessKey: 'access',
          secretKey: '',
          bucket: '',
          domain: 'not-a-url',
          region: '',
        },
      }).success,
    ).toBe(false);
  });

  it('accepts a complete Miaoshou or Qiniu update independently', () => {
    expect(
      appCredentialsInputSchema.safeParse({
        miaoshou: {
          appKey: 'app-key',
          appSecret: 'app-secret',
          baseUrl: 'https://openapi.example.com',
        },
      }).success,
    ).toBe(true);
    expect(
      appCredentialsInputSchema.safeParse({
        qiniu: {
          accessKey: 'access-key',
          secretKey: 'secret-key',
          bucket: 'products',
          domain: 'https://images.example.com',
          region: 'z0',
        },
      }).success,
    ).toBe(true);
  });
});
