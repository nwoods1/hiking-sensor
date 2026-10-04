
// Helper average
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;

// Helper median
const median = (a) => {
    const s = [...a].sort((x, y) => x - y);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Helper rounding function
const r = (x, d = 2) => (x == null ? null : +x.toFixed(d));


function computeStats(impacts, {
    durationMs,
    stepThreshold,
    highThreshold,
    pauseGapMs = 10000, // a gap longer than this counts as a puase
}){
    const n = impacts.length;

    const base = {
        duration_s: Math.round(durationMs/1000),
        step_threshold: stepThreshold,
        high_impact_threshold: highThreshold,
        step_count:n,
    };

    // No impacts recorded return 
    if(n===0) return base;

    const acc = impacts.map(i => i.accel);
    const ang = impacts.map(i => i.angle);

    // Determine the pause times
    let activeMs = 0;
    const pauses = [];
    for (let i = 1; i<n; i++){
        const gap = impacts[i].t - impacts[i-1].t;

        if (gap > pauseGapMs){
            pauses.push({start_s: Math.round(impacts[i-1].t/1000), 
                length_s: Math.round(gap/1000)});
        }else{
            activeMs += gap;
        }
    }

    // per-minute buckets
    const minutes = Math.max(1, Math.ceil(durationMs / 60000));
    const per_minute = Array.from({ length: minutes }, (_, m) => ({
        min: m, steps: 0, avg_impact: null, max_impact: null,
    }));
    
    const sums = new Array(minutes).fill(0);

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

    // hardest step
    const maxIdx = acc.indexOf(Math.max(...acc));

    // soft / medium / hard
    const mid = (stepThreshold + highThreshold) / 2;
    const impact_buckets = {
        soft: acc.filter(a => a < mid).length,
        medium: acc.filter(a => a >= mid && a < highThreshold).length,
        hard: acc.filter(a => a >= highThreshold).length,
    };

    // fatigue: last third vs first third (needs enough steps to mean anything)
    let fatigue_ratio = null;
    if (n >= 30) {
        const third = Math.floor(n / 3);
        fatigue_ratio = avg(acc.slice(-third)) / avg(acc.slice(0, third));
    }

    return {
        ...base,
        active_time_s: Math.round(activeMs / 1000),
        avg_cadence: activeMs > 0 ? r(n / (activeMs / 60000), 1) : null,
        max_cadence: Math.max(...per_minute.map(p => p.steps)),
        avg_impact: r(avg(acc)),
        median_impact: r(median(acc)),
        max_impact: r(acc[maxIdx]),
        max_impact_at_s: Math.round(impacts[maxIdx].t / 1000),
        high_impact_count: impact_buckets.hard,
        high_impact_pct: r((impact_buckets.hard / n) * 100, 1),
        total_impact_load: r(acc.reduce((x, y) => x + y, 0), 1),
        fatigue_ratio: r(fatigue_ratio),
        avg_angle_at_impact: r(avg(ang), 1),
        min_angle_at_impact: r(Math.min(...ang), 1),
        max_angle_at_impact: r(Math.max(...ang), 1),
        per_minute,
        impact_buckets,
        pauses,
    };
} 