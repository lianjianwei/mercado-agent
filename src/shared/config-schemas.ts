import { z } from 'zod';

const requiredText = z.string().trim().min(1);
const requiredUrl = z.string().trim().url();

const providerConfigFields = {
  id: z.string().uuid().optional(),
  name: requiredText,
  apiKey: requiredText,
  baseUrl: requiredUrl,
  model: requiredText,
};

export const providerKindSchema = z.enum(['text', 'image']);

export const providerConfigInputSchema = z.discriminatedUnion('kind', [
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
