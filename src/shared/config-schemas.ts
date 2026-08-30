import { z } from 'zod';

const requiredText = z.string().trim().min(1);
const requiredUrl = z.string().trim().url();
const proxyHost = z
  .string()
  .trim()
  .refine(
    (value) => value === '' || !/[\s/:@?#]/.test(value),
    'Enter a host without protocol, path or credentials',
  );

export const modelProxyConfigSchema = z
  .strictObject({
    enabled: z.boolean(),
    protocol: z.literal('http'),
    host: proxyHost,
    port: z.number().int().min(1).max(65_535).nullable(),
  })
  .superRefine((value, context) => {
    if (!value.enabled) return;
    if (!value.host) {
      context.addIssue({
        code: 'custom',
        path: ['host'],
        message: 'Proxy host is required',
      });
    }
    if (value.port === null) {
      context.addIssue({
        code: 'custom',
        path: ['port'],
        message: 'Proxy port is required',
      });
    }
  });

const providerConfigFields = {
  id: z.string().uuid().optional(),
  name: requiredText,
  apiKey: requiredText,
  baseUrl: requiredUrl,
  model: requiredText,
};

export const providerKindSchema = z.enum(['text', 'image']);

export const providerConfigInputSchema = z.union([
  z.strictObject({
    ...providerConfigFields,
    kind: z.literal('text'),
    provider: z.enum(['doubao', 'deepseek', 'openai']),
  }),
  z.strictObject({
    ...providerConfigFields,
    kind: z.literal('image'),
    provider: z.enum(['doubao', 'openai']),
  }),
  // codex:调用本机 codex CLI 生图,无需 baseUrl/apiKey/model。
  z.strictObject({
    id: z.string().uuid().optional(),
    name: requiredText,
    kind: z.literal('image'),
    provider: z.literal('codex'),
    apiKey: z.string().optional().default(''),
    baseUrl: z.string().optional().default(''),
    model: z.string().optional().default(''),
  }),
]);

export const providerIdSchema = z.string().uuid();

export const miaoshouCredentialSchema = z.strictObject({
  appKey: requiredText,
  appSecret: requiredText,
  baseUrl: requiredUrl,
});

export const qiniuCredentialSchema = z.strictObject({
  accessKey: requiredText,
  secretKey: requiredText,
  bucket: requiredText,
  domain: requiredUrl,
  region: requiredText,
});

export const appCredentialsInputSchema = z
  .strictObject({
    miaoshou: miaoshouCredentialSchema.optional(),
    qiniu: qiniuCredentialSchema.optional(),
  })
  .refine((value) => value.miaoshou || value.qiniu, {
    message: 'At least one credential group is required',
  });

export type AppCredentialsInput = z.infer<typeof appCredentialsInputSchema>;
