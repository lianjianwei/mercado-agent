import { describe, expect, it } from 'vitest';

import { aiEditOutputSchema, type AiEditOutput } from '../../src/shared/edit-output-schema';

function validOutput(): AiEditOutput {
  return {
    title: { value: 'Cafetera de goteo automática 0.6L', confidence: 0.95 },
    description: { value: 'Muele café en grano con una cuchilla de acero inoxidable.', confidence: 0.88 },
    brand: { value: 'Generic', confidence: 1 },
    model: { value: 'CM-100', confidence: 0.6 },
    skus: [
      {
        skuKey: ';white;',
        name: { value: 'Blanco', confidence: 0.9 },
        package: {
          length: { value: '20', confidence: 0.7 },
          width: { value: '15', confidence: 0.7 },
          height: { value: '12', confidence: 0.7 },
          weight: { value: '900', confidence: 0.8 },
        },
      },
      {
        skuKey: ';black;',
        name: { value: 'Negro', confidence: 0.9 },
        package: {
          length: { value: '20', confidence: 0.7 },
          width: { value: '15', confidence: 0.7 },
          height: { value: '12', confidence: 0.7 },
          weight: { value: '900', confidence: 0.8 },
        },
      },
    ],
  };
}

describe('AI edit output schema', () => {
  it('accepts a well-formed generation output', () => {
    const result = aiEditOutputSchema.safeParse(validOutput());
    expect(result.success).toBe(true);
  });

  it('rejects a title longer than 60 characters', () => {
    const output = validOutput();
    output.title.value = 'x'.repeat(61);
    const result = aiEditOutputSchema.safeParse(output);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join('.') === 'title.value')).toBe(true);
    }
  });

  it('rejects a title trimmed to empty', () => {
    const output = validOutput();
    output.title.value = '   ';
    expect(aiEditOutputSchema.safeParse(output).success).toBe(false);
  });

  it('rejects confidence outside 0..1', () => {
    const output = validOutput();
    output.title.confidence = 1.5;
    expect(aiEditOutputSchema.safeParse(output).success).toBe(false);
  });

  it('rejects unexpected fields (strict schema)', () => {
    const output = validOutput() as Record<string, unknown> & { bonus?: string };
    output.bonus = 'unexpected';
    expect(aiEditOutputSchema.safeParse(output).success).toBe(false);
  });

  it('rejects a sku entry missing its skuKey', () => {
    const output = validOutput();
    output.skus = [{ name: { value: 'Blanco', confidence: 0.9 } }] as never;
    expect(aiEditOutputSchema.safeParse(output).success).toBe(false);
  });

  it('accepts an empty sku list for a product with no SKUs', () => {
    const output = validOutput();
    output.skus = [];
    expect(aiEditOutputSchema.safeParse(output).success).toBe(true);
  });

  it('rejects a non-string package weight inside a sku', () => {
    const output = validOutput();
    // Make weight a number instead of a string value to exercise the type guard.
    const malformed = {
      ...output,
      skus: output.skus.map((sku, index) =>
        index === 0
          ? { ...sku, package: { ...sku.package, weight: { value: 0.9, confidence: 0.8 } } }
          : sku,
      ),
    };
    expect(aiEditOutputSchema.safeParse(malformed).success).toBe(false);
  });
});
