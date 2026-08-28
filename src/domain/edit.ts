// AI edit draft domain model.
//
// A draft is the second of two snapshots a product can carry: the `miaoshou`
// snapshot mirrors what Miaoshou has, and the `aiDraft` snapshot mirrors what
// the AI edit produced. They diverge after an AI edit and would converge again
// once the draft is saved back to Miaoshou (a later sub-phase). The draft is
// stored in the shared product_snapshots table under kind `aiDraft`.

export type EditFieldSource = 'remote' | 'ai' | 'user';

// A single draft field. `source` records where the current value came from:
// remote (unchanged from the original), ai (generated), or user (edited after
// generation). `confidence` is the AI's 0-1 confidence for generated values.
export type EditField = {
  value: string;
  source: EditFieldSource;
  confidence: number;
};

// Package dimensions (length × width × height, fixed cm) and billing weight
// (fixed g). Values may come from the AI reading the original Miaoshou data
// and the product images, so they are hints, not ground truth. Units are
// fixed constants, not model-output fields.
export const DIMENSION_UNIT = 'cm';
export const WEIGHT_UNIT = 'g';

export type PackageEditField = {
  length: EditField;
  width: EditField;
  height: EditField;
  dimensionUnit: typeof DIMENSION_UNIT;
  weight: EditField;
  weightUnit: typeof WEIGHT_UNIT;
};

export type SkuEditField = {
  skuKey: string;
  name: EditField;
};

export type EditDraft = {
  version: number;
  createdAt: string;
  title: EditField;
  description: EditField;
  brand: EditField;
  model: EditField;
  skus: SkuEditField[];
  package: PackageEditField;
};

export interface EditDraftRepository {
  readDraft(productId: string): EditDraft | null;
  saveDraft(productId: string, draft: EditDraft): void;
}
