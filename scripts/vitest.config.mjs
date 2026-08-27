import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['scripts/verify-miaoshou-read.ts'],
    testTimeout: 30_000,
  },
});
