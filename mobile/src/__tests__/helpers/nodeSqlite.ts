// In-memory SqlDatabase backed by Node's built-in SQLite (node:sqlite), so
// repository tests run real SQL without the expo-sqlite native module.
// process.getBuiltinModule bypasses Jest's module registry, which doesn't
// know about prefix-only builtins like node:sqlite.

import type { SqlDatabase, SqlValue } from '@/storage/sql';

type Statement = {
  run(...params: SqlValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: SqlValue[]): unknown;
  all(...params: SqlValue[]): unknown[];
};
type DatabaseSync = { exec(sql: string): void; prepare(sql: string): Statement; close(): void };

export function createTestDatabase(): SqlDatabase & { close(): void } {
  const sqlite = (
    process as unknown as {
      getBuiltinModule(name: string): { DatabaseSync: new (path: string) => DatabaseSync };
    }
  ).getBuiltinModule('node:sqlite');
  const db = new sqlite.DatabaseSync(':memory:');
  const plain = <T>(row: unknown) => (row == null ? null : ({ ...(row as object) } as T));

  return {
    async execAsync(source) {
      db.exec(source);
    },
    async runAsync(source, params) {
      const result = db.prepare(source).run(...params);
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    async getFirstAsync<T>(source: string, params: SqlValue[]) {
      return plain<T>(db.prepare(source).get(...params));
    },
    async getAllAsync<T>(source: string, params: SqlValue[]) {
      return db
        .prepare(source)
        .all(...params)
        .map((row) => plain<T>(row) as T);
    },
    close() {
      db.close();
    },
  };
}
