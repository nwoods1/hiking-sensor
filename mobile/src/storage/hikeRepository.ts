import type { Impact } from '@/hikes/stats';

import type { SqlDatabase } from './sql';

export type SessionStatus = 'recording' | 'finished';
export type SyncState = 'pending' | 'file_uploaded' | 'synced';
export type SensorSource = 'ble' | 'mock';

export type LocalSession = {
  id: string;
  user_id: string;
  name: string | null;
  status: SessionStatus;
  started_at: number;
  ended_at: number | null;
  last_packet_at: number | null;
  step_threshold: number;
  high_threshold: number;
  calibration_offset: number | null;
  source: SensorSource;
  device_id: string | null;
  device_name: string | null;
  sync_state: SyncState;
  sync_error: string | null;
  sync_attempts: number;
  next_sync_at: number | null;
  synced_at: number | null;
  created_at: number;
};

export type LocalSessionSummary = LocalSession & {
  step_count: number;
  last_impact_at: number | null;
};

export type StoredImpact = {
  seq: number;
  timestamp: number;
  accel: number;
  angle: number;
  swing: number | null;
};

export type Gap = {
  id: number;
  session_id: string;
  started_at: number;
  ended_at: number | null;
  reason: 'disconnect' | 'app_restart';
};

export type NewSession = {
  id: string;
  userId: string;
  name: string | null;
  startedAt: number;
  stepThreshold: number;
  highThreshold: number;
  source: SensorSource;
  deviceId: string | null;
  deviceName: string | null;
};

const SUMMARY_SELECT = `
  SELECT s.*,
    (SELECT COUNT(*) FROM impacts i WHERE i.session_id = s.id) AS step_count,
    (SELECT MAX(timestamp) FROM impacts i WHERE i.session_id = s.id) AS last_impact_at
  FROM sessions s`;

