// Decides when to upload: after a hike finishes, when the app returns to
// the foreground, when the network comes back, after sign-in, and every
// few minutes while the app is open. Only one sync runs at a time.

import * as Network from 'expo-network';
import { AppState } from 'react-native';

import { getRepository } from '@/storage/database';
import { currentUserId } from '@/supabase/client';
import { supabaseHikeStore } from '@/supabase/hikesApi';

import { HikeUploader, type SyncResult } from './uploader';

export type SyncStatus = {
  running: boolean;
  pending: number;
  lastError: string | null;
  lastSyncedAt: number | null;
  // Bumped whenever local or remote hike lists may have changed.
  version: number;
};

const PERIODIC_MS = 2 * 60_000;

class SyncService {
  private status: SyncStatus = { running: false, pending: 0, lastError: null, lastSyncedAt: null, version: 0 };
  private listeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private rerun: { force: boolean } | null = null;
  private uploader: HikeUploader | null = null;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.status;

  private set(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, ...patch };
    this.listeners.forEach((l) => l());
  }

  // Tell list screens to reload (e.g. a hike was finished or discarded).
  notifyChanged() {
    this.set({ version: this.status.version + 1 });
    void this.refreshPendingCount();
  }

  async refreshPendingCount(): Promise<void> {
    const userId = await currentUserId().catch(() => null);
    if (!userId) return this.set({ pending: 0 });
    const repo = await getRepository();
    this.set({ pending: await repo.countUnsynced(userId) });
  }

  // force: ignore per-hike retry backoff (user tapped retry, network
  // came back, a hike just finished).
  requestSync({ force = false } = {}): Promise<void> {
    if (this.running) {
      this.rerun = { force: force || this.rerun?.force === true };
      return this.running;
    }
    this.running = this.run(force).finally(() => {
      this.running = null;
      const again = this.rerun;
      this.rerun = null;
      if (again) void this.requestSync(again);
    });
    return this.running;
  }

  private async run(force: boolean): Promise<void> {
    const userId = await currentUserId().catch(() => null);
    if (!userId) return;

    const network = await Network.getNetworkStateAsync().catch(() => null);
    if (network && (network.isConnected === false || network.isInternetReachable === false)) {
      await this.refreshPendingCount();
      return;
    }

    this.set({ running: true });
    let result: SyncResult = { synced: [], failed: [] };
    try {
      const repo = await getRepository();
      this.uploader ??= new HikeUploader(repo, supabaseHikeStore, currentUserId);
      result = await this.uploader.syncAll(userId, { ignoreBackoff: force });
      this.set({
        lastError: result.failed[0]?.error ?? null,
        lastSyncedAt: result.synced.length ? Date.now() : this.status.lastSyncedAt,
      });
    } catch (error) {
      this.set({ lastError: error instanceof Error ? error.message : String(error) });
    } finally {
      this.set({
        running: false,
        version: result.synced.length ? this.status.version + 1 : this.status.version,
      });
      await this.refreshPendingCount().catch(() => {});
    }
  }

  // Wire up automatic triggers; returns a cleanup function.
  start(): () => void {
    void this.requestSync();
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void this.requestSync();
    });
    let wasConnected: boolean | undefined;
    const network = Network.addNetworkStateListener((event) => {
      const connected = event.isConnected === true && event.isInternetReachable !== false;
      if (connected && wasConnected === false) void this.requestSync({ force: true });
      wasConnected = connected;
    });
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void this.requestSync();
    }, PERIODIC_MS);

    return () => {
      appState.remove();
      network.remove();
      clearInterval(timer);
    };
  }
}

export const syncService = new SyncService();
