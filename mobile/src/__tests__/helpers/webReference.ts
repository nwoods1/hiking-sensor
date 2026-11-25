// Loads the web app's original frontend/script.js and frontend/stats.js
// with stubbed browser APIs, so tests can compare the mobile port against
// the code it replaces. Returns null if the frontend folder isn't there.

import fs from 'fs';
import path from 'path';

const FRONTEND = path.resolve(__dirname, '../../../../frontend');

export function loadWebComputeStats(): ((...args: unknown[]) => unknown) | null {
  const file = path.join(FRONTEND, 'stats.js');
  if (!fs.existsSync(file)) return null;
  const source = fs.readFileSync(file, 'utf8');
  return new Function(`${source}\nreturn computeStats;`)() as (...args: unknown[]) => unknown;
}

export type WebSensor = {
  // Feed one packet at monotonic time nowMs / wall time wallMs.
  handle(bytes: Uint8Array, nowMs: number, wallMs: number): void;
  start(): Promise<void>;
  angles(): { thighAngle: number; shinAngle: number; kneeAngle: number; kneeZeroOffset: number };
  footStrikes(): { timestamp: string; kneeAngle: number; impact: number; swingAmplitude: number | null }[];
  readings(): { kneeAngle: number; acceleration: number; impact: number; impactDetected: boolean }[];
};

export function loadWebSensor(): WebSensor | null {
  const file = path.join(FRONTEND, 'script.js');
  if (!fs.existsSync(file)) return null;

  // Drop the IndexedDB import; the functions are provided as parameters.
  const source = fs.readFileSync(file, 'utf8').replace(/^import[\s\S]*?from\s+"\.\/indexedDB\.js";/m, '');

  const clock = { now: 0, wall: 0 };
  const element = () => ({
    textContent: '',
    scrollTop: 0,
    scrollHeight: 0,
    width: 700,
    height: 250,
    addEventListener() {},
    getContext: () => new Proxy({}, { get: () => () => {} }),
  });
  const elements = new Map<string, ReturnType<typeof element>>();
  const document = {
    getElementById(id: string) {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    },
  };
  const window: Record<string, unknown> = { location: { search: '' } };
  const performance = { now: () => clock.now };
  class FakeDate extends Date {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(clock.wall);
      else super(...(args as [number]));
    }
    static now() {
      return clock.wall;
    }
  }
  const quietConsole = { log() {}, warn() {}, error() {}, table() {} };

  const factory = new Function(
    'document',
    'window',
    'performance',
    'Date',
    'console',
    'openDatabase',
    'createSession',
    'saveReading',
    'endSession',
    `${source}\nreturn { handleSensorData };`,
  );
  const { handleSensorData } = factory(
    document,
    window,
    performance,
    FakeDate,
    quietConsole,
    async () => ({}),
    async () => 1,
    async () => 1,
    async () => ({}),
  ) as { handleSensorData: (event: unknown) => void };

  const activity = window.hikingActivity as {
    start(): Promise<unknown>;
    getAngles(): ReturnType<WebSensor['angles']>;
    getFootStrikes(): ReturnType<WebSensor['footStrikes']>;
    getReadings(): ReturnType<WebSensor['readings']>;
  };

  return {
    handle(bytes, nowMs, wallMs) {
      clock.now = nowMs;
      clock.wall = wallMs;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      handleSensorData({ target: { value: view } });
    },
    async start() {
      await activity.start();
    },
    angles: () => activity.getAngles(),
    footStrikes: () => activity.getFootStrikes(),
    readings: () => activity.getReadings(),
  };
}
