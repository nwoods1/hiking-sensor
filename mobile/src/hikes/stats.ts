// Port of frontend/stats.js computeStats. The output becomes the
// Supabase `hikes` row, so field names, rounding and semantics must match
// the web app exactly.
//
// Input is one entry per *detected foot strike* (not continuous samples):
// step_count is the number of impacts and pauses are gaps between strikes.
//
// Differences from the JS original, none of which change results:
// - max/min use loops instead of Math.max(...array), which can overflow
//   the argument limit on long hikes.

export type Impact = {
  t: number; // ms since the hike started
  accel: number; // impact proxy, g
  angle: number; // knee angle, deg (180 = straight)
};

export type PerMinute = {
  min: number;
  steps: number;
  avg_impact: number | null;
  max_impact: number | null;
};

export type HikeStats = {
  duration_s: number;
  step_threshold: number;
  high_impact_threshold: number;
  step_count: number;
  active_time_s?: number;
  avg_cadence?: number | null;
  max_cadence?: number;
  avg_impact?: number | null;
  median_impact?: number | null;
  max_impact?: number | null;
  max_impact_at_s?: number;
  high_impact_count?: number;
  high_impact_pct?: number | null;
  total_impact_load?: number | null;
  fatigue_ratio?: number | null;
  avg_angle_at_impact?: number | null;
  min_angle_at_impact?: number | null;
  max_angle_at_impact?: number | null;
  per_minute?: PerMinute[];
  impact_buckets?: { soft: number; medium: number; hard: number };
  pauses?: { start_s: number; length_s: number }[];
};

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const avg = (a: number[]) => sum(a) / a.length;

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const r = (x: number | null | undefined, d = 2): number | null => (x == null ? null : +x.toFixed(d));

function maxOf(a: number[]): number {
  let best = -Infinity;
  for (const v of a) if (v > best) best = v;
  return best;
}

function minOf(a: number[]): number {
  let best = Infinity;
  for (const v of a) if (v < best) best = v;
  return best;
}

export function computeStats(
  impacts: Impact[],
  {
    durationMs,
    stepThreshold,
    highThreshold,
    pauseGapMs = 10000, // a gap longer than this counts as a pause
  }: {
    durationMs: number;
    stepThreshold: number;
    highThreshold: number;
    pauseGapMs?: number;
  },
): HikeStats {
  const n = impacts.length;

  const base: HikeStats = {
    duration_s: Math.round(durationMs / 1000),
    step_threshold: stepThreshold,
    high_impact_threshold: highThreshold,
    step_count: n,
  };

  if (n === 0) return base;

  const acc = impacts.map((i) => i.accel);
  const ang = impacts.map((i) => i.angle);

  let activeMs = 0;
  const pauses: { start_s: number; length_s: number }[] = [];
  for (let i = 1; i < n; i++) {
    const gap = impacts[i].t - impacts[i - 1].t;
    if (gap > pauseGapMs) {
      pauses.push({
        start_s: Math.round(impacts[i - 1].t / 1000),
        length_s: Math.round(gap / 1000),
      });
    } else {
      activeMs += gap;
    }
  }

  const minutes = Math.max(1, Math.ceil(durationMs / 60000));
  const per_minute: PerMinute[] = Array.from({ length: minutes }, (_, m) => ({
    min: m,
    steps: 0,
    avg_impact: null,
    max_impact: null,
  }));
  const sums = new Array<number>(minutes).fill(0);

  for (const i of impacts) {
    const m = Math.min(minutes - 1, Math.floor(i.t / 60000));
    per_minute[m].steps++;
    sums[m] += i.accel;
    per_minute[m].max_impact = Math.max(per_minute[m].max_impact ?? 0, i.accel);
  }
  per_minute.forEach((p, m) => {
    if (p.steps) p.avg_impact = r(sums[m] / p.steps);
    if (p.max_impact != null) p.max_impact = r(p.max_impact);
  });

  const maxIdx = acc.indexOf(maxOf(acc));

  const mid = (stepThreshold + highThreshold) / 2;
  const impact_buckets = {
    soft: acc.filter((a) => a < mid).length,
    medium: acc.filter((a) => a >= mid && a < highThreshold).length,
    hard: acc.filter((a) => a >= highThreshold).length,
  };

  // Fatigue: last third vs first third (needs enough steps to mean anything).
  let fatigue_ratio: number | null = null;
  if (n >= 30) {
    const third = Math.floor(n / 3);
    fatigue_ratio = avg(acc.slice(-third)) / avg(acc.slice(0, third));
  }

  return {
    ...base,
    active_time_s: Math.round(activeMs / 1000),
    avg_cadence: activeMs > 0 ? r(n / (activeMs / 60000), 1) : null,
    max_cadence: maxOf(per_minute.map((p) => p.steps)),
    avg_impact: r(avg(acc)),
    median_impact: r(median(acc)),
    max_impact: r(acc[maxIdx]),
    max_impact_at_s: Math.round(impacts[maxIdx].t / 1000),
    high_impact_count: impact_buckets.hard,
    high_impact_pct: r((impact_buckets.hard / n) * 100, 1),
    total_impact_load: r(sum(acc), 1),
    fatigue_ratio: r(fatigue_ratio),
    avg_angle_at_impact: r(avg(ang), 1),
    min_angle_at_impact: r(minOf(ang), 1),
    max_angle_at_impact: r(maxOf(ang), 1),
    per_minute,
    impact_buckets,
    pauses,
  };
}
