import type { DatabaseSync } from 'node:sqlite';

import type {
  CredentialRepository,
  MiaoshouCredential,
  QiniuCredential,
} from '../../domain/config';

type CredentialKey = 'miaoshou' | 'qiniu';

export class SqliteCredentialRepository implements CredentialRepository {
  constructor(private readonly database: DatabaseSync) {}

  getMiaoshou(): MiaoshouCredential | null {
    return this.get<MiaoshouCredential>('miaoshou');
  }

  saveMiaoshou(value: MiaoshouCredential): void {
    this.save('miaoshou', value);
  }

  getQiniu(): QiniuCredential | null {
    return this.get<QiniuCredential>('qiniu');
  }

  saveQiniu(value: QiniuCredential): void {
    this.save('qiniu', value);
  }

  private get<T>(key: CredentialKey): T | null {
    const row = this.database
      .prepare('SELECT value_json FROM app_credentials WHERE key = ?')
      .get(key) as { value_json: string } | undefined;

    return row ? (JSON.parse(row.value_json) as T) : null;
  }

  private save<T extends object>(key: CredentialKey, value: T): void {
    this.database
      .prepare(
        `
          INSERT INTO app_credentials (key, value_json, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            value_json = excluded.value_json,
            updated_at = excluded.updated_at
        `,
      )
      .run(key, JSON.stringify(value), new Date().toISOString());
  }
}
