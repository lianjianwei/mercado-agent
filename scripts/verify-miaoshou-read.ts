import { homedir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import type { MiaoshouCredential } from '../src/domain/config';
import {
  formatMiaoshouInvalidResponseDiagnostics,
  HttpMiaoshouGateway,
  type MiaoshouInvalidResponseDiagnostic,
} from '../src/main/gateways/miaoshou/http-miaoshou-gateway';
import type { RemoteMiaoshouProductState } from '../src/domain/product';
import { miaoshouCredentialSchema } from '../src/shared/config-schemas';

const PAGE_SIZE = 20;
const states: RemoteMiaoshouProductState[] = [
  'notPublished',
  'timingPublish',
  'published',
];

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function credentialsFromEnvironment(): MiaoshouCredential {
  const environmentValues = [
    process.env.MIAOSHOU_APP_KEY,
    process.env.MIAOSHOU_APP_SECRET,
    process.env.MIAOSHOU_BASE_URL,
  ];
  if (environmentValues.every((value) => !value?.trim())) {
    return credentialsFromDatabase();
  }
  return {
    appKey: requiredEnvironment('MIAOSHOU_APP_KEY'),
    appSecret: requiredEnvironment('MIAOSHOU_APP_SECRET'),
    baseUrl: requiredEnvironment('MIAOSHOU_BASE_URL'),
  };
}

function credentialsFromDatabase(): MiaoshouCredential {
  const databasePath = process.env.MIAOSHOU_DATABASE_PATH?.trim()
    || defaultDatabasePath();
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const row = database
      .prepare('SELECT value_json FROM app_credentials WHERE key = ?')
      .get('miaoshou') as { value_json: string } | undefined;
    if (!row) throw new Error('Miaoshou credentials are not configured in the local database');
    return miaoshouCredentialSchema.parse(JSON.parse(row.value_json));
  } finally {
    database.close();
  }
}

function defaultDatabasePath(): string {
  if (process.platform === 'darwin') {
    return path.join(
      homedir(),
      'Library',
      'Application Support',
      'Mercado Agent',
      'mercado-agent.sqlite3',
    );
  }
  if (process.platform === 'win32') {
    return path.join(
      requiredEnvironment('APPDATA'),
      'Mercado Agent',
      'mercado-agent.sqlite3',
    );
  }
  return path.join(
    process.env.XDG_CONFIG_HOME?.trim() || path.join(homedir(), '.config'),
    'Mercado Agent',
    'mercado-agent.sqlite3',
  );
}

describe('real Miaoshou read-only contract', () => {
  it('validates list pagination and one collect-box detail without exposing payloads', async () => {
    expect(requiredEnvironment('RUN_MIAOSHOU_READ_ACCEPTANCE')).toBe('1');
    const diagnostics: MiaoshouInvalidResponseDiagnostic[] = [];
    const gateway = new HttpMiaoshouGateway(credentialsFromEnvironment(), {
      onInvalidResponse: (diagnostic) => diagnostics.push(diagnostic),
    });
    const report: Array<Record<string, unknown>> = [];
    let verifiedDetail = false;

    try {
      for (const state of states) {
        const first = await gateway.listCollectBox({
          pageNo: 1,
          pageSize: PAGE_SIZE,
          filter: { status: state },
        });
        let second = null;
        if (first.hasMore) {
          second = await gateway.listCollectBox({
            pageNo: 2,
            pageSize: PAGE_SIZE,
            filter: { status: state },
          });
        }
        const firstIds = new Set(first.items.map((item) => item.collectBoxDetailId));
        const repeatedIds = second
          ? second.items.filter((item) => firstIds.has(item.collectBoxDetailId)).length
          : 0;
        expect(repeatedIds, `${state} pages must not repeat product ids`).toBe(0);

        if (state === 'notPublished') {
          expect(
            first.items[0],
            'The account must contain at least one unpublished test product',
          ).toBeDefined();
          const detail = await gateway.getCollectBoxDetail(
            first.items[0]!.collectBoxDetailId,
          );
          expect(detail.siteCollectItemInfo.collectBoxDetailId).toBe(
            first.items[0]!.collectBoxDetailId,
          );
          report.push({
            state,
            firstPageItems: first.items.length,
            secondPageItems: second?.items.length ?? 0,
            total: first.total,
            repeatedIds,
            detailReadable: true,
            detailHasTitle: Boolean(detail.siteCollectItemInfo.title),
            detailHasImages: Boolean(
              detail.siteCollectItemInfo.sourceImgUrls?.length,
            ),
            detailHasAttributes: Boolean(
              detail.siteCollectItemInfo.attributes?.length,
            ),
          });
          verifiedDetail = true;
        } else {
          report.push({
            state,
            firstPageItems: first.items.length,
            secondPageItems: second?.items.length ?? 0,
            total: first.total,
            repeatedIds,
            detailReadable: false,
          });
        }
      }
    } catch (error) {
      if (diagnostics.length > 0) {
        console.info(
          `Miaoshou response shape diagnostics:\n${formatMiaoshouInvalidResponseDiagnostics(diagnostics)}`,
        );
      }
      throw error;
    }

    expect(verifiedDetail).toBe(true);
    console.info('Miaoshou read-only verification summary:', report);
  });
});
