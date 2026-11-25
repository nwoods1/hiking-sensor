// The subset of expo-sqlite's SQLiteDatabase that the app uses. Keeping
// the repository on this interface lets the tests run it against Node's
// built-in SQLite.

export type SqlValue = string | number | null;

export type SqlRunResult = { changes: number; lastInsertRowId: number };

export interface SqlDatabase {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, params: SqlValue[]): Promise<SqlRunResult>;
  getFirstAsync<T>(source: string, params: SqlValue[]): Promise<T | null>;
  getAllAsync<T>(source: string, params: SqlValue[]): Promise<T[]>;
}
