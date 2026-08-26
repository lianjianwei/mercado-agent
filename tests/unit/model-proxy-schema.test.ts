import { describe, expect, it } from 'vitest';

import { modelProxyConfigSchema } from '../../src/shared/config-schemas';

describe('model proxy configuration', () => {
  it('accepts an explicitly disabled empty configuration', () => {
    expect(
      modelProxyConfigSchema.parse({
        enabled: false,
        protocol: 'http',
        host: '',
        port: null,
      }),
    ).toEqual({ enabled: false, protocol: 'http', host: '', port: null });
  });

  it.each([
    { host: '', port: 7890 },
    { host: 'http://127.0.0.1', port: 7890 },
    { host: '127.0.0.1/path', port: 7890 },
    { host: 'user@127.0.0.1', port: 7890 },
    { host: '127.0.0.1', port: 0 },
    { host: '127.0.0.1', port: 65_536 },
    { host: '127.0.0.1', port: 7890.5 },
  ])('rejects unsafe enabled values: %o', ({ host, port }) => {
    expect(
      modelProxyConfigSchema.safeParse({
        enabled: true,
        protocol: 'http',
        host,
        port,
      }).success,
    ).toBe(false);
  });

  it('trims a valid host and preserves the numeric port', () => {
    expect(
      modelProxyConfigSchema.parse({
        enabled: true,
        protocol: 'http',
        host: ' 127.0.0.1 ',
        port: 7890,
      }),
    ).toEqual({
      enabled: true,
      protocol: 'http',
      host: '127.0.0.1',
      port: 7890,
    });
  });
});
