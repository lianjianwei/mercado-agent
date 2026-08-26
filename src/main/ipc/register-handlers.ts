import type {
  CredentialRepository,
  ProviderConfigRepository,
} from '../../domain/config';
import {
  IPC_CHANNELS,
  type AppInfo,
  type IpcRegistrar,
} from '../../shared/ipc-contract';
import { registerConfigHandlers } from './config-handlers';
import { registerDiagnosticHandlers } from './diagnostic-handlers';
import type { ConnectionTestService } from '../services/connection-test-service';
import type { DiagnosticSnapshot } from '../../shared/ipc-contract';

type HandlerDependencies = {
  providerConfigs: ProviderConfigRepository;
  credentials: CredentialRepository;
  getAppInfo(): AppInfo;
  getDiagnosticSnapshot(): DiagnosticSnapshot;
  connectionTests: ConnectionTestService;
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
  registrar.handle(IPC_CHANNELS.appGetInfo, async () => ({
    ok: true,
    data: dependencies.getAppInfo(),
  }));
}
