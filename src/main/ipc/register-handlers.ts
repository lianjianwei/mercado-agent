import type {
  CredentialRepository,
  ProviderConfigRepository,
} from '../../domain/config';
import type { ProductRepository } from '../../domain/product';
import {
  IPC_CHANNELS,
  type AppInfo,
  type IpcRegistrar,
} from '../../shared/ipc-contract';
import { registerConfigHandlers } from './config-handlers';
import { registerDiagnosticHandlers } from './diagnostic-handlers';
import { registerProductHandlers } from './product-handlers';
import { registerProxyConfigHandlers } from './proxy-config-handlers';
import type { ConnectionTestService } from '../services/connection-test-service';
import type { ModelProxyService } from '../services/model-proxy-service';
import type { ProductSyncService } from '../services/product-sync-service';
import type { DiagnosticSnapshot } from '../../shared/ipc-contract';

type HandlerDependencies = {
  providerConfigs: ProviderConfigRepository;
  credentials: CredentialRepository;
  getAppInfo(): AppInfo;
  getDiagnosticSnapshot(): DiagnosticSnapshot;
  connectionTests: ConnectionTestService;
  modelProxy: ModelProxyService;
  products: ProductRepository;
  productSync: Pick<ProductSyncService, 'syncDefault' | 'reconcileTracked'>;
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
    sync: dependencies.productSync,
  });
  registrar.handle(IPC_CHANNELS.appGetInfo, async () => ({
    ok: true,
    data: dependencies.getAppInfo(),
  }));
}
