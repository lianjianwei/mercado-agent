import type { MiaoshouCredential } from '../../../domain/config';
import { ZodError } from 'zod';
import {
  collectBoxDetailResponseSchema,
  listCollectBoxInputSchema,
  parseCollectBoxPage,
  type CollectBoxDetailDto,
  type CollectBoxPageDto,
  type ListCollectBoxInput,
} from '../../../shared/miaoshou-schemas';
import {
  MiaoshouApiError,
  MiaoshouAuthenticationError,
  MiaoshouCancelledError,
  MiaoshouInvalidDetailIdError,
  MiaoshouInvalidResponseError,
  MiaoshouRateLimitError,
  MiaoshouTimeoutError,
  MiaoshouUnavailableError,
} from './errors';
import type { MiaoshouGateway } from './miaoshou-gateway';
import { compactMiaoshouBody, createMiaoshouSignature } from './signature';

const COLLECT_BOX_PATH =
  '/open/v1/product/collect_box/mercadolibre/collect_box/';
const LIST_PATH = `${COLLECT_BOX_PATH}search_collect_box_detailList`;
const DETAIL_PATH = `${COLLECT_BOX_PATH}get_site_collect_item_info`;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_REQUEST_INTERVAL_MS = 1_100;

const AUTHENTICATION_CODES = new Set([
  'appNotFound',
  'signMissing',
  'signExpired',
  'signInvalid',
  'appNoPermission',
  'ipNotInWhitelist',
]);

const RATE_LIMIT_CODES = new Set([
  'accountQpsRateLimit',
  'accountQpmRateLimit',
  'accountQpdRateLimit',
  'appQpsRateLimit',
  'appQpmRateLimit',
  'appQpdRateLimit',
  'apiQpsRateLimit',
  'apiQpmRateLimit',
  'apiQpdRateLimit',
  'platformQpsRateLimit',
  'platformQpmRateLimit',
  'platformQpdRateLimit',
]);

const OPERATIONAL_ERROR_CODES = new Set([
  'routeNotFound',
  'upstreamError',
  'upstreamConnectTimeout',
  'upstreamReadTimeout',
  'upstreamDnsError',
  'upstreamReset',
  'systemError',
  'redisConnectionError',
  'redisTimeout',
]);

type MiaoshouFetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type MiaoshouWait = (
  milliseconds: number,
  signal?: AbortSignal,
) => Promise<void>;

export type MiaoshouLogEvent = {
  operation: 'listCollectBox' | 'getCollectBoxDetail';
  outcome:
    | 'success'
    | 'api_error'
    | 'invalid_response'
    | 'timeout'
    | 'cancelled'
    | 'network_error';
  durationMs: number;
  code?: string;
  httpStatus?: number;
};

export type MiaoshouInvalidResponseDiagnostic = {
  operation: MiaoshouLogEvent['operation'];
  issues: Array<{ path: string; message: string }>;
  shape: unknown;
};

export function formatMiaoshouInvalidResponseDiagnostics(
  diagnostics: readonly MiaoshouInvalidResponseDiagnostic[],
): string {
  return JSON.stringify(
    diagnostics.map((diagnostic) => {
      const issueCounts = new Map<
        string,
        { path: string; message: string; occurrences: number }
      >();
      for (const issue of diagnostic.issues) {
        const path = issue.path.replace(/\.\d+(?=\.|$)/g, '[]');
        const key = `${path}\u0000${issue.message}`;
        const existing = issueCounts.get(key);
        if (existing) existing.occurrences += 1;
        else {
          issueCounts.set(key, {
            path,
            message: issue.message,
            occurrences: 1,
          });
        }
      }
      return {
        operation: diagnostic.operation,
        issues: [...issueCounts.values()],
      };
    }),
    null,
    2,
  );
}

export type HttpMiaoshouGatewayOptions = {
  fetcher?: MiaoshouFetcher;
  now?: () => number;
  monotonicNow?: () => number;
  timeoutMs?: number;
  requestIntervalMs?: number;
  wait?: MiaoshouWait;
  logger?: (event: MiaoshouLogEvent) => void;
  onInvalidResponse?: (diagnostic: MiaoshouInvalidResponseDiagnostic) => void;
};

type MiaoshouOperation = MiaoshouLogEvent['operation'];

