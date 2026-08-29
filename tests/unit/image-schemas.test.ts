import { describe, expect, it } from 'vitest';
import { detailPlanSchema, imageReviewSchema, aiImagesSnapshotSchema } from '../../src/shared/image-schemas';

const goodPlan = {
  plans: [{ id: 'd1', kind: '尺寸图', subject: '尺寸', textEs: 'Alto', textPt: 'Altura', hasPerson: false, referenceNote: 'ref1' }],
};

const greenReview = { ok: true, issues: [] };
const badReview = { ok: false, issues: ['多指'] };

describe('image schemas', () => {
  it('accepts a valid detail plan and rejects unknown kinds', () => {
    expect(detailPlanSchema.safeParse(goodPlan).success).toBe(true);
    expect(detailPlanSchema.safeParse({ plans: [{ ...goodPlan.plans[0], kind: '不存在' }] }).success).toBe(false);
  });
  it('validates image review and a full aiImages snapshot', () => {
    expect(imageReviewSchema.safeParse(greenReview).success).toBe(true);
    expect(imageReviewSchema.safeParse(badReview).success).toBe(true); // ok:false allowed (issues present)
    const snapshot = {
      version: 1, productId: 'p1', mainImages: [], detailImages: [],
      plan: goodPlan.plans, status: 'done' as const, createdAt: '2026-08-29T00:00:00.000Z',
    };
    expect(aiImagesSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });
});
