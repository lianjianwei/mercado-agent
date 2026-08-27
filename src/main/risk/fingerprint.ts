import { createHash } from 'node:crypto';

export type RiskRelevantProduct = {
  title: string | null;
  description: string | null;
  brand: string | null;
  category: string | null;
  attributes: Record<string, string | null>;
  skuName: string | null;
  imageUrls: string[];
};

function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, v]) => `${JSON.stringify(key)}:${canonicalJson(v)}`);
    return `{${entries.join(',')}}`;
  }
  return String(value);
}

export function riskFingerprint(input: RiskRelevantProduct): string {
  const payload = {
    title: input.title,
    description: input.description,
    brand: input.brand,
    category: input.category,
    attributes: input.attributes,
    skuName: input.skuName,
    imageUrls: input.imageUrls,
  };
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}
