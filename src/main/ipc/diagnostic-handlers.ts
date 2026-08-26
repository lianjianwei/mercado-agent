import { ZodError } from 'zod';

import type { ProviderKind } from '../../domain/config';
import type { ConnectionResult } from '../../domain/providers';
import { providerKindSchema } from '../../shared/config-schemas';
import {
  IPC_CHANNELS,
  type DiagnosticSnapshot,
  type IpcRegistrar,
} from '../../shared/ipc-contract';

type ConnectionTestRunner = {
  test(kind: ProviderKind, signal?: AbortSignal): Promise<ConnectionResult>;
};

type DiagnosticHandlerDependencies = {
  getSnapshot(): DiagnosticSnapshot;
  connectionTests: ConnectionTestRunner;
};

export function registerDiagnosticHandlers(
  registrar: IpcRegistrar,
  dependencies: DiagnosticHandlerDependencies,
): void {
  const activeTests = new Map<ProviderKind, AbortController>();

  registrar.handle(IPC_CHANNELS.diagnosticGetSnapshot, async () => ({
    ok: true,
    data: dependencies.getSnapshot(),
  }));

  registrar.handle(
    IPC_CHANNELS.diagnosticTestConnection,
    async (_event, payload) => {
      try {
        const kind = providerKindSchema.parse(payload);
        activeTests.get(kind)?.abort();
        const controller = new AbortController();
        activeTests.set(kind, controller);
        const result = await dependencies.connectionTests.test(
          kind,
          controller.signal,
        );
        if (activeTests.get(kind) === controller) activeTests.delete(kind);
        return { ok: true, data: result };
      } catch (error) {
        if (error instanceof ZodError) {
          return {
            ok: false,
            error: {
              code: 'VALIDATION_ERROR' as const,
              message: 'The requested provider kind is invalid',
            },
          };
        }
        return {
          ok: false,
          error: {
            code: 'INTERNAL_ERROR' as const,
            message: 'The connection test could not be completed',
          },
        };
      }
    },
  );

  registrar.handle(
    IPC_CHANNELS.diagnosticCancelConnection,
    async (_event, payload) => {
      try {
        const kind = providerKindSchema.parse(payload);
        activeTests.get(kind)?.abort();
        activeTests.delete(kind);
        return { ok: true, data: null };
      } catch (error) {
        if (error instanceof ZodError) {
          return {
            ok: false,
            error: {
              code: 'VALIDATION_ERROR' as const,
              message: 'The requested provider kind is invalid',
            },
          };
        }
        return {
          ok: false,
          error: {
            code: 'INTERNAL_ERROR' as const,
            message: 'The connection test could not be cancelled',
          },
        };
      }
    },
  );
}
