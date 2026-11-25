// Loads a hike for the detail screen. A copy on this phone is preferred
// (works offline and before upload); otherwise the Supabase row and data
// file are fetched.

import { getRepository } from '@/storage/database';
import type { Gap, LocalSessionSummary } from '@/storage/hikeRepository';
import { downloadHikeImpacts, getHike } from '@/supabase/hikesApi';

import { computeStats, type HikeStats, type Impact } from './stats';

export type HikeDetail = {
  id: string;
  name: string | null;
  startedAt: string;
  stats: HikeStats;
  // null when the step file couldn't be loaded (impactsError says why).
  impacts: Impact[] | null;
  impactsError: string | null;
  local: LocalSessionSummary | null;
  gaps: Gap[];
};

export async function loadHikeDetail(id: string, userId: string): Promise<HikeDetail | null> {
  const repo = await getRepository();
  const local = await repo.getSession(id, userId);

  if (local && local.status === 'finished' && local.ended_at != null) {
    const impacts = await repo.getImpacts(id);
    return {
      id,
      name: local.name,
      startedAt: new Date(local.started_at).toISOString(),
      stats: computeStats(impacts, {
        durationMs: local.ended_at - local.started_at,
        stepThreshold: local.step_threshold,
        highThreshold: local.high_threshold,
      }),
      impacts,
      impactsError: null,
      local,
      gaps: await repo.getGaps(id),
    };
  }

  const hike = await getHike(id);
  if (!hike) return null; // wrong id, or RLS hides another user's hike

  let impacts: Impact[] | null = null;
  let impactsError: string | null = null;
  try {
    impacts = await downloadHikeImpacts(hike.data_path);
  } catch (error) {
    impactsError = error instanceof Error ? error.message : String(error);
  }

  return {
    id,
    name: hike.name,
    startedAt: hike.started_at,
    stats: hike,
    impacts,
    impactsError,
    local: null,
    gaps: [],
  };
}
