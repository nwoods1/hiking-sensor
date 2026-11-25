import { HikeRepository } from '@/storage/hikeRepository';
import { migrate, SCHEMA_VERSION } from '@/storage/schema';

import { newSession, START } from './helpers/fixtures';
import { createTestDatabase } from './helpers/nodeSqlite';

async function setup() {
  const db = createTestDatabase();
  await migrate(db);
  return { db, repo: new HikeRepository(db) };
}

describe('schema', () => {
  it('migrates once and is idempotent', async () => {
    const { db } = await setup();
    await migrate(db);
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []);
    expect(row?.user_version).toBe(SCHEMA_VERSION);
  });
});

describe('HikeRepository', () => {
  it('stores impacts incrementally with their original peak timestamps', async () => {
    const { repo } = await setup();
    await repo.createSession(newSession());
    await repo.appendImpact('hike-1', START, { seq: 0, timestamp: START + 1234, accel: 1.5, angle: 170, swing: null });
    await repo.appendImpact('hike-1', START, { seq: 1, timestamp: START + 2400, accel: 2.1, angle: 165, swing: 22 });

    expect(await repo.getImpacts('hike-1')).toEqual([
      { t: 1234, accel: 1.5, angle: 170 },
      { t: 2400, accel: 2.1, angle: 165 },
    ]);
    const stored = await repo.getStoredImpacts('hike-1');
    expect(stored[1].timestamp).toBe(START + 2400);
    expect((await repo.getSession('hike-1', 'user-a'))?.step_count).toBe(2);
  });

  it('ignores a duplicate write of the same step', async () => {
    const { repo } = await setup();
    await repo.createSession(newSession());
    const impact = { seq: 0, timestamp: START + 500, accel: 1, angle: 170, swing: null };
    await repo.appendImpact('hike-1', START, impact);
    await repo.appendImpact('hike-1', START, impact);
    expect(await repo.getImpacts('hike-1')).toHaveLength(1);
  });

  it('keeps each account to its own hikes', async () => {
    const { repo } = await setup();
    await repo.createSession(newSession({ id: 'a1', userId: 'user-a' }));
    await repo.createSession(newSession({ id: 'b1', userId: 'user-b' }));
    await repo.finishSession('a1', START + 60_000);
    await repo.finishSession('b1', START + 60_000);

    expect((await repo.listSessions('user-a')).map((s) => s.id)).toEqual(['a1']);
    expect(await repo.getSession('b1', 'user-a')).toBeNull();
    expect((await repo.listUploadable('user-a', Date.now())).map((s) => s.id)).toEqual(['a1']);
    expect(await repo.countUnsynced('user-b')).toBe(1);
  });

  it('finds unfinished sessions for recovery and records gaps', async () => {
    const { repo } = await setup();
    await repo.createSession(newSession());
    await repo.heartbeat('hike-1', START + 30_000);
    await repo.setCalibration('hike-1', 12.5);
    await repo.openGap('hike-1', START + 30_000, 'disconnect');

    const [recovering] = await repo.listRecording('user-a');
    expect(recovering.id).toBe('hike-1');
    expect(recovering.last_packet_at).toBe(START + 30_000);
    expect(recovering.calibration_offset).toBe(12.5);
    expect(await repo.listUploadable('user-a', Date.now())).toEqual([]);

    await repo.finishSession('hike-1', START + 90_000);
    const gaps = await repo.getGaps('hike-1');
    expect(gaps).toHaveLength(1);
    expect(gaps[0].ended_at).toBe(START + 90_000);
    expect(await repo.listRecording('user-a')).toEqual([]);
    const done = await repo.getSession('hike-1', 'user-a');
    expect(done?.status).toBe('finished');
    expect(done?.ended_at).toBe(START + 90_000);
  });

  it('respects the retry backoff unless forced', async () => {
    const { repo } = await setup();
    await repo.createSession(newSession());
    await repo.finishSession('hike-1', START + 1000);
    await repo.markSyncFailed('hike-1', 'offline', 5_000);

    expect(await repo.listUploadable('user-a', 4_999)).toHaveLength(0);
    expect(await repo.listUploadable('user-a', 5_000)).toHaveLength(1);
    expect(await repo.listUploadable('user-a', 0, true)).toHaveLength(1);
    const s = await repo.getSession('hike-1', 'user-a');
    expect(s?.sync_attempts).toBe(1);
    expect(s?.sync_error).toBe('offline');
  });

  it('keeps writes in call order without awaiting each one', async () => {
    const { repo } = await setup();
    const pending = [repo.createSession(newSession())];
    for (let i = 0; i < 50; i++) {
      pending.push(
        repo.appendImpact('hike-1', START, { seq: i, timestamp: START + i * 600, accel: 1, angle: 170, swing: null }),
      );
    }
    pending.push(repo.finishSession('hike-1', START + 60_000));
    await Promise.all(pending);
    expect(await repo.getImpacts('hike-1')).toHaveLength(50);
  });

  it('discards a session and its data', async () => {
    const { repo } = await setup();
    await repo.createSession(newSession());
    await repo.appendImpact('hike-1', START, { seq: 0, timestamp: START, accel: 1, angle: 170, swing: null });
    await repo.discardSession('hike-1');
    expect(await repo.getSession('hike-1', 'user-a')).toBeNull();
    expect(await repo.getImpacts('hike-1')).toEqual([]);
  });
});
