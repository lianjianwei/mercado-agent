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

type HandlerDependencies = {
  providerConfigs: ProviderConfigRepository;
  credentials: CredentialRepository;
  getAppInfo(): AppInfo;
};

export function registerHandlers(
  registrar: IpcRegistrar,
  dependencies: HandlerDependencies,
): void {
  registerConfigHandlers(registrar, dependencies);
  registrar.handle(IPC_CHANNELS.appGetInfo, async () => ({
    ok: true,
    data: dependencies.getAppInfo(),
  }));
}
