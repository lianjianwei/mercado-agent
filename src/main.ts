import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

import { openAppDatabase, resolveDatabasePath } from './main/db/database';
import { registerHandlers } from './main/ipc/register-handlers';
import { IPC_CHANNELS } from './shared/ipc-contract';
import { readLatestDraft } from './main/ipc/edit-handlers';
import { productDetailFromSources } from './main/ipc/product-detail-mapper';
import type { CollectBoxDetailDto } from './shared/miaoshou-schemas';
import { createDefaultProviderRegistrations } from './main/providers/default-provider-registrations';
import { ProviderRegistry } from './main/providers/provider-registry';
import { SqliteCredentialRepository } from './main/repositories/credential-repository';
import { SqliteAppSettingsRepository } from './main/repositories/app-settings-repository';
import { SqliteProviderConfigRepository } from './main/repositories/provider-config-repository';
import { SqliteFxRateRepository } from './main/repositories/fx-rate-repository';
import { SqliteProductRepository } from './main/repositories/product-repository';
import { SqliteSnapshotRepository } from './main/repositories/snapshot-repository';
import { createDirectModelSession, createElectronModelSession } from './main/network/electron-model-session';
import { ModelNetworkClient } from './main/network/model-network-client';
import { createMainWindowOptions } from './main/window-options';
import { ConnectionTestService } from './main/services/connection-test-service';
import { ModelProxyService } from './main/services/model-proxy-service';
import { HttpMiaoshouGateway } from './main/gateways/miaoshou/http-miaoshou-gateway';
import { ProductSyncService } from './main/services/product-sync-service';
import { SqliteInfringementRepository } from './main/repositories/infringement-repository';
import { InfringementService } from './main/services/infringement-service';
import { InfringementEngine } from './main/risk/infringement-engine';
import { EditGenerationService } from './main/services/edit-generation-service';
import { ImageGenerationService } from './main/services/image-generation-service';
import { QiniuUploadService } from './main/services/qiniu-upload-service';
import { compressPng } from './main/services/image-compressor';
import type { AiImagesResult, GeneratedImage } from './domain/images';
import { NetProfitCalculator } from './main/services/net-profit-calculator';
import { FxRateService } from './main/services/fx-rate-service';
import { ActiveProviderMissingError } from './main/providers/provider-registry';
import type { TextModelProvider, ImageModelProvider } from './domain/providers';

let appDatabase: DatabaseSync | null = null;

function createMainWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow(
    createMainWindowOptions(path.join(__dirname, 'preload.js')),
  );

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Debugging convenience: open DevTools automatically in dev mode, and let
  // F12 / Cmd+Option+I toggle them at any time (dev or packaged).
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.webContents.openDevTools();
  }
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    const toggleDevTools =
      input.key === 'F12'
      || (input.key === 'i'
        && input.type === 'keyDown'
        && input.control
        && input.alt);
    if (toggleDevTools) {
      mainWindow.webContents.toggleDevTools();
    }
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(
      path.join(
        __dirname,
        `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
      ),
    );
  }

  return mainWindow;
}

app.whenReady().then(async () => {
  const databasePath = resolveDatabasePath(app.getPath('userData'));
  appDatabase = openAppDatabase(databasePath);
  const appSettings = new SqliteAppSettingsRepository(appDatabase);
  const fxRateRepository = new SqliteFxRateRepository(appDatabase);
  const fxRateService = new FxRateService(fxRateRepository);
  void fxRateService.refresh().catch(() => { /* 离线时用缓存/默认 */ });
  const netProfitCalculator = new NetProfitCalculator(appSettings, fxRateRepository);
  const modelSession = createElectronModelSession();
  const modelProxy = new ModelProxyService(appSettings, modelSession);
  await modelProxy.initialize();
  const modelNetwork = new ModelNetworkClient(modelSession, () => modelProxy.getRoute());
  // 直连网络:豆包 / DeepSeek 不走代理(代理会显著拖慢它们),openai / codex 仍走代理。
  const directNetwork = new ModelNetworkClient(createDirectModelSession(), () => 'direct' as const);
  const providerConfigs = new SqliteProviderConfigRepository(appDatabase);
  const credentials = new SqliteCredentialRepository(appDatabase);
  const products = new SqliteProductRepository(appDatabase);
  const snapshots = new SqliteSnapshotRepository(appDatabase);
  const createProductSyncService = () => {
    const miaoshouCredentials = credentials.getMiaoshou();
    if (!miaoshouCredentials) {
      throw new Error('Miaoshou credentials are not configured');
    }
    return new ProductSyncService(
      new HttpMiaoshouGateway(miaoshouCredentials),
      products,
      snapshots,
    );
  };
  const productSync = {
    syncDefault: (
      signal?: AbortSignal,
      onProgress?: (line: string) => void,
    ) => createProductSyncService().syncDefault(signal, onProgress),
    syncOne: (productId: string, signal?: AbortSignal) =>
      createProductSyncService().syncOne(productId, signal),
  };
  // 保存到妙手:懒取凭证,仅用户点「保存到妙手平台」时构建网关并发请求。带 logger,
  // 让主进程终端输出保存结果/错误(之前静默,出错时看不到信息)。
  const saveGateway = {
    saveCollectBoxItemInfo: async (detailId: string, info: Record<string, unknown>) => {
      const miaoshouCredentials = credentials.getMiaoshou();
      if (!miaoshouCredentials) {
        throw new Error('未配置妙手凭证，无法保存到妙手。');
      }
      return new HttpMiaoshouGateway(miaoshouCredentials, {
        logger: (event) => console.log('[妙手保存]', JSON.stringify(event)),
      }).saveCollectBoxItemInfo(detailId, info);
    },
  };
  const getAppInfo = () => ({
    version: app.getVersion(),
    platform: process.platform,
  });
  const providerRegistry = new ProviderRegistry(
    providerConfigs,
    createDefaultProviderRegistrations(modelNetwork, {
      direct: directNetwork,
      codex: {
        proxy: () => modelProxy.get(),
        scratchDir: app.getPath('temp'),
      },
    }),
  );
  const infringementRepository = new SqliteInfringementRepository(appDatabase);
  const createInfringementEngine = () => {
    const provider = providerRegistry.createActive(
      'text',
    ) as TextModelProvider;
    if (typeof provider.generate !== 'function') {
      throw new ActiveProviderMissingError('text');
    }
    return new InfringementEngine(provider);
  };
  const infringementService = new InfringementService(
    infringementRepository,
    createInfringementEngine,
  );
  // 主进程直接把进度行广播到所有窗口(sync/infringement/edit 共用)。
  const sendProgress = (channel: string, line: string) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(channel, { line });
    }
  };
  const editService = new EditGenerationService(
    products,
    snapshots,
    () => {
      const provider = providerRegistry.createActive(
        'text',
      ) as TextModelProvider;
      if (typeof provider.generate !== 'function') {
        throw new ActiveProviderMissingError('text');
      }
      return provider;
    },
    { netProfit: netProfitCalculator, onProgress: (line) => sendProgress(IPC_CHANNELS.editLog, line) },
  );
  const qiniuUploadService = new QiniuUploadService();
  const imageService = new ImageGenerationService({
    onProgress: (line) => sendProgress(IPC_CHANNELS.editLog, line),
    // 与 product-handlers 的 productDetail 同款取数:product + 最新 miaoshou 快照。
    readDetail: (productId: string) => {
      const latest = [...snapshots.listForProduct(productId)].reverse()
        .find((s) => s.kind === 'miaoshou')?.payload as CollectBoxDetailDto | undefined;
      if (!latest) return null;
      return productDetailFromSources(products.getById(productId), latest);
    },
    readDraft: (productId) => readLatestDraft(snapshots, productId),
    readImages: (productId: string) => {
      const list = snapshots.listForProduct(productId).filter((s) => s.kind === 'aiImages');
      if (list.length === 0) return null;
      // 同一商品会有多份 aiImages(多次生成/上传),它们的 captured_at 常相同(沿用
      // 生成时间),导致按时间读回可能挑到「未上传、无公网 URL」的那份。这里按
      // 公网 URL 数量多者优先(即已上传那份),再按时间新者优先,保证读到带 URL 的图。
      const uploaded = (payload: AiImagesResult) =>
        [...payload.mainImages, ...payload.detailImages].filter((i) => i.publicUrl).length;
      const chosen = list
        .slice()
        .sort((a, b) => {
          const diff = uploaded(b.payload as AiImagesResult) - uploaded(a.payload as AiImagesResult);
          if (diff !== 0) return diff;
          return (b.capturedAt ?? '').localeCompare(a.capturedAt ?? '');
        })[0];
      return chosen ? (chosen.payload as AiImagesResult) : null;
    },
    imageProvider: () => providerRegistry.createActive('image') as ImageModelProvider,
    textProvider: () => {
      const p = providerRegistry.createActive('text') as TextModelProvider;
      if (typeof p.generate !== 'function') throw new ActiveProviderMissingError('text');
      return p;
    },
    appendImages: (productId, result) => snapshots.append({ id: `${productId}:aiImages:${randomUUID()}`, productId, kind: 'aiImages', capturedAt: result.createdAt, payload: result }),
    imagesDir: path.join(app.getPath('userData'), 'images'),
    // 生成后自动压缩 + 上传七牛,拿到公网 URL。
    publish: async (productId: string, images: GeneratedImage[]) => {
      const creds = credentials.getQiniu();
      if (!creds) throw new Error('未配置七牛云凭证,无法上传。');
      const out: GeneratedImage[] = [];
      for (const image of images) {
        // 已上传的跳过;只有已保存且非失败图才上传。
        if (image.publicUrl || !image.localPath || image.status === 'failed') {
          out.push(image);
          continue;
        }
        const buf = compressPng(readFileSync(image.localPath));
        const url = await qiniuUploadService.upload(creds, image.plannedPath, buf);
        out.push({ ...image, publicUrl: url });
      }
      return out;
    },
    // 把公网 URL 写回最新 AI 草稿的产品图片字段(妙手快照不改)。
    writeDraftImages: (productId: string, mainImages: GeneratedImage[], detailImages: GeneratedImage[]) => {
      const draft = readLatestDraft(snapshots, productId);
      if (!draft) return;
      const mainBySku = new Map<string, string[]>();
      for (const image of mainImages) {
        if (!image.publicUrl || !image.skuKey) continue;
        const list = mainBySku.get(image.skuKey) ?? [];
        list.push(image.publicUrl);
        mainBySku.set(image.skuKey, list);
      }
      const allUrls = [...mainImages, ...detailImages]
        .map((image) => image.publicUrl)
        .filter((url): url is string => Boolean(url));
      if (allUrls.length === 0) return;
      // 每 SKU 的图 = 该 SKU 主图 + 全部共用详情图(详情图所有 SKU 共用,同一 URL
      // 都写进每份 SKU 的 imageUrls,便于后续回写妙手时每个 SKU 都带这 4 张详情图)。
      const detailUrls = detailImages
        .map((image) => image.publicUrl)
        .filter((url): url is string => Boolean(url));
      const skus = draft.skus.map((sku) => {
        const mainUrls = mainBySku.get(sku.skuKey) ?? [];
        const urls = [...mainUrls, ...detailUrls];
        return { ...sku, imageUrl: urls[0] ?? null, imageUrls: urls };
      });
      snapshots.append({
        id: `${productId}:aiDraft:${randomUUID()}`,
        productId,
        kind: 'aiDraft',
        capturedAt: new Date().toISOString(),
        payload: { ...draft, mainImage: allUrls[0] ?? null, images: allUrls, skus, version: draft.version + 1 },
      });
    },
  });
  registerHandlers(
    {
      handle: (channel, listener) => {
        ipcMain.handle(channel, listener);
      },
    },
    {
      providerConfigs,
      credentials,
      products,
      productSync,
      snapshots,
      infringementRepository,
      infringementService,
      editService,
      imageService,
      netProfitCalculator,
      saveGateway,
      netProfitSettings: appSettings,
      fxRates: fxRateRepository,
      refreshRates: () => fxRateService.refresh(),
      modelProxy,
      getAppInfo,
      sendProgress,
      connectionTests: new ConnectionTestService(
        providerRegistry,
        undefined,
        () => modelProxy.getRoute(),
      ),
      getDiagnosticSnapshot: () => {
        const proxy = modelProxy.get();
        return {
          app: getAppInfo(),
          databasePath,
          modelNetwork: {
            route: modelProxy.getRoute(),
            proxyAddress: proxy.enabled ? `${proxy.host}:${proxy.port}` : null,
          },
          completeness: {
            textProvider: providerConfigs.list('text').some((item) => item.isActive),
            imageProvider: providerConfigs.list('image').some((item) => item.isActive),
            miaoshou: credentials.getMiaoshou() !== null,
            qiniu: credentials.getQiniu() !== null,
          },
        };
      },
    },
  );

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('before-quit', () => {
  if (appDatabase?.isOpen) {
    appDatabase.close();
  }
  appDatabase = null;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
