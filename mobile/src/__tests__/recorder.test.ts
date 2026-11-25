import type { ConnectOptions, SensorTransport, TransportHandlers } from '@/ble/transport';
import { Recorder, type RecorderDeps } from '@/recording/recorder';
import { bytesToBase64 } from '@/sensor/base64';
import { mockPacketAt } from '@/sensor/mockSignal';
import { HikeRepository } from '@/storage/hikeRepository';
import { migrate } from '@/storage/schema';

import { newSession, START } from './helpers/fixtures';
import { createTestDatabase } from './helpers/nodeSqlite';

class FakeTransport implements SensorTransport {
  readonly kind = 'ble' as const;
  handlers: TransportHandlers | null = null;
  connectCalls = 0;
  available = true;
  lastOptions: ConnectOptions | null = null;

  async connect(id: string, handlers: TransportHandlers, options: ConnectOptions) {
    this.connectCalls++;
    this.lastOptions = options;
    await Promise.resolve();
    if (!this.available) throw new Error('not in range');
    this.handlers = handlers;
    return { id, name: 'Hiking Sensor' };
  }
  async disconnect() {
    this.handlers = null;
  }
  drop() {
    const h = this.handlers;
    this.handlers = null;
    h?.onDisconnected('link lost');
  }
}

async function setup() {
  jest.useFakeTimers();
  const db = createTestDatabase();
  await migrate(db);
  const repo = new HikeRepository(db);
  const transport = new FakeTransport();
  const clock = { wall: START };
  const finished: string[] = [];
  const awake: boolean[] = [];
  const deps: RecorderDeps = {
    getRepository: async () => repo,
    createTransport: () => transport,
    randomId: () => 'hike-new',
    now: () => clock.wall,
    isForeground: () => true,
    keepAwake: (on) => awake.push(on),
    onSessionFinished: (id) => finished.push(id),
  };
  const recorder = new Recorder(deps);

  // Feed `seconds` of simulated walking at 50 Hz.
  let t = 0;
  const walk = (seconds: number) => {
    for (let i = 0; i < seconds * 50; i++) {
      t += 0.02;
      clock.wall = START + Math.round(t * 1000);
      transport.handlers?.onPacket(bytesToBase64(mockPacketAt(t)), t * 1000, clock.wall);
    }
  };
  return { recorder, repo, transport, clock, finished, awake, walk };
}

afterEach(() => {
  jest.useRealTimers();
});

