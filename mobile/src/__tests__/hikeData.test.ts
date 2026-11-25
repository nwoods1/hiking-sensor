import zlib from 'zlib';

import { decodeCompactFile, encodeCompactFile, toCompactFile } from '@/hikes/compactFile';
import { computeStats, type Impact } from '@/hikes/stats';

import { loadWebComputeStats } from './helpers/webReference';

function syntheticHike(n: number, seed = 1): Impact[] {
  let x = seed;
  const rand = () => ((x = (x * 16807) % 2147483647) - 1) / 2147483646;
  const impacts: Impact[] = [];
  let t = 400;
  for (let i = 0; i < n; i++) {
    t += i === Math.floor(n / 2) ? 45_000 : 500 + rand() * 700; // one long pause
    impacts.push({ t, accel: 0.8 + rand() * 2.2, angle: 150 + rand() * 30 });
  }
  return impacts;
}

describe('computeStats', () => {
  const options = { durationMs: 0, stepThreshold: 0.8, highThreshold: 2.0 };

  it('returns only the base fields for a hike with no steps', () => {
    expect(computeStats([], { ...options, durationMs: 61_000 })).toEqual({
      duration_s: 61,
      step_threshold: 0.8,
      high_impact_threshold: 2.0,
      step_count: 0,
    });
  });

  it('treats each impact as one step and long gaps as pauses', () => {
    const impacts = syntheticHike(40);
    const stats = computeStats(impacts, { ...options, durationMs: impacts.at(-1)!.t + 1000 });
    expect(stats.step_count).toBe(40);
    expect(stats.pauses).toHaveLength(1);
    expect(stats.pauses![0].length_s).toBeGreaterThanOrEqual(45);
    expect(stats.fatigue_ratio).not.toBeNull();
    const buckets = stats.impact_buckets!;
    expect(buckets.soft + buckets.medium + buckets.hard).toBe(40);
  });

  const webComputeStats = loadWebComputeStats();
  (webComputeStats ? it : it.skip)('matches frontend/stats.js exactly', () => {
    for (const n of [1, 2, 29, 30, 31, 250, 5000]) {
      const impacts = syntheticHike(n, n + 3);
      const opts = { ...options, durationMs: impacts.at(-1)!.t + 2500 };
      expect(computeStats(impacts, opts)).toEqual(webComputeStats!(impacts, opts));
    }
  });
});

describe('compact hike file', () => {
  const impacts: Impact[] = [
    { t: 1234.4, accel: 1.23456, angle: 172.345 },
    { t: 2000.6, accel: 2.005, angle: 160.06 },
  ];

  it('uses the versioned parallel-array format with web rounding', () => {
    expect(toCompactFile(impacts)).toEqual({
      v: 1,
      t: [1234, 2001],
      accel: [+(1.23456).toFixed(2), +(2.005).toFixed(2)],
      angle: [+(172.345).toFixed(1), +(160.06).toFixed(1)],
    });
  });

  it('produces standard gzip that Node (and browsers) can read', () => {
    const bytes = encodeCompactFile(impacts);
    expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
    const json = JSON.parse(zlib.gunzipSync(bytes).toString('utf8'));
    expect(json).toEqual(toCompactFile(impacts));
  });

  it('reads files written by the web app (CompressionStream gzip)', () => {
    const webFile = zlib.gzipSync(JSON.stringify({ v: 1, t: [10, 20], accel: [1.1, 2.2], angle: [170.1, 165] }));
    expect(decodeCompactFile(new Uint8Array(webFile))).toEqual([
      { t: 10, accel: 1.1, angle: 170.1 },
      { t: 20, accel: 2.2, angle: 165 },
    ]);
  });

  it('accepts an already-decompressed body and rejects unknown versions', () => {
    const plain = new Uint8Array(Buffer.from(JSON.stringify({ v: 1, t: [], accel: [], angle: [] })));
    expect(decodeCompactFile(plain)).toEqual([]);
    const v2 = new Uint8Array(zlib.gzipSync(JSON.stringify({ v: 2, t: [], accel: [], angle: [] })));
    expect(() => decodeCompactFile(v2)).toThrow(/version/);
  });

  it('round-trips a long hike', () => {
    const long = syntheticHike(20_000);
    const decoded = decodeCompactFile(encodeCompactFile(long));
    expect(decoded).toHaveLength(20_000);
    expect(decoded[123].t).toBe(Math.round(long[123].t));
  });
});
