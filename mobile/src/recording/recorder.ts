// Recording session state machine. Lives outside React: screens subscribe
// to snapshots, but recording continues while the user navigates between
// screens. Packets are processed on arrival; the UI is notified at most
// 10 times a second.
//
//   idle -> connecting -> connected -> recording <-> reconnecting
//                                          |              |
//                                          +-> finishing <+
//
// A dropped link while recording is a gap, not the end of the hike: the
// gap is stored, the processor resets its filter timing, and the service
// keeps trying to reconnect until the user finishes the hike.

import { HIGH_IMPACT_THRESHOLD, IMPACT_THRESHOLD, LIVE_CHART_POINTS } from '@/sensor/constants';
import { SensorProcessor } from '@/sensor/processor';
import { decodeBase64Packet } from '@/sensor/protocol';
import type { ConnectedDevice, SensorTransport, TransportHandlers } from '@/ble/transport';
import type { HikeRepository, LocalSessionSummary, SensorSource } from '@/storage/hikeRepository';

import { LiveBuffer, type LiveSeries } from './liveBuffer';

export type RecorderPhase = 'idle' | 'connecting' | 'connected' | 'recording' | 'reconnecting' | 'finishing';

export type LastStrike = { kneeAngle: number; impact: number; at: number };

export type RecorderSnapshot = {
  phase: RecorderPhase;
  device: (ConnectedDevice & { source: SensorSource }) | null;
  error: string | null;
  session: { id: string; name: string | null; startedAt: number; resumed: boolean } | null;
  // A hike from an earlier app run that will continue when Start is pressed.
  pendingResume: { id: string; name: string | null; startedAt: number } | null;
  live: {
    kneeAngle: number | null;
    // The straight-leg pose is still being measured.
    calibrating: boolean;
    acceleration: number | null;
    impact: number | null;
    steps: number;
    lastStrike: LastStrike | null;
    averageImpact: number | null;
    maxImpact: number | null;
  };
  packets: number;
  badPackets: number;
  packetsPerSecond: number;
  lastPacketAt: number | null;
  gapCount: number;
  gapStartedAt: number | null;
  reconnectAttempts: number;
  storageError: string | null;
  chartVersion: number;
};

export type RecorderDeps = {
  getRepository(): Promise<HikeRepository>;
  createTransport(kind: SensorSource): SensorTransport;
  randomId(): string;
  now(): number;
  isForeground(): boolean;
  keepAwake(on: boolean): void;
  onSessionFinished(sessionId: string): void;
};

const EMIT_INTERVAL_MS = 100;
const HEARTBEAT_INTERVAL_MS = 5000;
const CONNECT_TIMEOUT_MS = 15000;
const MAX_RECONNECT_DELAY_MS = 15000;

const emptyLive = (): RecorderSnapshot['live'] => ({
  kneeAngle: null,
  calibrating: false,
  acceleration: null,
  impact: null,
  steps: 0,
  lastStrike: null,
  averageImpact: null,
  maxImpact: null,
});

export class Recorder {
  private snapshot: RecorderSnapshot = {
    phase: 'idle',
    device: null,
    error: null,
    session: null,
    pendingResume: null,
    live: emptyLive(),
    packets: 0,
    badPackets: 0,
    packetsPerSecond: 0,
    lastPacketAt: null,
    gapCount: 0,
    gapStartedAt: null,
    reconnectAttempts: 0,
    storageError: null,
    chartVersion: 0,
  };
  private listeners = new Set<() => void>();
  private emitTimer: ReturnType<typeof setTimeout> | null = null;

  private transport: SensorTransport | null = null;
  private repo: HikeRepository | null = null;
  private processor: SensorProcessor | null = null;
  private readonly chart = new LiveBuffer(LIVE_CHART_POINTS);

  private userId: string | null = null;
  private resumeSource: LocalSessionSummary | null = null;
  private nextSeq = 0;
  private impactSum = 0;
  private lastHeartbeat = 0;
  private reconnectToken = 0;

  // Packet-rate window.
  private rateWindowStart = 0;
  private rateWindowCount = 0;

  // Mutable live values; copied into the snapshot on emit.
  private live = emptyLive();
  private packets = 0;
  private badPackets = 0;
  private lastPacketAt: number | null = null;

  constructor(private readonly deps: RecorderDeps) {}

  // ---------- subscription (useSyncExternalStore) ----------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): RecorderSnapshot => this.snapshot;

