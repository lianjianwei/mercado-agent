import { z } from 'zod';

// Structured output schema for the AI edit generation prompt.
//
// The model returns one object with the edited fields and a per-field
// confidence. Values that should stay unchanged are returned verbatim with
// low confidence. The strict schemas reject any unexpected or malformed shape
// so a bad model response never overwrites an existing draft.

const generatedFieldSchema = z.strictObject({
  value: z.string().trim(),
  confidence: z.number().min(0).max(1),
});

export const generatedTitleSchema = generatedFieldSchema.extend({
  value: z.string().trim().min(1).max(60),
});

// Package dimensions + weight are estimated per SKU, so the model outputs
// them inside each sku entry. Units are fixed (cm/g); the model returns bare
// numbers only.
const aiSkuPackageSchema = z.strictObject({
  length: generatedFieldSchema,
  width: generatedFieldSchema,
  height: generatedFieldSchema,
  weight: generatedFieldSchema,
});

export const aiSkuEditSchema = z.strictObject({
  skuKey: z.string().min(1),
  name: generatedFieldSchema,
  package: aiSkuPackageSchema,
});

export const aiEditOutputSchema = z.strictObject({
  title: generatedTitleSchema,
  description: generatedFieldSchema,
  brand: generatedFieldSchema,
  model: generatedFieldSchema,
  skus: z.array(aiSkuEditSchema),
});

export type AiEditOutput = z.infer<typeof aiEditOutputSchema>;

// Runtime validation for a full EditDraft as exchanged over IPC. The AI
// output schema above covers the model response only; a draft also carries a
// per-field source ('remote' | 'ai' | 'user') and an overall version.
const draftFieldSchema = z.strictObject({
  value: z.string(),
  source: z.enum(['remote', 'ai', 'user']),
  confidence: z.number().min(0).max(1),
});

export const editDraftSchema = z.strictObject({
  version: z.number().int().positive(),
  createdAt: z.string(),
  title: draftFieldSchema,
  description: draftFieldSchema,
  brand: draftFieldSchema,
  model: draftFieldSchema,
  skus: z.array(
    z.strictObject({
      skuKey: z.string().min(1),
      name: draftFieldSchema,
      stock: draftFieldSchema,
      sourcePrice: draftFieldSchema,
      package: z.strictObject({
        length: draftFieldSchema,
        width: draftFieldSchema,
        height: draftFieldSchema,
        dimensionUnit: z.literal('cm'),
        weight: draftFieldSchema,
        weightUnit: z.literal('g'),
      }),
    }),
  ),
});
