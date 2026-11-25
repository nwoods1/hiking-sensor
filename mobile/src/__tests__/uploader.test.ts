import zlib from 'zlib';

import { HikeRepository } from '@/storage/hikeRepository';
import { migrate } from '@/storage/schema';
import { HikeUploader, NotOwnerError, retryDelayMs, type HikeRow, type RemoteHikeStore } from '@/sync/uploader';

import { createTestDatabase } from './helpers/nodeSqlite';
import { newSession, START } from './helpers/fixtures';

const NOW = START + 3_600_000;

// In-memory stand-in for the Supabase bucket + hikes table, with knobs to
// fail individual steps.
class FakeRemote implements RemoteHikeStore {
  files = new Map<string, Uint8Array>();
  rows = new Map<string, HikeRow>();
  calls: string[] = [];
  failUpload = false;
  failInsert = false;
  // Insert succeeds on the server but the response is lost.
  loseInsertResponse = false;

  async uploadFile(path: string, bytes: Uint8Array) {
    this.calls.push(`upload ${path}`);
    if (this.failUpload) throw new Error('network down');
    if (this.files.has(path)) return 'exists' as const;
    this.files.set(path, bytes);
    return 'created' as const;
  }
  async hikeExists(id: string) {
    this.calls.push(`exists ${id}`);
    return this.rows.has(id);
  }
  async insertHike(row: HikeRow) {
    this.calls.push(`insert ${row.id}`);
    if (this.failInsert) throw new Error('insert failed');
    if (this.rows.has(row.id)) return 'exists' as const;
    this.rows.set(row.id, row);
    if (this.loseInsertResponse) throw new Error('timeout');
    return 'created' as const;
  }
}

async function setup(user: string | null = 'user-a') {
  const db = createTestDatabase();
  await migrate(db);
  const repo = new HikeRepository(db);
  const remote = new FakeRemote();
  const auth = { user };
  const uploader = new HikeUploader(
    repo,
    remote,
    async () => auth.user,
    () => NOW,
  );

  await repo.createSession(newSession());
  for (let i = 0; i < 40; i++) {
    await repo.appendImpact('hike-1', START, {
      seq: i,
      timestamp: START + 1000 + i * 900,
      accel: 0.9 + (i % 7) * 0.25,
      angle: 165 + (i % 5),
      swing: null,
    });
  }
  await repo.finishSession('hike-1', START + 60_000);
  return { repo, remote, uploader, auth };
}

const session = (repo: HikeRepository) => repo.getSession('hike-1', 'user-a');

