import { createServer, type Server, type ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

const projectRoot = process.cwd();
const detailId = '90002';

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

function writeJson(response: ServerResponse, payload: unknown) {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(payload));
}

import type { IncomingMessage } from 'node:http';

type HttpHandler = (request: IncomingMessage, response: ServerResponse) => void;

function startServer(handler: HttpHandler): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve, reject) => {
    const server = createServer(handler);
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Server did not bind a TCP port'));
        return;
      }
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

async function startGateway(): Promise<{ server: Server; baseUrl: string }> {
  return startServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        detailId?: number;
        filter?: { status?: string };
      };
      if (request.url?.endsWith('search_collect_box_detailList')) {
        const items = body.filter?.status === 'notPublished'
          ? [{
              collectBoxDetailId: detailId,
              itemNum: 'E2E-001',
              title: 'E2E Branded Watch',
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
      writeJson(response, {
        result: 'success',
        code: 'success',
        data: {
          saleAttributeRules: [],
          productAttributeRules: [],
          skuAttributeRules: [],
          siteCollectItemInfo: {
            collectBoxDetailId: detailId,
            title: 'E2E Branded Watch',
            itemNum: 'E2E-001',
            attributes: [
              { name: 'Brand', values: [{ name: 'APPLE' }] },
            ],
            sourceImgUrls: ['https://images.example.test/e2e.jpg'],
          },
        },
      });
    });
  });
}

async function startModelProvider(): Promise<{ server: Server; baseUrl: string }> {
  return startServer((request, response) => {
    if (request.url?.endsWith('/models')) {
      writeJson(response, { data: [{ id: 'vision' }] });
      return;
    }
    if (request.url?.endsWith('/chat/completions')) {
      writeJson(response, {
        choices: [
          {
            message: {
              content: JSON.stringify({
                level: 'high',
                kind: 'brand_owner',
                summary: '受保护品牌本体商品，未授权销售高风险。',
                evidence: [
                  { source: 'image', quote: 'Apple Logo 清晰可见', explanation: '主图包含受保护标识' },
                ],
              }),
            },
          },
        ],
      });
      return;
    }
    response.writeHead(404);
    response.end();
  });
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

test('analyzes a synced product for infringement and keeps history', async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'mercado-agent-risk-e2e-'));
  const gateway = await startGateway();
  const modelProvider = await startModelProvider();
  let application: ElectronApplication | undefined;

  try {
    let launched = await launch(userDataDir);
    application = launched.application;
    let page = launched.page;

    // Configure Miaoshou credentials.
    await page.getByRole('button', { name: '模型与凭证' }).click();
    await page.getByLabel('妙手 App Key').fill('e2e-app-key');
    await page.getByRole('textbox', { name: /妙手 App Secret/ }).fill('e2e-app-secret');
    await page.getByLabel('妙手 Base URL').fill(gateway.baseUrl);
    await page.getByRole('button', { name: '保存妙手凭证' }).click();
    await expect(page.getByText('妙手凭证已保存到本机。')).toBeVisible();

    // Configure an active text model provider (first provider panel is text).
    const textPanel = page.locator('.provider-panel').first();
    await textPanel.getByLabel('提供商').selectOption('openai');
    await textPanel.getByLabel('配置名称').fill('E2E Vision');
    await textPanel.getByLabel('Base URL').fill(modelProvider.baseUrl);
    await textPanel.getByRole('textbox', { name: '文本模型 API Key' }).fill('e2e-api-key');
    await textPanel.getByLabel('模型名称').fill('vision-model');
    await textPanel.getByRole('button', { name: '保存模型配置' }).click();
    await expect(textPanel.getByText('E2E Vision')).toBeVisible();
    await textPanel.getByRole('button', { name: '启用 E2E Vision' }).click();

    // Sync the product.
    await page.getByRole('button', { name: '工作台' }).click();
    await page.getByRole('button', { name: '同步未发布商品' }).click();
    await expect(page.getByRole('row', { name: /E2E Branded Watch/ })).toBeVisible();

    // Run infringement analysis.
    await page.getByRole('button', { name: '侵权检测' }).click();
    await expect(page.getByRole('row', { name: /E2E Branded Watch/ })).toBeVisible();
    await page.getByRole('button', { name: '分析侵权风险' }).click();

    await expect(page.locator('.current-decision')).toBeVisible();
    await expect(page.locator('.current-decision p').getByText(/受限品牌 APPLE 本体商品默认高风险/)).toBeVisible();
    await expect(page.locator('.current-decision').getByText('高风险').first()).toBeVisible();
    await expect(page.locator('.current-decision').getByText('V1')).toBeVisible();
    await expect(page.getByRole('button', { name: '继续编辑' })).toBeVisible();

    // Restart and confirm the run is still present.
    await application.close();
    application = undefined;

    launched = await launch(userDataDir);
    application = launched.application;
    page = launched.page;
    await page.getByRole('button', { name: '侵权检测' }).click();
    await expect(page.getByRole('row', { name: /E2E Branded Watch/ })).toBeVisible();
    await expect(page.locator('.current-decision').getByText('高风险').first()).toBeVisible();
  } finally {
    await application?.close();
    await new Promise<void>((resolve, reject) => gateway.server.close((error) => error ? reject(error) : resolve()));
    await new Promise<void>((resolve, reject) => modelProvider.server.close((error) => error ? reject(error) : resolve()));
    await rm(userDataDir, { recursive: true, force: true });
  }
});
