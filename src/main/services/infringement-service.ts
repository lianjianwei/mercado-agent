import { randomUUID } from 'node:crypto';

import type { InfringementRepository, InfringementRun } from '../../domain/infringement';
import type { InfringementDecision } from '../../shared/infringement-schema';
import { riskFingerprint, type RiskRelevantProduct } from '../risk/fingerprint';

export interface InfringementAnalyzer {
  analyze(
    product: RiskRelevantProduct,
    signal: AbortSignal,
  ): Promise<InfringementDecision>;
}

export type InfringementBatchItem = {
  productId: string;
  product: RiskRelevantProduct;
};

export type InfringementProgress = (line: string) => void;

const BATCH_CONCURRENCY = 3;

export type InfringementBatchSummary = {
  discovered: number;
  succeeded: number;
  failed: number;
  failures: Array<{ productId: string; message: string }>;
};

export class InfringementService {
  private readonly now: () => string;

  constructor(
    private readonly repository: InfringementRepository,
    private readonly analyzerFactory: () => InfringementAnalyzer,
    options: { now?: () => string } = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async analyzeProduct(
    productId: string,
    product: RiskRelevantProduct,
    signal?: AbortSignal,
  ): Promise<InfringementRun> {
    const current = this.repository.currentForProduct(productId);
    const fingerprint = riskFingerprint(product);
    if (current && current.fingerprint === fingerprint) {
      // 内容未变化：沿用现有结果，不产生新 run。
      return current;
    }
    const decision = await this.analyzerFactory().analyze(
      product,
      signal ?? new AbortController().signal,
    );
    return this.appendRun(productId, decision);
  }

  async analyzeBatch(
    items: InfringementBatchItem[],
    signal?: AbortSignal,
    onProgress?: InfringementProgress,
  ): Promise<InfringementBatchSummary> {
    const summary: InfringementBatchSummary = {
      discovered: items.length,
      succeeded: 0,
      failed: 0,
      failures: [],
    };
    // A bounded worker pool keeps concurrent model calls from tripping provider
    // rate limits while still finishing the batch much faster than serially.
    const queue = [...items];
    const workers = Array.from(
      { length: Math.min(BATCH_CONCURRENCY, queue.length) },
      () => this.runWorker(queue, summary, signal, onProgress),
    );
    await Promise.all(workers);
    return summary;
  }

  private async runWorker(
    queue: InfringementBatchItem[],
    summary: InfringementBatchSummary,
    signal?: AbortSignal,
    onProgress?: InfringementProgress,
  ): Promise<void> {
    while (true) {
      const item = queue.shift();
      if (!item) return;
      try {
        await this.analyzeProduct(item.productId, item.product, signal);
        summary.succeeded += 1;
        onProgress?.(`商品 ${item.productId} 侵权检测成功。`);
      } catch (error) {
        summary.failed += 1;
        summary.failures.push({
          productId: item.productId,
          message: error instanceof Error ? error.message : '检测失败',
        });
        onProgress?.(
          `商品 ${item.productId} 侵权检测失败：${
            error instanceof Error ? error.message : '检测失败'
          }。`,
        );
      }
    }
  }

  private appendRun(
    productId: string,
    decision: InfringementDecision,
  ): InfringementRun {
    return this.repository.append({
      id: randomUUID(),
      productId,
      fingerprint: decision.fingerprint,
      level: decision.level,
      kind: decision.kind,
      decision,
      createdAt: this.now(),
    });
  }
}
