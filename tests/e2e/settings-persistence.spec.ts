import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

const projectRoot = process.cwd();

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
  const page = await application.firstWindow();
  await page.getByRole('button', { name: '模型与凭证' }).click();
  await expect(page.getByRole('heading', { name: '模型配置' })).toBeVisible();
  return { application, page };
}

function providerForm(page: Page, heading: string) {
  return page.locator('form.settings-form').filter({
    has: page.getByRole('heading', { name: heading }),
  });
}

async function saveProvider(
  page: Page,
  kind: 'text' | 'image',
  values: {
    providerLabel: string;
    name: string;
    apiKey: string;
    baseUrl: string;
    model: string;
  },
) {
  const heading = kind === 'text' ? '新增文本/多模态模型' : '新增生图模型';
  const form = providerForm(page, heading);
  await form.getByLabel('提供商').selectOption({ label: values.providerLabel });
  await form.getByLabel('配置名称').fill(values.name);
  await form.getByRole('textbox', {
    name: new RegExp(kind === 'text' ? '文本模型 API Key' : '生图模型 API Key'),
  }).fill(values.apiKey);
  await form.getByLabel('Base URL').fill(values.baseUrl);
  await form.getByLabel('模型名称').fill(values.model);
  await form.getByRole('button', { name: '保存模型配置' }).click();
  await expect(page.getByText(values.name, { exact: true })).toBeVisible();
}

test('empty configuration survives creation, activation and a full app restart', async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'mercado-agent-e2e-'));
  let application: ElectronApplication | undefined;

  try {
    let launched = await launch(userDataDir);
    application = launched.application;
    let page = launched.page;

    const textForm = providerForm(page, '新增文本/多模态模型');
    const imageForm = providerForm(page, '新增生图模型');
    await expect(textForm.getByRole('textbox', { name: /文本模型 API Key/ })).toHaveValue('');
    await expect(imageForm.getByRole('textbox', { name: /生图模型 API Key/ })).toHaveValue('');
    await expect(page.getByRole('checkbox', { name: '启用 HTTP 代理' })).not.toBeChecked();
    await expect(page.getByLabel('代理主机')).toHaveValue('');
    await expect(page.getByLabel('代理端口')).toHaveValue('');
    await expect(page.getByLabel('妙手 App Key')).toHaveValue('');
    await expect(page.getByLabel('七牛 Access Key')).toHaveValue('');

    await saveProvider(page, 'text', {
      providerLabel: 'DeepSeek',
      name: '文本配置 A',
      apiKey: 'text-secret-a',
      baseUrl: 'https://text-a.example.test/v1',
      model: 'text-model-a',
    });
    await saveProvider(page, 'text', {
      providerLabel: 'OpenAI',
      name: '文本配置 B',
      apiKey: 'text-secret-b',
      baseUrl: 'https://text-b.example.test/v1',
      model: 'text-model-b',
    });
    await saveProvider(page, 'image', {
      providerLabel: '豆包',
      name: '生图配置 A',
      apiKey: 'image-secret-a',
      baseUrl: 'https://image-a.example.test/v1',
      model: 'image-model-a',
    });

    await page.getByRole('button', { name: '启用 文本配置 B' }).click();
    await expect(page.locator('article.config-item').filter({ hasText: '文本配置 B' }).getByText('当前启用')).toBeVisible();
    await page.getByRole('button', { name: '启用 生图配置 A' }).click();
    await expect(page.locator('article.config-item').filter({ hasText: '生图配置 A' }).getByText('当前启用')).toBeVisible();

    await page.getByLabel('妙手 App Key').fill('miaoshou-key');
    await page.getByRole('textbox', { name: /妙手 App Secret/ }).fill('miaoshou-secret');
    await page.getByLabel('妙手 Base URL').fill('https://miaoshou.example.test');
    await page.getByRole('button', { name: '保存妙手凭证' }).click();
    await expect(page.getByText('妙手凭证已保存到本机。')).toBeVisible();

    await page.getByLabel('七牛 Access Key').fill('qiniu-key');
    await page.getByRole('textbox', { name: /七牛 Secret Key/ }).fill('qiniu-secret');
    await page.getByRole('textbox', { name: 'Bucket', exact: true }).fill('mercado-images');
    await page.getByRole('combobox', { name: /区域/ }).selectOption('z0');
    await page.getByLabel('公开域名').fill('https://images.example.test');
    await page.getByRole('button', { name: '保存七牛云凭证' }).click();
    await expect(page.getByText('七牛云凭证已保存到本机。')).toBeVisible();

    await application.close();
    application = undefined;

    launched = await launch(userDataDir);
    application = launched.application;
    page = launched.page;

    await expect(page.getByText('文本配置 A', { exact: true })).toBeVisible();
    await expect(page.getByText('文本配置 B', { exact: true })).toBeVisible();
    await expect(page.getByText('生图配置 A', { exact: true })).toBeVisible();
    await expect(page.locator('article.config-item').filter({ hasText: '文本配置 B' }).getByText('当前启用')).toBeVisible();
    await expect(page.locator('article.config-item').filter({ hasText: '生图配置 A' }).getByText('当前启用')).toBeVisible();
    await expect(page.getByLabel('妙手 App Key')).toHaveValue('miaoshou-key');
    await expect(page.getByRole('textbox', { name: /妙手 App Secret/ })).toHaveValue('miaoshou-secret');
    await expect(page.getByLabel('七牛 Access Key')).toHaveValue('qiniu-key');
    await expect(page.getByRole('textbox', { name: /七牛 Secret Key/ })).toHaveValue('qiniu-secret');
    await expect(page.getByRole('textbox', { name: 'Bucket', exact: true })).toHaveValue('mercado-images');
    await expect(page.getByRole('combobox', { name: /区域/ })).toHaveValue('z0');
    await expect(page.getByLabel('公开域名')).toHaveValue('https://images.example.test');
  } finally {
    await application?.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});
