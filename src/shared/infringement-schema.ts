import { z } from 'zod';

export const infringementRiskLevelSchema = z.enum([
  'none',
  'low',
  'medium',
  'high',
]);

export const infringementKindSchema = z.enum([
  'brand_owner',
  'compatible_accessory',
  'unbranded',
  'unknown',
]);

export const infringementEvidenceSchema = z.strictObject({
  source: z.enum(['image', 'text']),
  quote: z.string().trim().min(1),
  explanation: z.string().trim().min(1),
});

export const aiInfringementDecisionSchema = z.strictObject({
  level: infringementRiskLevelSchema,
  kind: infringementKindSchema,
  summary: z.string().trim().min(1),
  evidence: z.array(infringementEvidenceSchema).min(1),
  imageEvidence: z.array(z.string().trim().min(1)).default([]),
});

export type AiInfringementDecision = z.infer<
  typeof aiInfringementDecisionSchema
>;
