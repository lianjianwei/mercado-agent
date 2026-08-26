import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { openAppDatabase } from '../../src/main/db/database';
import { registerConfigHandlers } from '../../src/main/ipc/config-handlers';
import { SqliteCredentialRepository } from '../../src/main/repositories/credential-repository';
import { SqliteProviderConfigRepository } from '../../src/main/repositories/provider-config-repository';
import {
  IPC_CHANNELS,
  type IpcRegistrar,
  type IpcResult,
} from '../../src/shared/ipc-contract';

const temporaryDirectories: string[] = [];

function createHarness() {
  const directory = mkdtempSync(path.join(tmpdir(), 'mercado-agent-ipc-'));
  temporaryDirectories.push(directory);
  const database = openAppDatabase(
    path.join(directory, 'mercado-agent.sqlite3'),
  );
  const handlers = new Map<
    string,
    (event: unknown, payload: unknown) => Promise<IpcResult<unknown>>
  >();
  const registrar: IpcRegistrar = {
    handle(channel, listener) {
      handlers.set(channel, listener);
    },
  };

  registerConfigHandlers(registrar, {
    providerConfigs: new SqliteProviderConfigRepository(database),
    credentials: new SqliteCredentialRepository(database),
  });

  return {
    database,
    async invoke<T>(channel: string, payload?: unknown): Promise<IpcResult<T>> {
      const handler = handlers.get(channel);
      if (!handler) {
        throw new Error(`Missing test handler: ${channel}`);
      }
      return (await handler({}, payload)) as IpcResult<T>;
    },
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('configuration IPC', () => {
  it('rejects invalid renderer input before writing to a repository', async () => {
    const harness = createHarness();

    const response = await harness.invoke(IPC_CHANNELS.configSaveProvider, {
      kind: 'text',
      provider: 'openai',
      name: 'OpenAI',
      apiKey: '',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5',
    });

    expect(response).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR' },
    });
    const list = await harness.invoke<unknown[]>(
      IPC_CHANNELS.configListProviders,
      'text',
    );
    expect(list).toEqual({ ok: true, data: [] });
    harness.database.close();
  });

  it('saves, activates and returns viewable provider secrets', async () => {
    const harness = createHarness();
    const saved = await harness.invoke<{ id: string }>(
      IPC_CHANNELS.configSaveProvider,
      {
        kind: 'text',
        provider: 'deepseek',
        name: 'DeepSeek',
        apiKey: 'visible-local-secret',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-chat',
      },
    );
    expect(saved.ok).toBe(true);
    if (!saved.ok) {
      throw new Error('Expected provider save to succeed');
    }

    expect(
      await harness.invoke(IPC_CHANNELS.configActivateProvider, {
        id: saved.data.id,
      }),
    ).toEqual({ ok: true, data: null });
    const list = await harness.invoke<
      Array<{ apiKey: string; isActive: boolean }>
    >(IPC_CHANNELS.configListProviders, 'text');
    expect(list).toEqual({
      ok: true,
      data: [
        expect.objectContaining({
          apiKey: 'visible-local-secret',
          isActive: true,
        }),
      ],
    });
    harness.database.close();
  });

  it('stores and returns each credential group independently', async () => {
    const harness = createHarness();

    expect(
      await harness.invoke(IPC_CHANNELS.configSaveCredentials, {
        miaoshou: {
          appKey: 'app-key',
          appSecret: 'app-secret',
          baseUrl: 'https://openapi.example.com',
        },
      }),
    ).toEqual({ ok: true, data: null });
    expect(await harness.invoke(IPC_CHANNELS.configGetCredentials)).toEqual({
      ok: true,
      data: {
        miaoshou: {
          appKey: 'app-key',
          appSecret: 'app-secret',
          baseUrl: 'https://openapi.example.com',
        },
        qiniu: null,
      },
    });
    harness.database.close();
  });

  it('returns a stable not-found error without exposing an exception stack', async () => {
    const harness = createHarness();

    expect(
      await harness.invoke(IPC_CHANNELS.configActivateProvider, {
        id: '4c687ed8-a96d-4b39-a8de-6c339163959a',
      }),
    ).toEqual({
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Provider configuration was not found',
      },
    });
    harness.database.close();
  });
});
