import type { MiaoshouCredential } from '../../../domain/config';
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

type MiaoshouFetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

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

type HttpMiaoshouGatewayOptions = {
  fetcher?: MiaoshouFetcher;
  now?: () => number;
  timeoutMs?: number;
  logger?: (event: MiaoshouLogEvent) => void;
};

type MiaoshouOperation = MiaoshouLogEvent['operation'];

export class HttpMiaoshouGateway implements MiaoshouGateway {
  private readonly baseUrl: string;
  private readonly fetcher: MiaoshouFetcher;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly logger: (event: MiaoshouLogEvent) => void;

  constructor(
    private readonly credentials: MiaoshouCredential,
    options: HttpMiaoshouGatewayOptions = {},
  ) {
    this.baseUrl = credentials.baseUrl.replace(/\/+$/, '');
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.logger = options.logger ?? (() => undefined);
  }

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
    } catch {
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
    } catch {
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
    }
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
    if (code && (AUTHENTICATION_CODES.has(code) || RATE_LIMIT_CODES.has(code))) {
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
}
