import { createServer, type Server, type ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

const projectRoot = process.cwd();
const detailId = '90001';

function packagedExecutable(): string {
  if (process.platform === 'darwin') {
    return path.join(
      projectRoot,
      'out',
      `Mercado Agent-darwin-${process.arch}`,
      'Mercado Agent.app',
      'Contents',
      'MacOS',
      'Mercado Agent',
    );
  }
  if (process.platform === 'win32') {
    return path.join(
      projectRoot,
      'out',
      `Mercado Agent-win32-${process.arch}`,
      'Mercado Agent.exe',
    );
  }
  return path.join(
    projectRoot,
    'out',
    `Mercado Agent-linux-${process.arch}`,
    'mercado-agent',
  );
}

async function launch(userDataDir: string): Promise<{
  application: ElectronApplication;
  page: Page;
}> {
  const application = await electron.launch({
    executablePath: packagedExecutable(),
    args: [`--user-data-dir=${userDataDir}`],
  });
  return { application, page: await application.firstWindow() };
}

function writeJson(response: ServerResponse, payload: unknown) {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(payload));
}

async function startGateway(): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      expect(request.headers['x-app-key']).toBe('e2e-app-key');
      expect(request.headers['x-sign']).toBeTruthy();
      expect(request.headers['x-timestamp']).toMatch(/^\d+$/);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        detailId?: number;
        filter?: { status?: string };
      };

      if (request.url?.endsWith('search_collect_box_detailList')) {
        const items = body.filter?.status === 'notPublished'
          ? [{
              collectBoxDetailId: detailId,
              itemNum: 'E2E-001',
              title: 'E2E Kitchen Brush',
              thumbnail: 'https://images.example.test/e2e.jpg',
              collectBoxDetailShop: { sites: ['MLB'] },
            }]
          : [];
        writeJson(response, {
          result: 'success',
          code: 'success',
          data: { detailList: items, total: items.length },
        });
        return;
      }

      expect(String(body.detailId)).toBe(detailId);
      writeJson(response, {
        result: 'success',
        code: 'success',
        data: {
          saleAttributeRules: [],
          productAttributeRules: [],
          skuAttributeRules: [],
          siteCollectItemInfo: {
            collectBoxDetailId: detailId,
            title: 'E2E Kitchen Brush',
            itemNum: 'E2E-001',
            sourceImgUrls: ['https://images.example.test/e2e.jpg'],
          },
        },
      });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Gateway did not bind a TCP port');
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('synchronizes the workbench and retains history when a product disappears', async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'mercado-agent-workbench-e2e-'));
  const gateway = await startGateway();
  let application: ElectronApplication | undefined;

  try {
    let launched = await launch(userDataDir);
    application = launched.application;
    let page = launched.page;

    await page.getByRole('button', { name: '模型与凭证' }).click();
    await page.getByLabel('妙手 App Key').fill('e2e-app-key');
    await page.getByRole('textbox', { name: /妙手 App Secret/ }).fill('e2e-app-secret');
    await page.getByLabel('妙手 Base URL').fill(gateway.baseUrl);
    await page.getByRole('button', { name: '保存妙手凭证' }).click();
    await expect(page.getByText('妙手凭证已保存到本机。')).toBeVisible();

    await page.getByRole('button', { name: '工作台' }).click();
    await page.getByRole('button', { name: '同步未发布商品' }).click();
    const productRow = page.getByRole('row', { name: /E2E Kitchen Brush/ });
    await expect(productRow).toBeVisible();
    await productRow.click();
    await expect(page.getByRole('heading', { name: '只读详情概要' })).toBeVisible();

    // Per-row sync refreshes the product in place (it still exists remotely).
    const rowSyncButton = productRow.getByRole('button', { name: '同步' });
    await rowSyncButton.click();
    await expect(page.getByText(/同步完成：E2E Kitchen Brush/)).toBeVisible();

    const summary = await page.evaluate(async (id) => {
      return window.mercado.products.reconcileTracked([id]);
    }, detailId);
    expect(summary).toMatchObject({ missing: 1, failed: 0 });
    await page.getByRole('button', { name: /远端缺失/ }).click();
    await expect(page.getByRole('row', { name: /E2E Kitchen Brush/ })).toBeVisible();

    await application.close();
    application = undefined;

    const database = new DatabaseSync(path.join(userDataDir, 'mercado-agent.sqlite3'));
    try {
      expect(database.prepare('SELECT state FROM products WHERE id = ?').get(detailId)).toEqual({
        state: 'missing',
      });
      expect(
        database.prepare('SELECT COUNT(*) AS count FROM product_snapshots WHERE product_id = ?').get(detailId),
      ).toEqual({ count: 2 });
    } finally {
      database.close();
    }

    launched = await launch(userDataDir);
    application = launched.application;
    page = launched.page;
    await page.getByRole('button', { name: /远端缺失/ }).click();
    await expect(page.getByRole('row', { name: /E2E Kitchen Brush/ })).toBeVisible();
  } finally {
    await application?.close();
    await new Promise<void>((resolve, reject) => gateway.server.close((error) => error ? reject(error) : resolve()));
    await rm(userDataDir, { recursive: true, force: true });
  }
});
