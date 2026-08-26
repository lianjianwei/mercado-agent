import { z, ZodError } from 'zod';

import {
  ProviderConfigNotFoundError,
  type CredentialRepository,
  type ProviderConfigRepository,
} from '../../domain/config';
import {
  appCredentialsInputSchema,
  providerConfigInputSchema,
  providerIdSchema,
  providerKindSchema,
} from '../../shared/config-schemas';
import {
  IPC_CHANNELS,
  type IpcListener,
  type IpcRegistrar,
  type IpcResult,
} from '../../shared/ipc-contract';

type ConfigHandlerDependencies = {
  providerConfigs: ProviderConfigRepository;
  credentials: CredentialRepository;
};

const providerIdInputSchema = z.strictObject({ id: providerIdSchema });

function validationError(error: ZodError): IpcResult<never> {
  return {
    ok: false,
    error: {
      code: 'VALIDATION_ERROR',
      message: 'The submitted configuration is invalid',
      issues: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    },
  };
}

function protectedHandler<Input, Output>(
  schema: z.ZodType<Input>,
  action: (input: Input) => Output | Promise<Output>,
): IpcListener {
  return async (_event, payload) => {
    try {
      const input = schema.parse(payload);
      return { ok: true, data: await action(input) };
    } catch (error) {
      if (error instanceof ZodError) {
        return validationError(error);
      }
      if (error instanceof ProviderConfigNotFoundError) {
        return {
          ok: false,
          error: {
            code: 'NOT_FOUND',
            message: error.message,
          },
        };
      }
      return {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'The local operation could not be completed',
        },
      };
    }
  };
}

export function registerConfigHandlers(
  registrar: IpcRegistrar,
  dependencies: ConfigHandlerDependencies,
): void {
  registrar.handle(
    IPC_CHANNELS.configListProviders,
    protectedHandler(providerKindSchema, (kind) =>
      dependencies.providerConfigs.list(kind),
    ),
  );
  registrar.handle(
    IPC_CHANNELS.configSaveProvider,
    protectedHandler(providerConfigInputSchema, (input) =>
      dependencies.providerConfigs.save(input),
    ),
  );
  registrar.handle(
    IPC_CHANNELS.configActivateProvider,
    protectedHandler(providerIdInputSchema, ({ id }) => {
      dependencies.providerConfigs.activate(id);
      return null;
    }),
  );
  registrar.handle(
    IPC_CHANNELS.configDeleteProvider,
    protectedHandler(providerIdInputSchema, ({ id }) => {
      dependencies.providerConfigs.delete(id);
      return null;
    }),
  );
  registrar.handle(
    IPC_CHANNELS.configGetCredentials,
    protectedHandler(z.undefined(), () => ({
      miaoshou: dependencies.credentials.getMiaoshou(),
      qiniu: dependencies.credentials.getQiniu(),
    })),
  );
  registrar.handle(
    IPC_CHANNELS.configSaveCredentials,
    protectedHandler(appCredentialsInputSchema, (input) => {
      if (input.miaoshou) {
        dependencies.credentials.saveMiaoshou(input.miaoshou);
      }
      if (input.qiniu) {
        dependencies.credentials.saveQiniu(input.qiniu);
      }
      return null;
    }),
  );
}