describe('HikeUploader', () => {
  it('uploads the file, inserts the row, confirms it, then marks synced', async () => {
    const { repo, remote, uploader } = await setup();
    const result = await uploader.syncAll('user-a');

    expect(result).toEqual({ synced: ['hike-1'], failed: [] });
    expect((await session(repo))?.sync_state).toBe('synced');
    expect(remote.calls).toEqual(['exists hike-1', 'upload user-a/hike-1.json.gz', 'insert hike-1', 'exists hike-1']);

    const row = remote.rows.get('hike-1')!;
    expect(row).toMatchObject({
      id: 'hike-1',
      user_id: 'user-a',
      name: 'Pine Ridge',
      started_at: new Date(START).toISOString(),
      data_path: 'user-a/hike-1.json.gz',
      duration_s: 60,
      step_count: 40,
      step_threshold: 0.8,
      high_impact_threshold: 2.0,
    });

    const file = JSON.parse(zlib.gunzipSync(remote.files.get('user-a/hike-1.json.gz')!).toString());
    expect(file.v).toBe(1);
    expect(file.t[0]).toBe(1000);
    expect(file.t).toHaveLength(40);
  });

  it('keeps local data and backs off when the storage upload fails', async () => {
    const { repo, remote, uploader } = await setup();
    remote.failUpload = true;
    const result = await uploader.syncAll('user-a');

    expect(result.failed).toEqual([{ id: 'hike-1', error: 'network down' }]);
    const s = await session(repo);
    expect(s?.sync_state).toBe('pending');
    expect(s?.next_sync_at).toBe(NOW + retryDelayMs(0));
    expect(await repo.getImpacts('hike-1')).toHaveLength(40);
    expect(remote.rows.size).toBe(0);
  });

  it('retries a failed insert with the same id and path, without re-uploading', async () => {
    const { repo, remote, uploader } = await setup();
    remote.failInsert = true;
    await uploader.syncAll('user-a');
    expect((await session(repo))?.sync_state).toBe('file_uploaded');

    remote.failInsert = false;
    remote.calls = [];
    await uploader.syncAll('user-a', { ignoreBackoff: true });

    expect(remote.calls).toEqual(['exists hike-1', 'insert hike-1', 'exists hike-1']);
    expect(remote.rows.size).toBe(1);
    expect(remote.files.size).toBe(1);
    expect((await session(repo))?.sync_state).toBe('synced');
  });

  it('does not duplicate a hike when the insert response was lost', async () => {
    const { repo, remote, uploader } = await setup();
    remote.loseInsertResponse = true;
    await uploader.syncAll('user-a');
    expect((await session(repo))?.sync_state).toBe('file_uploaded');

    remote.loseInsertResponse = false;
    remote.calls = [];
    await uploader.syncAll('user-a', { ignoreBackoff: true });

    // Found the row on the first check: no second upload or insert.
    expect(remote.calls).toEqual(['exists hike-1']);
    expect(remote.rows.size).toBe(1);
    expect((await session(repo))?.sync_state).toBe('synced');
  });

  it('treats an object left by an earlier attempt as uploaded', async () => {
    const { repo, remote, uploader } = await setup();
    remote.files.set('user-a/hike-1.json.gz', new Uint8Array([1]));
    await uploader.syncAll('user-a');
    expect((await session(repo))?.sync_state).toBe('synced');
    expect(remote.rows.size).toBe(1);
  });

  it('never uploads a hike under a different signed-in account', async () => {
    const { repo, remote, uploader, auth } = await setup();
    auth.user = 'user-b';
    const s = await repo.listUploadable('user-a', NOW);
    await expect(uploader.uploadSession(s[0])).rejects.toBeInstanceOf(NotOwnerError);
    expect(remote.calls).toEqual([]);
    expect(await uploader.syncAll('user-b')).toEqual({ synced: [], failed: [] });
    expect(remote.calls).toEqual([]);
  });

  it('does nothing while signed out', async () => {
    const { repo, remote, uploader } = await setup(null);
    const result = await uploader.syncAll('user-a');
    expect(result.failed[0].error).toMatch(/Sign in/);
    expect(remote.calls).toEqual([]);
    expect((await session(repo))?.sync_state).toBe('pending');
  });

  it('runs a single upload when finish and a background retry race', async () => {
    const { repo, remote, uploader } = await setup();
    const [s] = await repo.listUploadable('user-a', NOW);
    await Promise.all([uploader.uploadSession(s), uploader.uploadSession(s), uploader.syncAll('user-a')]);
    expect(remote.calls.filter((c) => c.startsWith('upload'))).toHaveLength(1);
    expect(remote.calls.filter((c) => c.startsWith('insert'))).toHaveLength(1);
  });

  it('skips sessions that are still recording', async () => {
    const { repo, remote, uploader } = await setup();
    await repo.createSession(newSession({ id: 'hike-2', startedAt: START + 100_000 }));
    await uploader.syncAll('user-a');
    expect(remote.rows.has('hike-2')).toBe(false);
  });

  it('backs off exponentially up to 30 minutes', () => {
    expect(retryDelayMs(0)).toBe(30_000);
    expect(retryDelayMs(1)).toBe(60_000);
    expect(retryDelayMs(20)).toBe(30 * 60_000);
  });
});