export class HttpMiaoshouGateway implements MiaoshouGateway {
  private readonly baseUrl: string;
  private readonly fetcher: MiaoshouFetcher;
  private readonly now: () => number;
  private readonly monotonicNow: () => number;
  private readonly timeoutMs: number;
  private readonly requestIntervalMs: number;
  private readonly wait: MiaoshouWait;
  private readonly logger: (event: MiaoshouLogEvent) => void;
  private readonly onInvalidResponse: (
    diagnostic: MiaoshouInvalidResponseDiagnostic,
  ) => void;

  constructor(
    private readonly credentials: MiaoshouCredential,
    options: HttpMiaoshouGatewayOptions = {},
  ) {
    this.baseUrl = credentials.baseUrl.replace(/\/+$/, '');
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? Date.now;
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.requestIntervalMs = options.requestIntervalMs
      ?? DEFAULT_REQUEST_INTERVAL_MS;
    this.wait = options.wait ?? waitWithAbort;
    this.logger = options.logger ?? (() => undefined);
    this.onInvalidResponse = options.onInvalidResponse ?? (() => undefined);
  }

  private lastRequestCompletedAt: number | null = null;

  async listCollectBox(
    input: ListCollectBoxInput,
    signal?: AbortSignal,
  ): Promise<CollectBoxPageDto> {
    const request = listCollectBoxInputSchema.parse(input);
    const response = await this.post(
      'listCollectBox',
      LIST_PATH,
      request,
      signal,
    );
    try {
      const page = parseCollectBoxPage(response.payload, request);
      this.log(
        'listCollectBox',
        'success',
        response.startedAt,
        'success',
        response.httpStatus,
      );
      return page;
    } catch (error) {
      this.reportInvalidResponse('listCollectBox', response.payload, error);
      this.log(
        'listCollectBox',
        'invalid_response',
        response.startedAt,
        undefined,
        response.httpStatus,
      );
      throw new MiaoshouInvalidResponseError();
    }
  }

  async getCollectBoxDetail(
    detailId: string,
    signal?: AbortSignal,
  ): Promise<CollectBoxDetailDto> {
    if (!/^\d+$/.test(detailId)) throw new MiaoshouInvalidDetailIdError();
    const numericDetailId = Number(detailId);
    if (!Number.isSafeInteger(numericDetailId) || numericDetailId < 1) {
      throw new MiaoshouInvalidDetailIdError();
    }
    const response = await this.post(
      'getCollectBoxDetail',
      DETAIL_PATH,
      { detailId: numericDetailId },
      signal,
    );
    try {
      const detail = collectBoxDetailResponseSchema.parse(response.payload).data;
      this.log(
        'getCollectBoxDetail',
        'success',
        response.startedAt,
        'success',
        response.httpStatus,
      );
      return detail;
    } catch (error) {
      this.reportInvalidResponse('getCollectBoxDetail', response.payload, error);
      this.log(
        'getCollectBoxDetail',
        'invalid_response',
        response.startedAt,
        undefined,
        response.httpStatus,
      );
      throw new MiaoshouInvalidResponseError();
    }
  }

