// Uploads finished hikes from SQLite to Supabase (replaces
// frontend/hike-sync.js + saveHike).
//
// Idempotency: the hike id is generated when recording starts and stored
// with the session, so every attempt targets the same storage path
// (`<user id>/<hike id>.json.gz`) and the same hikes.id. A retry after a
// crash, timeout or app restart finds the existing object/row instead of
// creating a second hike.
//
// A session is marked synced only after the hikes row has been read back
// from Supabase, and the row is only inserted after the storage upload
// succeeded (or the object was already there from an earlier attempt).
// Failures leave the local data untouched and schedule a retry.

import { encodeCompactFile } from '@/hikes/compactFile';
import { computeStats, type HikeStats } from '@/hikes/stats';
import type { HikeRepository, LocalSession } from '@/storage/hikeRepository';

export type HikeRow = HikeStats & {
  id: string;
  user_id: string;
  name: string | null;
  started_at: string;
  data_path: string;
};

export interface RemoteHikeStore {
  // 'exists' when the object is already at that path.
  uploadFile(path: string, bytes: Uint8Array): Promise<'created' | 'exists'>;
  // Reads the row back; RLS means this only sees the signed-in user's hikes.
  hikeExists(id: string): Promise<boolean>;
  // 'exists' on a primary-key conflict.
  insertHike(row: HikeRow): Promise<'created' | 'exists'>;
}

// Returns the user id of the currently signed-in Supabase session, or
// null. Must reflect the account whose token the remote store will use.
export type CurrentUser = () => Promise<string | null>;

export class NotOwnerError extends Error {
  constructor() {
    super('This hike belongs to a different account. Sign in as that account to upload it.');
    this.name = 'NotOwnerError';
  }
}

export class NotSignedInError extends Error {
  constructor() {
    super('Sign in to upload this hike.');
    this.name = 'NotSignedInError';
  }
}

export function dataPathFor(userId: string, hikeId: string): string {
  return `${userId}/${hikeId}.json.gz`;
}

// 30 s, 1 min, 2 min ... capped at 30 min.
export function retryDelayMs(attempts: number): number {
  return Math.min(30 * 60_000, 30_000 * 2 ** Math.max(0, attempts));
}

export type SyncResult = { synced: string[]; failed: { id: string; error: string }[] };

export class HikeUploader {
  // One upload per session at a time, so the finish button and a
  // background retry can't race each other.
  private inFlight = new Map<string, Promise<void>>();

  constructor(
    private readonly repo: HikeRepository,
    private readonly remote: RemoteHikeStore,
    private readonly currentUser: CurrentUser,
    private readonly now: () => number = Date.now,
  ) {}

  uploadSession(session: LocalSession): Promise<void> {
    let running = this.inFlight.get(session.id);
    if (!running) {
      running = this.upload(session).finally(() => this.inFlight.delete(session.id));
      this.inFlight.set(session.id, running);
    }
    return running;
  }

  private async upload(session: LocalSession): Promise<void> {
    if (session.sync_state === 'synced') return;
    if (session.status !== 'finished' || session.ended_at == null) {
      throw new Error('Hike has not finished yet');
    }

    // Never upload one user's hike with another user's token.
    const userId = await this.currentUser();
    if (!userId) throw new NotSignedInError();
    if (userId !== session.user_id) throw new NotOwnerError();

    // An earlier attempt may have inserted the row and then lost the
    // response (or the app was killed before marking it synced).
    if (await this.remote.hikeExists(session.id)) {
      await this.repo.markSynced(session.id, this.now());
      return;
    }

    const impacts = await this.repo.getImpacts(session.id);
    const path = dataPathFor(session.user_id, session.id);

    if (session.sync_state === 'pending') {
      await this.remote.uploadFile(path, encodeCompactFile(impacts));
      await this.repo.markFileUploaded(session.id);
    }

    const stats = computeStats(impacts, {
      durationMs: session.ended_at - session.started_at,
      stepThreshold: session.step_threshold,
      highThreshold: session.high_threshold,
    });

    await this.remote.insertHike({
      id: session.id,
      user_id: session.user_id,
      name: session.name,
      started_at: new Date(session.started_at).toISOString(),
      data_path: path,
      ...stats,
    });

    if (!(await this.remote.hikeExists(session.id))) {
      throw new Error('Supabase did not confirm the saved hike');
    }
    await this.repo.markSynced(session.id, this.now());
  }

  // Upload every due hike for this user. Errors are recorded per session
  // (with a backoff) rather than thrown.
  async syncAll(userId: string, { ignoreBackoff = false } = {}): Promise<SyncResult> {
    const result: SyncResult = { synced: [], failed: [] };
    const sessions = await this.repo.listUploadable(userId, this.now(), ignoreBackoff);

    for (const session of sessions) {
      try {
        await this.uploadSession(session);
        result.synced.push(session.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.failed.push({ id: session.id, error: message });
        // Signed out / other account: not the hike's fault, don't back off.
        const next =
          error instanceof NotOwnerError || error instanceof NotSignedInError
            ? this.now()
            : this.now() + retryDelayMs(session.sync_attempts);
        await this.repo.markSyncFailed(session.id, message, next);
        // Same token for every hike: stop after an auth problem.
        if (error instanceof NotOwnerError || error instanceof NotSignedInError) break;
      }
    }
    return result;
  }
}
