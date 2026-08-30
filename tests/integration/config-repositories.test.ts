import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { openAppDatabase } from '../../src/main/db/database';
import { SqliteCredentialRepository } from '../../src/main/repositories/credential-repository';
import { SqliteProviderConfigRepository } from '../../src/main/repositories/provider-config-repository';

const temporaryDirectories: string[] = [];

function createDatabasePath(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'mercado-agent-repo-'));
  temporaryDirectories.push(directory);
  return path.join(directory, 'mercado-agent.sqlite3');
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('provider configuration repository', () => {
  it('keeps one active configuration per kind without mixing text and image', () => {
    const database = openAppDatabase(createDatabasePath());
    const repository = new SqliteProviderConfigRepository(database);
    const firstText = repository.save({
      kind: 'text',
      provider: 'doubao',
      name: '豆包主配置',
      apiKey: 'doubao-secret',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      model: 'doubao-seed-1-8',
    });
    const secondText = repository.save({
      kind: 'text',
      provider: 'openai',
      name: 'OpenAI 备用',
      apiKey: 'openai-secret',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5',
    });
    const image = repository.save({
      kind: 'image',
      provider: 'openai',
      name: 'OpenAI 生图',
      apiKey: 'image-secret',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-image-1',
    });

    repository.activate(firstText.id);
    repository.activate(secondText.id);
    repository.activate(image.id);

    expect(repository.list('text').filter((item) => item.isActive)).toEqual([
      expect.objectContaining({ id: secondText.id }),
    ]);
    expect(repository.list('image').filter((item) => item.isActive)).toEqual([
      expect.objectContaining({ id: image.id }),
    ]);
    database.close();
  });

  it('updates and deletes saved configurations while preserving activation', () => {
    const database = openAppDatabase(createDatabasePath());
    const repository = new SqliteProviderConfigRepository(database);
    const original = repository.save({
      kind: 'text',
      provider: 'deepseek',
      name: 'DeepSeek',
      apiKey: 'old-secret',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
    });
    repository.activate(original.id);

    const updated = repository.save({
      id: original.id,
      kind: 'text',
      provider: 'deepseek',
      name: 'DeepSeek 更新',
      apiKey: 'new-secret',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-reasoner',
    });

    expect(updated).toMatchObject({
      id: original.id,
      name: 'DeepSeek 更新',
      apiKey: 'new-secret',
      isActive: true,
    });
    repository.delete(original.id);
    expect(repository.list('text')).toEqual([]);
    database.close();
  });

  it('persists and round-trips an OpenAI reasoningEffort', () => {
    const database = openAppDatabase(createDatabasePath());
    const repository = new SqliteProviderConfigRepository(database);
    const saved = repository.save({
      kind: 'text',
      provider: 'openai',
      name: 'OpenAI 推理',
      apiKey: 'secret',
      baseUrl: 'https://api.86gamestore.com/v1',
      model: 'gpt-5.6-terra',
      reasoningEffort: 'high',
    });

    expect(saved.reasoningEffort).toBe('high');
    expect(repository.list('text')).toEqual([
      expect.objectContaining({ id: saved.id, reasoningEffort: 'high' }),
    ]);

    // 未设置时保存为缺省(undefined)。
    const noEffort = repository.save({
      kind: 'text',
      provider: 'deepseek',
      name: 'DeepSeek',
      apiKey: 'secret',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
    });
    expect(noEffort.reasoningEffort).toBeUndefined();
    database.close();
  });
});

describe('credential repository', () => {
  it('stores plaintext Miaoshou and Qiniu credentials in the disk database', () => {
    const databasePath = createDatabasePath();
    const firstConnection = openAppDatabase(databasePath);
    const firstRepository = new SqliteCredentialRepository(firstConnection);

    firstRepository.saveMiaoshou({
      appKey: 'miaoshou-app-key',
      appSecret: 'miaoshou-app-secret',
      baseUrl: 'https://openapi.91miaoshou.com',
    });
    firstRepository.saveQiniu({
      accessKey: 'qiniu-access-key',
      secretKey: 'qiniu-secret-key',
      bucket: 'mercado-products',
      domain: 'https://images.example.com',
      region: 'z0',
    });
    firstConnection.close();

    const secondConnection = openAppDatabase(databasePath);
    const secondRepository = new SqliteCredentialRepository(secondConnection);
    expect(secondRepository.getMiaoshou()).toEqual({
      appKey: 'miaoshou-app-key',
      appSecret: 'miaoshou-app-secret',
      baseUrl: 'https://openapi.91miaoshou.com',
    });
    expect(secondRepository.getQiniu()).toEqual({
      accessKey: 'qiniu-access-key',
      secretKey: 'qiniu-secret-key',
      bucket: 'mercado-products',
      domain: 'https://images.example.com',
      region: 'z0',
    });
    secondConnection.close();
  });
});
