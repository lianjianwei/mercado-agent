import { describe, expect, it } from 'vitest';

import rendererConfig from '../../vite.renderer.config.mts';

describe('renderer production output', () => {
  it('writes renderer assets into the Forge packaged .vite directory', () => {
    expect(rendererConfig).toMatchObject({
      root: 'src',
      build: {
        outDir: '../.vite/renderer/main_window',
      },
    });
  });
});
