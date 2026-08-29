import { describe, expect, it, vi } from 'vitest';
import { ImagePlanner } from '../../src/main/services/image-planner';
import type { TextModelProvider } from '../../src/domain/providers';

const fakeText = (returnValue: unknown): TextModelProvider => ({
  testConnection: vi.fn(),
  generate: vi.fn(async () => returnValue),
}) as unknown as TextModelProvider;

describe('ImagePlanner', () => {
  it('maps a text provider plan payload into DetailPlanItem[]', async () => {
    const planner = new ImagePlanner(() => fakeText({ plans: [
      { id: 'd1', kind: '功能图', subject: '功能', textEs: 'Es', textPt: 'Pt', hasPerson: false, referenceNote: 'ref1' },
    ]}));
    const plans = await planner.plan({ title: 'T', description: 'D', category: '猫砂', referenceImageUrls: ['https://x/a.png'] });
    expect(plans).toHaveLength(1);
    expect(plans[0].kind).toBe('功能图');
  });
  it('caps the plan at 6 images', async () => {
    const many = { plans: Array.from({ length: 9 }, (_, i) => ({ id: `d${i}`, kind: '功能图', subject: 'x', textEs: '', textPt: '', hasPerson: false, referenceNote: '' })) };
    const planner = new ImagePlanner(() => fakeText(many));
    const plans = await planner.plan({ title: 'T', description: 'D', category: 'C', referenceImageUrls: [] });
    expect(plans.length).toBeGreaterThanOrEqual(4);
    expect(plans.length).toBeLessThanOrEqual(6);
  });
});
