// The app-wide recorder, wired to the real BLE stack, SQLite and sync.

import { randomUUID } from 'expo-crypto';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { AppState } from 'react-native';

import { BleTransport } from '@/ble/bleTransport';
import { MockTransport } from '@/ble/mockTransport';
import { getRepository } from '@/storage/database';
import { syncService } from '@/sync/syncService';

import { Recorder } from './recorder';

const KEEP_AWAKE_TAG = 'softsteps-recording';

const bleTransport = new BleTransport();
export const mockTransport = new MockTransport();

export const recorder = new Recorder({
  getRepository,
  createTransport: (kind) => (kind === 'mock' ? mockTransport : bleTransport),
  randomId: randomUUID,
  now: Date.now,
  isForeground: () => AppState.currentState === 'active',
  // Keeping the screen on is the reliable way to keep recording in the
  // foreground; locked-screen recording is not validated yet (see README).
  keepAwake: (on) => {
    if (on) activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    else deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
  },
  onSessionFinished: () => syncService.requestSync({ force: true }),
});

export type { RecorderSnapshot, RecorderPhase } from './recorder';
