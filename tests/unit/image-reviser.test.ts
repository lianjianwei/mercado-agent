import { describe, expect, it, vi } from 'vitest';
import { ImageReviser, shouldRegenerate } from '../../src/main/services/image-reviser';
import type { TextModelProvider } from '../../src/domain/providers';

const fakeText = (v: unknown): TextModelProvider => ({
  testConnection: vi.fn(), generate: vi.fn(async () => v),
}) as unknown as TextModelProvider;

describe('ImageReviser', () => {
  it('reports ok when the model finds no issues', async () => {
    const reviser = new ImageReviser(() => fakeText({ ok: true, issues: [] }));
    const review = await reviser.review({ imageUrl: 'https://x/i.png', context: { title: 'T', description: 'D', kind: 'main' } });
    expect(review.ok).toBe(true);
  });
  it('shouldRegenerate matches !ok', () => {
    expect(shouldRegenerate({ ok: false, issues: ['多指'] })).toBe(true);
    expect(shouldRegenerate({ ok: true, issues: [] })).toBe(false);
  });
});