// All reads that list sessions take a userId, so one account never sees
// (or uploads) another account's hikes recorded on the same phone.
export class HikeRepository {
  // Writes go through one promise chain so they land in call order even
  // though BLE callbacks don't wait for each other.
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly db: SqlDatabase) {}

  private write<T>(work: () => Promise<T>): Promise<T> {
    const next = this.writeChain.then(work, work);
    this.writeChain = next.catch(() => {});
    return next;
  }

  // Resolves once every write queued so far has finished.
  flush(): Promise<void> {
    return this.writeChain.then(() => {});
  }

  createSession(s: NewSession): Promise<void> {
    return this.write(async () => {
      await this.db.runAsync(
        `INSERT INTO sessions (id, user_id, name, status, started_at, last_packet_at,
           step_threshold, high_threshold, source, device_id, device_name, created_at)
         VALUES (?, ?, ?, 'recording', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          s.id,
          s.userId,
          s.name,
          s.startedAt,
          s.startedAt,
          s.stepThreshold,
          s.highThreshold,
          s.source,
          s.deviceId,
          s.deviceName,
          Date.now(),
        ],
      );
    });
  }

  // Idempotent per (session, seq), so a retried write can't double a step.
  appendImpact(sessionId: string, startedAt: number, impact: StoredImpact): Promise<void> {
    return this.write(async () => {
      await this.db.runAsync(
        `INSERT OR IGNORE INTO impacts (session_id, seq, timestamp, t_ms, accel, angle, swing)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          sessionId,
          impact.seq,
          impact.timestamp,
          impact.timestamp - startedAt,
          impact.accel,
          impact.angle,
          impact.swing,
        ],
      );
    });
  }

  setCalibration(sessionId: string, offset: number): Promise<void> {
    return this.write(async () => {
      await this.db.runAsync('UPDATE sessions SET calibration_offset = ? WHERE id = ?', [offset, sessionId]);
    });
  }

  setDevice(sessionId: string, deviceId: string | null, deviceName: string | null): Promise<void> {
    return this.write(async () => {
      await this.db.runAsync('UPDATE sessions SET device_id = ?, device_name = ? WHERE id = ?', [
        deviceId,
        deviceName,
        sessionId,
      ]);
    });
  }

  heartbeat(sessionId: string, lastPacketAt: number): Promise<void> {
    return this.write(async () => {
      await this.db.runAsync(`UPDATE sessions SET last_packet_at = ? WHERE id = ? AND status = 'recording'`, [
        lastPacketAt,
        sessionId,
      ]);
    });
  }

  openGap(sessionId: string, startedAt: number, reason: Gap['reason']): Promise<number> {
    return this.write(async () => {
      const result = await this.db.runAsync('INSERT INTO gaps (session_id, started_at, reason) VALUES (?, ?, ?)', [
        sessionId,
        startedAt,
        reason,
      ]);
      return result.lastInsertRowId;
    });
  }

  closeOpenGaps(sessionId: string, endedAt: number): Promise<void> {
    return this.write(async () => {
      await this.db.runAsync('UPDATE gaps SET ended_at = ? WHERE session_id = ? AND ended_at IS NULL', [
        endedAt,
        sessionId,
      ]);
    });
  }

  finishSession(sessionId: string, endedAt: number): Promise<void> {
    return this.write(async () => {
      await this.db.runAsync('UPDATE gaps SET ended_at = ? WHERE session_id = ? AND ended_at IS NULL', [
        endedAt,
        sessionId,
      ]);
      await this.db.runAsync(
        `UPDATE sessions SET status = 'finished', ended_at = ?, next_sync_at = NULL
         WHERE id = ? AND status = 'recording'`,
        [endedAt, sessionId],
      );
    });
  }

  discardSession(sessionId: string): Promise<void> {
    return this.write(async () => {
      await this.db.runAsync('DELETE FROM impacts WHERE session_id = ?', [sessionId]);
      await this.db.runAsync('DELETE FROM gaps WHERE session_id = ?', [sessionId]);
      await this.db.runAsync('DELETE FROM sessions WHERE id = ?', [sessionId]);
    });
  }

  rename(sessionId: string, userId: string, name: string | null): Promise<void> {
    return this.write(async () => {
      await this.db.runAsync(`UPDATE sessions SET name = ? WHERE id = ? AND user_id = ? AND sync_state != 'synced'`, [
        name,
        sessionId,
        userId,
      ]);
    });
  }

  // ---- sync bookkeeping ----

  markFileUploaded(sessionId: string): Promise<void> {
    return this.write(async () => {
      await this.db.runAsync(
        `UPDATE sessions SET sync_state = 'file_uploaded' WHERE id = ? AND sync_state = 'pending'`,
        [sessionId],
      );
    });
  }

  markSynced(sessionId: string, at: number): Promise<void> {
    return this.write(async () => {
      await this.db.runAsync(
        `UPDATE sessions SET sync_state = 'synced', synced_at = ?, sync_error = NULL,
           next_sync_at = NULL WHERE id = ?`,
        [at, sessionId],
      );
    });
  }

  markSyncFailed(sessionId: string, error: string, nextAttemptAt: number): Promise<void> {
    return this.write(async () => {
      await this.db.runAsync(
        `UPDATE sessions SET sync_error = ?, sync_attempts = sync_attempts + 1,
           next_sync_at = ? WHERE id = ?`,
        [error, nextAttemptAt, sessionId],
      );
    });
  }

  // ---- reads ----

  getSession(sessionId: string, userId: string): Promise<LocalSessionSummary | null> {
    return this.db.getFirstAsync<LocalSessionSummary>(`${SUMMARY_SELECT} WHERE s.id = ? AND s.user_id = ?`, [
      sessionId,
      userId,
    ]);
  }

  listSessions(userId: string): Promise<LocalSessionSummary[]> {
    return this.db.getAllAsync<LocalSessionSummary>(
      `${SUMMARY_SELECT} WHERE s.user_id = ? ORDER BY s.started_at DESC`,
      [userId],
    );
  }

  // Unfinished hikes (the app was closed or crashed while recording).
  listRecording(userId: string): Promise<LocalSessionSummary[]> {
    return this.db.getAllAsync<LocalSessionSummary>(
      `${SUMMARY_SELECT} WHERE s.user_id = ? AND s.status = 'recording' ORDER BY s.started_at DESC`,
      [userId],
    );
  }

  // Finished, not yet confirmed in Supabase, and due for an attempt.
  listUploadable(userId: string, now: number, ignoreBackoff = false): Promise<LocalSession[]> {
    return this.db.getAllAsync<LocalSession>(
      `SELECT * FROM sessions
       WHERE user_id = ? AND status = 'finished' AND sync_state != 'synced'
         AND (? = 1 OR next_sync_at IS NULL OR next_sync_at <= ?)
       ORDER BY started_at ASC`,
      [userId, ignoreBackoff ? 1 : 0, now],
    );
  }

  countUnsynced(userId: string): Promise<number> {
    return this.db
      .getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND sync_state != 'synced'`, [
        userId,
      ])
      .then((row) => row?.n ?? 0);
  }

  getStoredImpacts(sessionId: string): Promise<StoredImpact[]> {
    return this.db.getAllAsync<StoredImpact>(
      'SELECT seq, timestamp, accel, angle, swing FROM impacts WHERE session_id = ? ORDER BY seq',
      [sessionId],
    );
  }

  // Impacts in the upload format: t is ms since the hike started, from the
  // peak timestamp recorded at detection time.
  getImpacts(sessionId: string): Promise<Impact[]> {
    return this.db.getAllAsync<Impact>(
      'SELECT t_ms AS t, accel, angle FROM impacts WHERE session_id = ? ORDER BY seq',
      [sessionId],
    );
  }

  getGaps(sessionId: string): Promise<Gap[]> {
    return this.db.getAllAsync<Gap>('SELECT * FROM gaps WHERE session_id = ? ORDER BY started_at', [sessionId]);
  }
}
