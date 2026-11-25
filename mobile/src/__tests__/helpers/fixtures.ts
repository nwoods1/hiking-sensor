import type { NewSession } from '@/storage/hikeRepository';

export const START = Date.UTC(2026, 9, 1, 8, 0, 0);

export function newSession(overrides: Partial<NewSession> = {}): NewSession {
  return {
    id: 'hike-1',
    userId: 'user-a',
    name: 'Pine Ridge',
    startedAt: START,
    stepThreshold: 0.8,
    highThreshold: 2.0,
    source: 'ble',
    deviceId: 'dev',
    deviceName: 'Hiking Sensor',
    ...overrides,
  };
}
