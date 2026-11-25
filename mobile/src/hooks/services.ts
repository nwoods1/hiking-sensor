import { useEffect, useState, useSyncExternalStore } from 'react';

import { recorder } from '@/recording';
import type { LiveSeries } from '@/recording/liveBuffer';
import { syncService } from '@/sync/syncService';

export function useRecorder() {
  return useSyncExternalStore(recorder.subscribe, recorder.getSnapshot);
}

export function useSyncStatus() {
  return useSyncExternalStore(syncService.subscribe, syncService.getSnapshot);
}

// Live chart data, refreshed at most every `intervalMs` regardless of how
// fast packets arrive.
export function useLiveChart(active: boolean, intervalMs = 200): LiveSeries {
  const [series, setSeries] = useState<LiveSeries>(() => recorder.getChart());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setSeries(recorder.getChart()), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);
  return series;
}

// Re-renders every `intervalMs` while enabled (elapsed-time displays).
export function useNow(enabled: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [enabled, intervalMs]);
  return now;
}
