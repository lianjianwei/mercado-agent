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

export const aiSkuEditSchema = z.strictObject({
  skuKey: z.string().min(1),
  name: generatedFieldSchema,
});

export const aiEditOutputSchema = z.strictObject({
  title: generatedTitleSchema,
  description: generatedFieldSchema,
  brand: generatedFieldSchema,
  model: generatedFieldSchema,
  skus: z.array(aiSkuEditSchema),
  package: z.strictObject({
    length: generatedFieldSchema,
    width: generatedFieldSchema,
    height: generatedFieldSchema,
    dimensionUnit: generatedFieldSchema,
    weight: generatedFieldSchema,
    weightUnit: generatedFieldSchema,
  }),
});

export type AiEditOutput = z.infer<typeof aiEditOutputSchema>;
