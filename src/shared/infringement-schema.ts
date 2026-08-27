import { z } from 'zod';

export type RiskLevel = 'none' | 'low' | 'medium' | 'high';

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

export type InfringementEvidence = {
  source: 'image' | 'text';
  quote: string;
  explanation: string;
};

export type InfringementDecision = {
  level: z.infer<typeof infringementRiskLevelSchema>;
  kind: z.infer<typeof infringementKindSchema>;
  fingerprint: string;
  imagesIncluded: boolean;
  rules: Array<{ rule: string; level: z.infer<typeof infringementRiskLevelSchema>; reason: string }>;
  summary: string;
  evidence: InfringementEvidence[];
  ai: {
    summary: string;
    evidence: InfringementEvidence[];
    imageEvidence: string[];
  } | null;
};