  getChart(): LiveSeries {
    return this.chart.snapshot();
  }

  private update(patch: Partial<RecorderSnapshot>, immediate = true) {
    this.snapshot = { ...this.snapshot, ...patch };
    if (immediate) this.emitNow();
    else this.scheduleEmit();
  }

  private scheduleEmit() {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.emitNow();
    }, EMIT_INTERVAL_MS);
  }

  private emitNow() {
    if (this.emitTimer) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }
    this.snapshot = {
      ...this.snapshot,
      live: { ...this.live },
      packets: this.packets,
      badPackets: this.badPackets,
      lastPacketAt: this.lastPacketAt,
      chartVersion: this.snapshot.chartVersion + 1,
    };
    this.listeners.forEach((listener) => listener());
  }

  // ---------- connection ----------

  private handlers: TransportHandlers = {
    onPacket: (value, monoMs, wallMs) => this.handlePacket(value, monoMs, wallMs),
    onDisconnected: (reason) => this.handleLinkLoss(reason),
  };

  async connect(source: SensorSource, deviceId: string): Promise<void> {
    const { phase } = this.snapshot;
    if (phase !== 'idle') {
      // Already connecting/connected: never open a second link.
      return;
    }
    this.transport = this.deps.createTransport(source);
    this.resetCounters();
    this.update({ phase: 'connecting', error: null, device: null });

    try {
      const device = await this.transport.connect(deviceId, this.handlers, {
        timeoutMs: CONNECT_TIMEOUT_MS,
      });
      if (this.snapshot.phase !== 'connecting') return; // cancelled meanwhile
      this.update({ phase: 'connected', device: { ...device, source } });
    } catch (error) {
      if (this.snapshot.phase !== 'connecting') return;
      this.transport = null;
      this.update({ phase: 'idle', error: messageOf(error) });
      throw error;
    }
  }

  // Disconnect before a hike starts (or cancel a connection attempt).
  async disconnect(): Promise<void> {
    const { phase } = this.snapshot;
    if (phase !== 'connecting' && phase !== 'connected') return;
    const transport = this.transport;
    this.transport = null;
    this.update({ phase: 'idle', device: null });
    await transport?.disconnect();
  }

  // ---------- hike lifecycle ----------

  // Continue an unfinished hike from an earlier app run on the next start().
  prepareResume(session: LocalSessionSummary | null): void {
    if (this.snapshot.session) return;
    this.resumeSource = session;
    this.update({
      pendingResume: session ? { id: session.id, name: session.name, startedAt: session.started_at } : null,
    });
  }

  async start({ name, userId }: { name: string | null; userId: string }): Promise<string> {
    if (this.snapshot.phase !== 'connected' || !this.snapshot.device) {
      throw new Error('Connect the sensor before starting the hike.');
    }
    if (this.snapshot.session) return this.snapshot.session.id;

    const repo = (this.repo ??= await this.deps.getRepository());
    const device = this.snapshot.device;
    const now = this.deps.now();
    const resume = this.resumeSource;

    let session: NonNullable<RecorderSnapshot['session']>;
    this.live = emptyLive();
    this.impactSum = 0;
    this.chart.clear();

    if (resume) {
      if (resume.user_id !== userId) throw new Error('This unfinished hike belongs to another account.');
      const stored = await repo.getStoredImpacts(resume.id);
      this.nextSeq = stored.length ? stored[stored.length - 1].seq + 1 : 0;
      for (const s of stored) this.addToSummary(s.accel, s.angle, s.timestamp);
      this.processor = new SensorProcessor({ calibrationOffset: resume.calibration_offset });
      // The app was closed: record the time without data as a gap.
      await repo.openGap(resume.id, resume.last_packet_at ?? resume.started_at, 'app_restart');
      await repo.closeOpenGaps(resume.id, now);
      await repo.setDevice(resume.id, device.id, device.name);
      session = { id: resume.id, name: resume.name, startedAt: resume.started_at, resumed: true };
    } else {
      const id = this.deps.randomId();
      await repo.createSession({
        id,
        userId,
        name,
        startedAt: now,
        stepThreshold: IMPACT_THRESHOLD,
        highThreshold: HIGH_IMPACT_THRESHOLD,
        source: device.source,
        deviceId: device.id,
        deviceName: device.name,
      });
      this.nextSeq = 0;
      this.processor = new SensorProcessor();
      session = { id, name, startedAt: now, resumed: false };
    }

    this.userId = userId;
    this.resumeSource = null;
    this.lastHeartbeat = now;
    this.deps.keepAwake(true);
    this.update({
      phase: 'recording',
      session,
      pendingResume: null,
      gapCount: 0,
      gapStartedAt: null,
      storageError: null,
      error: null,
    });
    return session.id;
  }

  async finish(): Promise<string> {
    const { phase, session } = this.snapshot;
    if (!session || (phase !== 'recording' && phase !== 'reconnecting')) {
      throw new Error('No hike is being recorded.');
    }
    this.reconnectToken++; // stops the reconnect loop
    this.update({ phase: 'finishing' });

    const repo = this.repo!;
    try {
      await repo.finishSession(session.id, this.deps.now());
    } catch (error) {
      // Keep recording state so the user can try again; nothing is lost.
      this.update({ phase, error: `Could not save the hike: ${messageOf(error)}` });
      throw error;
    }

    await this.endSession();
    this.deps.onSessionFinished(session.id);
    return session.id;
  }

  // Throw away the hike being recorded.
  async discard(): Promise<void> {
    const { session } = this.snapshot;
    if (!session) return;
    this.reconnectToken++;
    await this.repo!.discardSession(session.id);
    await this.endSession();
  }

  private async endSession() {
    const transport = this.transport;
    this.transport = null;
    this.processor = null;
    this.userId = null;
    this.deps.keepAwake(false);
    this.chart.clear();
    this.live = emptyLive();
    this.resetCounters();
    this.update({
      phase: 'idle',
      session: null,
      device: null,
      gapStartedAt: null,
      gapCount: 0,
      reconnectAttempts: 0,
    });
    await transport?.disconnect();
  }

  // ---------- packets ----------

  private handlePacket(value: string, monoMs: number, wallMs: number) {
    this.packets++;
    this.lastPacketAt = wallMs;
    this.updateRate(wallMs);

    let packet;
    try {
      packet = decodeBase64Packet(value);
    } catch {
      packet = null;
    }
    if (!packet) {
      this.badPackets++;
      this.scheduleEmit();
      return;
    }

    const { phase, session } = this.snapshot;
    if (phase !== 'recording' || !session || !this.processor || !this.repo) {
      // Connected but not started: just show that data is flowing.
      this.scheduleEmit();
      return;
    }

    const sample = this.processor.process(packet, monoMs, wallMs);
    this.live.kneeAngle = sample.kneeAngle;
    this.live.calibrating = sample.calibrating;
    this.live.acceleration = sample.acceleration;
    this.live.impact = sample.impact;
    this.chart.push(sample.sampleIndex, sample.kneeAngle, sample.impact);

    if (sample.calibratedNow) {
      this.repo.setCalibration(session.id, this.processor.calibrationOffset!).catch(this.onStorageError);
    }

    const strike = sample.footStrike;
    if (strike) {
      this.chart.mark(strike.sampleIndex);
      this.addToSummary(strike.impact, strike.kneeAngle, strike.timestamp);
      this.repo
        .appendImpact(session.id, session.startedAt, {
          seq: this.nextSeq++,
          timestamp: strike.timestamp,
          accel: strike.impact,
          angle: strike.kneeAngle,
          swing: strike.swingAmplitude,
        })
        .catch(this.onStorageError);
    }

    if (wallMs - this.lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
      this.lastHeartbeat = wallMs;
      this.repo.heartbeat(session.id, wallMs).catch(this.onStorageError);
    }

    this.scheduleEmit();
  }

  private addToSummary(impact: number, kneeAngle: number, at: number) {
    this.live.steps++;
    this.impactSum += impact;
    this.live.averageImpact = this.impactSum / this.live.steps;
    this.live.maxImpact = Math.max(this.live.maxImpact ?? 0, impact);
    this.live.lastStrike = { kneeAngle, impact, at };
  }

  private onStorageError = (error: unknown) => {
    this.update({ storageError: `Saving to the phone failed: ${messageOf(error)}` });
  };

  private updateRate(wallMs: number) {
    if (wallMs - this.rateWindowStart >= 1000) {
      const seconds = (wallMs - this.rateWindowStart) / 1000;
      const rate = this.rateWindowStart === 0 ? 0 : this.rateWindowCount / seconds;
      this.rateWindowStart = wallMs;
      this.rateWindowCount = 0;
      this.snapshot = { ...this.snapshot, packetsPerSecond: Math.round(rate) };
    }
    this.rateWindowCount++;
  }

  private resetCounters() {
    this.packets = 0;
    this.badPackets = 0;
    this.lastPacketAt = null;
    this.rateWindowStart = 0;
    this.rateWindowCount = 0;
    this.snapshot = { ...this.snapshot, packetsPerSecond: 0 };
  }

  // ---------- disconnects and reconnection ----------

  private handleLinkLoss(reason: string | null) {
    const { phase, session } = this.snapshot;

    if (phase === 'recording' && session && this.repo) {
      const gapStartedAt = this.lastPacketAt ?? this.deps.now();
      this.repo.openGap(session.id, gapStartedAt, 'disconnect').catch(this.onStorageError);
      this.repo.heartbeat(session.id, gapStartedAt).catch(this.onStorageError);
      this.processor?.resetAfterGap();
      this.update({
        phase: 'reconnecting',
        gapStartedAt,
        gapCount: this.snapshot.gapCount + 1,
        reconnectAttempts: 0,
        error: reason ? `Sensor disconnected (${reason}). Reconnecting…` : 'Sensor disconnected. Reconnecting…',
      });
      void this.reconnectLoop();
      return;
    }

    if (phase === 'reconnecting') {
      // A reconnect attempt connected and immediately dropped: start over.
      // The superseded loop sees the new token and stops.
      void this.reconnectLoop();
      return;
    }

    if (phase === 'connected' || phase === 'connecting') {
      this.transport = null;
      this.update({
        phase: 'idle',
        device: null,
        error: 'The sensor disconnected. Connect again before starting.',
      });
    }
  }

  private async reconnectLoop() {
    const token = ++this.reconnectToken;
    const device = this.snapshot.device;
    const transport = this.transport;
    if (!device || !transport) return;

    for (let attempt = 1; ; attempt++) {
      if (token !== this.reconnectToken || this.snapshot.phase !== 'reconnecting') return;
      this.update({ reconnectAttempts: attempt });
      try {
        // In the background, wait indefinitely: iOS keeps a pending
        // connection and completes it when the sensor is back in range.
        await transport.connect(device.id, this.handlers, {
          timeoutMs: this.deps.isForeground() ? CONNECT_TIMEOUT_MS : 0,
        });
        if (token !== this.reconnectToken || this.snapshot.phase !== 'reconnecting') return;

        // Switch phase before any await, so a disconnect from here on is
        // handled as a new gap rather than lost.
        const session = this.snapshot.session!;
        this.processor?.resetAfterGap();
        this.update({ phase: 'recording', gapStartedAt: null, reconnectAttempts: 0, error: null });
        this.repo!.closeOpenGaps(session.id, this.deps.now()).catch(this.onStorageError);
        return;
      } catch {
        if (token !== this.reconnectToken) return;
        const delay = Math.min(MAX_RECONNECT_DELAY_MS, 1000 * 2 ** Math.min(attempt, 4));
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  // Try now instead of waiting for the next backoff step.
  retryReconnect(): void {
    if (this.snapshot.phase === 'reconnecting') void this.reconnectLoop();
  }

  // ---------- recovery after an app restart ----------

  // Finish a hike left unfinished by an earlier app run, ending it at the
  // last time data was received.
  async finishRecovered(session: LocalSessionSummary): Promise<void> {
    if (this.snapshot.session?.id === session.id) throw new Error('That hike is being recorded now.');
    const repo = (this.repo ??= await this.deps.getRepository());
    const endedAt = Math.max(session.started_at, session.last_packet_at ?? 0, session.last_impact_at ?? 0);
    await repo.finishSession(session.id, endedAt);
    if (this.resumeSource?.id === session.id) this.prepareResume(null);
    this.deps.onSessionFinished(session.id);
  }

  async discardRecovered(session: LocalSessionSummary): Promise<void> {
    if (this.snapshot.session?.id === session.id) throw new Error('That hike is being recorded now.');
    const repo = (this.repo ??= await this.deps.getRepository());
    await repo.discardSession(session.id);
    if (this.resumeSource?.id === session.id) this.prepareResume(null);
  }

  get activeUserId(): string | null {
    return this.userId;
  }

  // For the developer tools on the record screen.
  get currentTransport(): SensorTransport | null {
    return this.transport;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
