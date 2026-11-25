import * as SQLite from 'expo-sqlite';

import { HikeRepository } from './hikeRepository';
import { migrate } from './schema';

const DATABASE_NAME = 'softsteps.db';

let repository: Promise<HikeRepository> | null = null;

// Opened once for the whole app (recording, sync and screens share it).
export function getRepository(): Promise<HikeRepository> {
  if (!repository) {
    repository = (async () => {
      const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
      await migrate(db);
      return new HikeRepository(db);
    })();
    // Let a later call retry if opening failed.
    repository.catch(() => {
      repository = null;
    });
  }
  return repository;
}
