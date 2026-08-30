import type {
  CredentialRepository,
  ProviderConfigRepository,
} from '../../domain/config';
import type { ProductRepository, ProductSnapshotRepository } from '../../domain/product';
import type { InfringementRepository } from '../../domain/infringement';
import type {
  FxRateRepository,
  FxRates,
  NetProfitSettingsRepository,
} from '../../domain/net-profit';
import {
  IPC_CHANNELS,
  type AppInfo,
  type IpcRegistrar,
} from '../../shared/ipc-contract';
import { registerConfigHandlers } from './config-handlers';
import { registerDiagnosticHandlers } from './diagnostic-handlers';
import { registerInfringementHandlers } from './infringement-handlers';
import { registerEditHandlers } from './edit-handlers';
import { registerImageHandlers } from './image-handlers';
import { registerClipboardHandlers } from './clipboard-handlers';
import { registerNetProfitHandlers } from './net-profit-handlers';
import { registerProductHandlers } from './product-handlers';
import { registerProxyConfigHandlers } from './proxy-config-handlers';
import type { ConnectionTestService } from '../services/connection-test-service';
import type { ModelProxyService } from '../services/model-proxy-service';
import type { ProductSyncService } from '../services/product-sync-service';
import type { InfringementService } from '../services/infringement-service';
import type { EditGenerationService } from '../services/edit-generation-service';
import type { ImageGenerationService } from '../services/image-generation-service';
import type { NetProfitCalculator } from '../services/net-profit-calculator';
import type { DiagnosticSnapshot } from '../../shared/ipc-contract';

type HandlerDependencies = {
  providerConfigs: ProviderConfigRepository;
  credentials: CredentialRepository;
  getAppInfo(): AppInfo;
  getDiagnosticSnapshot(): DiagnosticSnapshot;
  connectionTests: ConnectionTestService;
  modelProxy: ModelProxyService;
  products: ProductRepository;
  productSync: Pick<ProductSyncService, 'syncDefault' | 'syncOne'>;
  snapshots: ProductSnapshotRepository;
  infringementRepository: InfringementRepository;
  infringementService: InfringementService;
  editService: EditGenerationService;
  imageService: ImageGenerationService;
  netProfitCalculator: Pick<NetProfitCalculator, 'computeForDraft'>;
  netProfitSettings: NetProfitSettingsRepository;
  fxRates: FxRateRepository;
  refreshRates: () => Promise<FxRates>;
  sendProgress: (channel: string, line: string) => void;
};

export function registerHandlers(
  registrar: IpcRegistrar,
  dependencies: HandlerDependencies,
): void {
  registerConfigHandlers(registrar, dependencies);
  registerDiagnosticHandlers(registrar, {
    getSnapshot: dependencies.getDiagnosticSnapshot,
    connectionTests: dependencies.connectionTests,
  });
  registerProxyConfigHandlers(registrar, dependencies.modelProxy);
  registerProductHandlers(registrar, {
    products: dependencies.products,
    snapshots: dependencies.snapshots,
    sync: dependencies.productSync,
    sendProgress: dependencies.sendProgress,
  });
  registerInfringementHandlers(registrar, {
    products: dependencies.products,
    snapshots: dependencies.snapshots,
    repository: dependencies.infringementRepository,
    service: dependencies.infringementService,
    sendProgress: dependencies.sendProgress,
  });
  registerEditHandlers(registrar, {
    snapshots: dependencies.snapshots,
    service: dependencies.editService,
    netProfit: dependencies.netProfitCalculator,
  });
  registerImageHandlers(registrar, {
    service: dependencies.imageService,
  });
  registerNetProfitHandlers(registrar, {
    settings: dependencies.netProfitSettings,
    fxRates: dependencies.fxRates,
    refreshRates: dependencies.refreshRates,
  });
  registerClipboardHandlers(registrar);
  registrar.handle(IPC_CHANNELS.appGetInfo, async () => ({
    ok: true,
    data: dependencies.getAppInfo(),
  }));
}
