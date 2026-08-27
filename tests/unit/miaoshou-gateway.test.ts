import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  MiaoshouAuthenticationError,
  MiaoshouCancelledError,
  MiaoshouInvalidResponseError,
  MiaoshouTimeoutError,
} from '../../src/main/gateways/miaoshou/errors';
import {
  formatMiaoshouInvalidResponseDiagnostics,
  HttpMiaoshouGateway,
  type HttpMiaoshouGatewayOptions,
  type MiaoshouLogEvent,
} from '../../src/main/gateways/miaoshou/http-miaoshou-gateway';

const credentials = {
  appKey: 'ak_test_123',
  appSecret: 'as_secret_123',
  baseUrl: 'https://openapi-erp.91miaoshou.com/',
};

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(
      path.join(process.cwd(), 'tests', 'fixtures', 'miaoshou', name),
      'utf8',
    ),
  );
}

describe('HttpMiaoshouGateway', () => {
  it('sends the exact compact list body with second-level signed headers', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const gateway = new HttpMiaoshouGateway(credentials, {
      now: () => 1_720_000_000_123,
      fetcher: async (input, init) => {
        capturedUrl = String(input);
        capturedInit = init;
        return Response.json(fixture('list-success.json'));
      },
    });

    await expect(
      gateway.listCollectBox({
        pageNo: 1,
        pageSize: 20,
        filter: { status: 'notPublished', filterCidSite: 'CBT' },
      }),
    ).resolves.toMatchObject({ total: 1, items: [{ collectBoxDetailId: '90001' }] });

    expect(capturedUrl).toBe(
      'https://openapi-erp.91miaoshou.com/open/v1/product/collect_box/mercadolibre/collect_box/search_collect_box_detailList',
    );
    expect(capturedInit?.method).toBe('POST');
    expect(capturedInit?.body).toBe(
      '{"pageNo":1,"pageSize":20,"filter":{"status":"notPublished","filterCidSite":"CBT"}}',
    );
    expect(capturedInit?.headers).toEqual({
      'Content-Type': 'application/json',
      'x-app-key': 'ak_test_123',
      'x-timestamp': '1720000000',
      'x-sign': 'e80698540d76ba4915ae74a1d4bcf1f2fd9e3019f221f7930ac955f332e0259c',
    });
  });

  it('paces consecutive API requests to stay below the observed Miaoshou rate limit', async () => {
    let monotonicTime = 0;
    const waits: number[] = [];
    const options: HttpMiaoshouGatewayOptions = {
      fetcher: async () => {
        monotonicTime += 400;
        return Response.json(fixture('list-success.json'));
      },
      requestIntervalMs: 1_100,
      monotonicNow: () => monotonicTime,
      wait: async (milliseconds: number) => {
        waits.push(milliseconds);
        monotonicTime += milliseconds;
      },
    };
    const gateway = new HttpMiaoshouGateway(credentials, options);

    await gateway.listCollectBox({ pageNo: 1, pageSize: 20 });
    await gateway.listCollectBox({ pageNo: 2, pageSize: 20 });

    expect(waits).toEqual([1_100]);
  });

  it('requests a numeric detail id and returns the validated detail DTO', async () => {
    let requestBody = '';
    const gateway = new HttpMiaoshouGateway(credentials, {
      fetcher: async (_input, init) => {
        requestBody = String(init?.body);
        return Response.json(fixture('detail-success.json'));
      },
    });

    const detail = await gateway.getCollectBoxDetail('90001');
    expect(requestBody).toBe('{"detailId":90001}');
    expect(detail.siteCollectItemInfo).toMatchObject({
      collectBoxDetailId: '90001',
      title: 'Silicone Kitchen Brush',
    });
  });

  it('maps authentication codes to a safe typed error without logging secrets', async () => {
    const events: MiaoshouLogEvent[] = [];
    const gateway = new HttpMiaoshouGateway(credentials, {
      logger: (event) => events.push(event),
      fetcher: async () => Response.json(fixture('auth-failure.json')),
    });

    await expect(
      gateway.listCollectBox({ pageNo: 1, pageSize: 20 }),
    ).rejects.toBeInstanceOf(MiaoshouAuthenticationError);
    expect(JSON.stringify(events)).not.toContain(credentials.appKey);
    expect(JSON.stringify(events)).not.toContain(credentials.appSecret);
    expect(JSON.stringify(events)).not.toContain('x-sign');
    expect(events).toMatchObject([
      { operation: 'listCollectBox', outcome: 'api_error', code: 'signInvalid' },
    ]);
  });

  it('distinguishes documented rate-limit codes from other API failures', async () => {
    const gateway = new HttpMiaoshouGateway(credentials, {
      fetcher: async () =>
        Response.json({
          result: 'fail',
          code: 'accountQpsRateLimit',
          message: 'raw upstream message',
          data: null,
        }),
    });

    const error = await gateway
      .listCollectBox({ pageNo: 1, pageSize: 20 })
      .catch((reason: unknown) => reason);
    expect(error).toMatchObject({
      name: 'MiaoshouRateLimitError',
      code: 'accountQpsRateLimit',
      message: '妙手接口调用频率已达到限制，请稍后重试。',
    });
    expect(String(error)).not.toContain('raw upstream message');
  });

  it('preserves documented operational error codes without exposing upstream messages', async () => {
    const events: MiaoshouLogEvent[] = [];
    const gateway = new HttpMiaoshouGateway(credentials, {
      logger: (event) => events.push(event),
      fetcher: async () =>
        Response.json({
          result: 'fail',
          code: 'upstreamReadTimeout',
          message: 'raw upstream infrastructure detail',
          data: null,
        }),
    });

    const error = await gateway
      .listCollectBox({ pageNo: 2, pageSize: 20 })
      .catch((reason: unknown) => reason);
    expect(error).toMatchObject({
      name: 'MiaoshouApiError',
      code: 'upstreamReadTimeout',
    });
    expect(events).toMatchObject([{ code: 'upstreamReadTimeout' }]);
    expect(String(error)).not.toContain('raw upstream infrastructure detail');
  });

  it('rejects malformed success JSON with a safe validation error', async () => {
    const events: MiaoshouLogEvent[] = [];
    const diagnostics: unknown[] = [];
    const gateway = new HttpMiaoshouGateway(credentials, {
      logger: (event) => events.push(event),
      onInvalidResponse: (diagnostic) => diagnostics.push(diagnostic),
      fetcher: async () =>
        Response.json({
          result: 'success',
          code: 'success',
          data: { total: 0, upstreamSecret: 'must-not-be-reported' },
        }),
    });

    await expect(
      gateway.listCollectBox({ pageNo: 1, pageSize: 20 }),
    ).rejects.toBeInstanceOf(MiaoshouInvalidResponseError);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      operation: 'listCollectBox',
      outcome: 'invalid_response',
    });
    expect(diagnostics).toMatchObject([{
      operation: 'listCollectBox',
      issues: [{ path: 'data.detailList' }],
      shape: {
        code: 'string',
        data: { total: 'number', upstreamSecret: 'string' },
        result: 'string',
      },
    }]);
    expect(JSON.stringify(diagnostics)).not.toContain('must-not-be-reported');
  });

  it('formats large response diagnostics as deduplicated issue paths without the full shape', () => {
    const formatted = formatMiaoshouInvalidResponseDiagnostics([{
      operation: 'listCollectBox',
      issues: [
        {
          path: 'data.detailList.0.collectBoxDetailId',
          message: 'Invalid input: expected string, received number',
        },
        {
          path: 'data.detailList.1.collectBoxDetailId',
          message: 'Invalid input: expected string, received number',
        },
      ],
      shape: {
        data: {
          detailList: {
            type: 'array',
            length: 500,
            item: {
              collectBoxDetailId: 'number',
              upstreamSecret: 'string',
            },
          },
        },
      },
    }]);

    expect(formatted).toContain(
      '"path": "data.detailList[].collectBoxDetailId"',
    );
    expect(formatted).toContain('"occurrences": 2');
    expect(formatted).not.toContain('"shape"');
    expect(formatted).not.toContain('upstreamSecret');
    expect(formatted).not.toContain('[Object]');
  });

  it('aborts a stalled request at the configured timeout without leaking network errors', async () => {
    const fetcher = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('raw timeout with as_secret_123', 'AbortError')),
            { once: true },
          );
        }),
    );
    const gateway = new HttpMiaoshouGateway(credentials, {
      fetcher,
      timeoutMs: 10,
    });

    const error = await gateway
      .listCollectBox({ pageNo: 1, pageSize: 20 })
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(MiaoshouTimeoutError);
    expect(String(error)).not.toContain('as_secret_123');
  });

  it('keeps timeout protection active while the response body is stalled', async () => {
    const gateway = new HttpMiaoshouGateway(credentials, {
      fetcher: async () =>
        ({
          ok: true,
          status: 200,
          json: () => new Promise(() => undefined),
        }) as Response,
      timeoutMs: 10,
    });

    await expect(
      gateway.listCollectBox({ pageNo: 1, pageSize: 20 }),
    ).rejects.toBeInstanceOf(MiaoshouTimeoutError);
  });

  it('honours external cancellation while the response body is stalled', async () => {
    const controller = new AbortController();
    const gateway = new HttpMiaoshouGateway(credentials, {
      fetcher: async () =>
        ({
          ok: true,
          status: 200,
          json: () => new Promise(() => undefined),
        }) as Response,
      timeoutMs: 10_000,
    });

    const request = gateway.listCollectBox(
      { pageNo: 1, pageSize: 20 },
      controller.signal,
    );
    controller.abort();
    await expect(request).rejects.toBeInstanceOf(MiaoshouCancelledError);
  });

  it('replaces unknown upstream error codes before logging or exposing them', async () => {
    const events: MiaoshouLogEvent[] = [];
    const gateway = new HttpMiaoshouGateway(credentials, {
      logger: (event) => events.push(event),
      fetcher: async () =>
        Response.json({
          result: 'fail',
          code: 'as_secret_123\nforged-log-entry',
          message: 'unsafe upstream body',
        }),
    });

    const error = await gateway
      .listCollectBox({ pageNo: 1, pageSize: 20 })
      .catch((reason: unknown) => reason);
    expect(error).toMatchObject({
      name: 'MiaoshouApiError',
      code: 'unknown_api_error',
    });
    expect(JSON.stringify(events)).not.toContain('as_secret_123');
    expect(JSON.stringify(events)).not.toContain('forged-log-entry');
    expect(events).toMatchObject([{ code: 'unknown_api_error' }]);
  });

  it('rejects unsafe detail ids before making a request', async () => {
    const fetcher = vi.fn();
    const gateway = new HttpMiaoshouGateway(credentials, { fetcher });

    await expect(gateway.getCollectBoxDetail('90001/path')).rejects.toThrow(
      '采集箱详情 ID 无效',
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