  private async post(
    operation: MiaoshouOperation,
    requestPath: string,
    body: Record<string, unknown>,
    externalSignal?: AbortSignal,
  ): Promise<{ payload: unknown; startedAt: number; httpStatus: number }> {
    const startedAt = performance.now();
    try {
      await this.waitForRequestSlot(externalSignal);
    } catch {
      this.throwRequestFailure(operation, startedAt, false, externalSignal);
    }
    const bodyJson = compactMiaoshouBody(body);
    const timestamp = String(Math.floor(this.now() / 1000));
    const controller = new AbortController();
    let timeoutTriggered = false;
    const onExternalAbort = () => controller.abort();
    if (externalSignal?.aborted) controller.abort();
    else externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
    const timeout = setTimeout(() => {
      timeoutTriggered = true;
      controller.abort();
    }, this.timeoutMs);

    try {
      let response: Response;
      try {
        response = await this.fetcher(`${this.baseUrl}${requestPath}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-app-key': this.credentials.appKey,
            'x-timestamp': timestamp,
            'x-sign': createMiaoshouSignature({
              appSecret: this.credentials.appSecret,
              path: requestPath,
              timestamp,
              appKey: this.credentials.appKey,
              bodyJson,
            }),
          },
          body: bodyJson,
          signal: controller.signal,
        });
      } catch {
        this.throwRequestFailure(
          operation,
          startedAt,
          timeoutTriggered,
          externalSignal,
        );
      }

      let payload: unknown;
      try {
        payload = await this.readJson(response, controller.signal);
      } catch {
        if (timeoutTriggered || externalSignal?.aborted) {
          this.throwRequestFailure(
            operation,
            startedAt,
            timeoutTriggered,
            externalSignal,
          );
        }
        this.log(
          operation,
          'invalid_response',
          startedAt,
          undefined,
          response.status,
        );
        throw new MiaoshouInvalidResponseError();
      }

      const code = this.readErrorCode(payload);
      if (!response.ok || code !== null) {
        const safeCode = this.toSafeErrorCode(code, response.status);
        this.log(operation, 'api_error', startedAt, safeCode, response.status);
        if (AUTHENTICATION_CODES.has(safeCode)) {
          throw new MiaoshouAuthenticationError(safeCode);
        }
        if (RATE_LIMIT_CODES.has(safeCode)) {
          throw new MiaoshouRateLimitError(safeCode);
        }
        throw new MiaoshouApiError(safeCode);
      }

      return { payload, startedAt, httpStatus: response.status };
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', onExternalAbort);
      this.lastRequestCompletedAt = this.monotonicNow();
    }
  }

  private async waitForRequestSlot(signal?: AbortSignal): Promise<void> {
    if (this.lastRequestCompletedAt === null) return;
    const now = this.monotonicNow();
    const elapsed = Math.max(0, now - this.lastRequestCompletedAt);
    const waitMs = Math.max(0, this.requestIntervalMs - elapsed);
    if (waitMs > 0) await this.wait(waitMs, signal);
  }

  private async readJson(response: Response, signal: AbortSignal): Promise<unknown> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      return await Promise.race([response.json(), aborted]);
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
  }

  private throwRequestFailure(
    operation: MiaoshouOperation,
    startedAt: number,
    timeoutTriggered: boolean,
    externalSignal?: AbortSignal,
  ): never {
    if (timeoutTriggered) {
      this.log(operation, 'timeout', startedAt);
      throw new MiaoshouTimeoutError();
    }
    if (externalSignal?.aborted) {
      this.log(operation, 'cancelled', startedAt);
      throw new MiaoshouCancelledError();
    }
    this.log(operation, 'network_error', startedAt);
    throw new MiaoshouUnavailableError();
  }

  private readErrorCode(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null;
    const code = Reflect.get(payload, 'code');
    if (typeof code !== 'string') return null;
    return code === 'success' ? null : code;
  }

  private toSafeErrorCode(code: string | null, httpStatus: number): string {
    if (
      code
      && (
        AUTHENTICATION_CODES.has(code)
        || RATE_LIMIT_CODES.has(code)
        || OPERATIONAL_ERROR_CODES.has(code)
      )
    ) {
      return code;
    }
    if (code === null && httpStatus >= 400 && httpStatus <= 599) {
      return `http_${httpStatus}`;
    }
    return 'unknown_api_error';
  }

  private log(
    operation: MiaoshouOperation,
    outcome: MiaoshouLogEvent['outcome'],
    startedAt: number,
    code?: string,
    httpStatus?: number,
  ): void {
    this.logger({
      operation,
      outcome,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      ...(code ? { code } : {}),
      ...(httpStatus === undefined ? {} : { httpStatus }),
    });
  }

  private reportInvalidResponse(
    operation: MiaoshouOperation,
    payload: unknown,
    error: unknown,
  ): void {
    const issues = error instanceof ZodError
      ? error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        }))
      : [{
          path: '',
          message: error instanceof Error ? error.message : 'Unknown validation error',
        }];
    this.onInvalidResponse({
      operation,
      issues,
      shape: describeValueShape(payload),
    });
  }
}

function waitWithAbort(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function describeValueShape(value: unknown, depth = 0): unknown {
  if (value === null) return 'null';
  if (depth >= 8) return Array.isArray(value) ? 'array' : typeof value;
  if (Array.isArray(value)) {
    return {
      type: 'array',
      length: value.length,
      item: value.length > 0 ? describeValueShape(value[0], depth + 1) : null,
    };
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, describeValueShape(child, depth + 1)]),
    );
  }
  return typeof value;
}
