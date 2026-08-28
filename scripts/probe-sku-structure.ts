import { homedir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { HttpMiaoshouGateway } from '../src/main/gateways/miaoshou/http-miaoshou-gateway';
import type { MiaoshouCredential } from '../src/domain/config';
import { miaoshouCredentialSchema } from '../src/shared/config-schemas';

function databasePath(): string {
  return (
    process.env.MIAOSHOU_DATABASE_PATH?.trim()
    || path.join(
      homedir(),
      'Library',
      'Application Support',
      'Mercado Agent',
      'mercado-agent.sqlite3',
    )
  );
}

function credentials(): MiaoshouCredential {
  const database = new DatabaseSync(databasePath(), { readOnly: true });
  try {
    const row = database
      .prepare('SELECT value_json FROM app_credentials WHERE key = ?')
      .get('miaoshou') as { value_json: string } | undefined;
    if (!row) throw new Error('Miaoshou credentials not found');
    return miaoshouCredentialSchema.parse(JSON.parse(row.value_json));
  } finally {
    database.close();
  }
}

// Print the full skuMap structure for one or more product ids so we can verify
// which per-SKU fields (stock, originPrice, dimensions, weight) actually exist.
async function main(): Promise<void> {
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    throw new Error('usage: probe-sku-structure.ts <detailId> [more ids...]');
  }
  const gateway = new HttpMiaoshouGateway(credentials());
  for (const id of ids) {
    const detail = await gateway.getCollectBoxDetail(id);
    const info = detail.siteCollectItemInfo;
    console.log(`\n===== ${id} | title: ${info.title} =====`);
    console.log(`firstSkuKey: ${info.firstSkuKey}`);
    console.log(`sites: ${JSON.stringify(info.sites)}`);
    const skuMap = info.skuMap ?? {};
    console.log(`skuMap keys (${Object.keys(skuMap).length}): ${JSON.stringify(Object.keys(skuMap))}`);
    for (const [key, sku] of Object.entries(skuMap)) {
      console.log(`--- SKU ${key} ---`);
      console.log(JSON.stringify(
        {
          stock: sku?.stock,
          originPrice: sku?.originPrice,
          length: sku?.length,
          width: sku?.width,
          height: sku?.height,
          lengthWidthHeightUnit: sku?.lengthWidthHeightUnit,
          weight: sku?.weight,
          weightUnit: sku?.weightUnit,
          itemNum: sku?.itemNum,
          imgUrls: sku?.imgUrls,
          siteAndPriceMap: sku?.siteAndPriceMap,
        },
        null,
        2,
      ));
    }
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