describe('Recorder', () => {
  it('records detected strikes to SQLite as they happen', async () => {
    const { recorder, repo, walk, awake } = await setup();
    await recorder.connect('ble', 'esp32');
    expect(recorder.getSnapshot().phase).toBe('connected');

    walk(1); // data before Start is shown as packets but not recorded
    expect(recorder.getSnapshot().session).toBeNull();

    await recorder.start({ name: 'Morning', userId: 'user-a' });
    walk(10);
    await repo.flush();

    const impacts = await repo.getStoredImpacts('hike-new');
    expect(impacts.length).toBeGreaterThanOrEqual(9);
    expect(impacts.map((i) => i.seq)).toEqual(impacts.map((_, i) => i));
    // Timestamps are the peak packet's wall time, after the start.
    expect(impacts[0].timestamp).toBeGreaterThan(START);
    const session = await repo.getSession('hike-new', 'user-a');
    expect(session?.status).toBe('recording');
    expect(session?.calibration_offset).not.toBeNull();
    expect(awake).toEqual([true]);

    jest.advanceTimersByTime(200);
    expect(recorder.getSnapshot().live.steps).toBe(impacts.length);
    expect(recorder.getChart().knee.length).toBe(250);
  });

  it('ignores a second connect while one is in progress', async () => {
    const { recorder, transport } = await setup();
    await Promise.all([recorder.connect('ble', 'esp32'), recorder.connect('ble', 'esp32')]);
    expect(transport.connectCalls).toBe(1);
  });

  it('treats a disconnect as a gap, reconnects, and keeps the same hike', async () => {
    const { recorder, repo, transport, clock, walk, finished } = await setup();
    await recorder.connect('ble', 'esp32');
    await recorder.start({ name: null, userId: 'user-a' });
    walk(5);

    transport.available = false;
    transport.drop();
    expect(recorder.getSnapshot().phase).toBe('reconnecting');
    expect(recorder.getSnapshot().gapCount).toBe(1);

    // Still out of range for the first attempts.
    await jest.advanceTimersByTimeAsync(5000);
    expect(recorder.getSnapshot().phase).toBe('reconnecting');
    await repo.flush();
    expect((await repo.getSession('hike-new', 'user-a'))?.status).toBe('recording');

    transport.available = true;
    clock.wall += 20_000;
    await jest.advanceTimersByTimeAsync(20_000);
    expect(recorder.getSnapshot().phase).toBe('recording');

    walk(5);
    const id = await recorder.finish();
    expect(id).toBe('hike-new');
    expect(finished).toEqual(['hike-new']);
    expect(recorder.getSnapshot().phase).toBe('idle');

    const gaps = await repo.getGaps('hike-new');
    expect(gaps).toHaveLength(1);
    expect(gaps[0].reason).toBe('disconnect');
    expect(gaps[0].ended_at).not.toBeNull();
    expect(gaps[0].ended_at! - gaps[0].started_at).toBeGreaterThanOrEqual(20_000);
    const session = await repo.getSession('hike-new', 'user-a');
    expect(session?.status).toBe('finished');
    expect(session?.step_count).toBeGreaterThan(5);
  });

  it('a disconnect before Start returns to idle without a session', async () => {
    const { recorder, transport } = await setup();
    await recorder.connect('ble', 'esp32');
    transport.drop();
    expect(recorder.getSnapshot().phase).toBe('idle');
    expect(recorder.getSnapshot().error).toMatch(/disconnected/);
  });

  it('resumes an unfinished hike after an app restart', async () => {
    const { recorder, repo, walk } = await setup();
    await repo.createSession(newSession({ id: 'old', startedAt: START - 600_000 }));
    await repo.setCalibration('old', 20);
    await repo.heartbeat('old', START - 300_000);
    for (let i = 0; i < 3; i++) {
      await repo.appendImpact('old', START - 600_000, {
        seq: i,
        timestamp: START - 500_000 + i * 1000,
        accel: 1,
        angle: 170,
        swing: null,
      });
    }

    const [unfinished] = await repo.listRecording('user-a');
    recorder.prepareResume(unfinished);
    await recorder.connect('ble', 'esp32');
    const id = await recorder.start({ name: 'ignored', userId: 'user-a' });
    expect(id).toBe('old');
    expect(recorder.getSnapshot().session?.resumed).toBe(true);
    expect(recorder.getSnapshot().live.steps).toBe(3);

    walk(5);
    await recorder.finish();
    const impacts = await repo.getStoredImpacts('old');
    expect(impacts.slice(0, 4).map((i) => i.seq)).toEqual([0, 1, 2, 3]);
    const gaps = await repo.getGaps('old');
    expect(gaps[0]).toMatchObject({ reason: 'app_restart', started_at: START - 300_000, ended_at: START });
  });

  it('refuses to resume another account’s hike', async () => {
    const { recorder, repo } = await setup();
    await repo.createSession(newSession({ id: 'theirs', userId: 'user-b' }));
    const [theirs] = await repo.listRecording('user-b');
    recorder.prepareResume(theirs);
    await recorder.connect('ble', 'esp32');
    await expect(recorder.start({ name: null, userId: 'user-a' })).rejects.toThrow(/another account/);
  });

  it('finishes a recovered hike at the last received data', async () => {
    const { recorder, repo, finished } = await setup();
    await repo.createSession(newSession({ id: 'old' }));
    await repo.heartbeat('old', START + 42_000);
    const [unfinished] = await repo.listRecording('user-a');
    await recorder.finishRecovered(unfinished);
    expect((await repo.getSession('old', 'user-a'))?.ended_at).toBe(START + 42_000);
    expect(finished).toEqual(['old']);
  });
});

describe('Recorder reconnect races', () => {
  it('opens a new gap if the link drops right after reconnecting', async () => {
    const { recorder, repo, transport, walk, clock } = await setup();
    await recorder.connect('ble', 'esp32');
    await recorder.start({ name: null, userId: 'user-a' });
    walk(2);

    transport.drop(); // gap 1; the loop reconnects on its first attempt
    await jest.advanceTimersByTimeAsync(0);
    expect(recorder.getSnapshot().phase).toBe('recording');

    clock.wall += 5000;
    transport.available = false;
    transport.drop(); // gap 2
    expect(recorder.getSnapshot().phase).toBe('reconnecting');
    transport.available = true;
    await jest.advanceTimersByTimeAsync(5000);
    expect(recorder.getSnapshot().phase).toBe('recording');

    await recorder.finish();
    const gaps = await repo.getGaps('hike-new');
    expect(gaps).toHaveLength(2);
    expect(gaps.every((g) => g.ended_at != null)).toBe(true);
  });
});
