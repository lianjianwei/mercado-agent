import { describe, expect, it } from 'vitest';

import { createMainWindowOptions } from '../../src/main/window-options';

describe('main window security', () => {
  it('isolates the renderer from Node.js capabilities', () => {
    const options = createMainWindowOptions('/app/preload.js');

    expect(options.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    });
  });
});
