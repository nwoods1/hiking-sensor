import type { SqlDatabase } from './sql';

// Replaces the web app's IndexedDB "HikingDatabase" (sessions + readings).
// Only detected foot strikes are stored, like the web app's saveReading(...,
// forceSave=true) calls; continuous samples are never persisted.
//
// sessions.id is generated on the phone and reused as the Supabase hikes.id,
// so the storage path and row are the same on every upload attempt.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT,
    status TEXT NOT NULL,              -- 'recording' | 'finished'
    started_at INTEGER NOT NULL,       -- epoch ms
    ended_at INTEGER,
    last_packet_at INTEGER,            -- heartbeat while recording
    step_threshold REAL NOT NULL,
    high_threshold REAL NOT NULL,
    calibration_offset REAL,           -- straight-leg offset, deg
    source TEXT NOT NULL,              -- 'ble' | 'mock'
    device_id TEXT,
    device_name TEXT,
    sync_state TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'file_uploaded' | 'synced'
    sync_error TEXT,
    sync_attempts INTEGER NOT NULL DEFAULT 0,
    next_sync_at INTEGER,
    synced_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions (user_id, started_at);

  CREATE TABLE impacts (
    session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    timestamp INTEGER NOT NULL,        -- epoch ms of the peak packet
    t_ms INTEGER NOT NULL,             -- ms since the hike started
    accel REAL NOT NULL,               -- impact proxy, g
    angle REAL NOT NULL,               -- knee angle, deg
    swing REAL,                        -- swing amplitude proxy, deg
    PRIMARY KEY (session_id, seq)
  );

  CREATE TABLE gaps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    reason TEXT NOT NULL               -- 'disconnect' | 'app_restart'
  );
  CREATE INDEX gaps_session ON gaps (session_id);
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export async function migrate(db: SqlDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []);
  let version = row?.user_version ?? 0;
  while (version < MIGRATIONS.length) {
    try {
      await db.execAsync(`BEGIN; ${MIGRATIONS[version]} PRAGMA user_version = ${version + 1}; COMMIT;`);
    } catch (error) {
      await db.execAsync('ROLLBACK;').catch(() => {});
      throw error;
    }
    version++;
  }
}
