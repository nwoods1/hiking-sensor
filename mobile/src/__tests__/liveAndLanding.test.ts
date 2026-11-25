import { classifyLandings } from '@/hikes/landing';
import { LiveBuffer } from '@/recording/liveBuffer';
import { decimate, type StepPoint } from '@/ui/charts';

describe('LiveBuffer', () => {
  it('keeps only the newest samples, in order', () => {
    const buffer = new LiveBuffer(5);
    for (let i = 0; i < 12; i++) buffer.push(i, 100 + i, i / 10);
    const { knee, impact } = buffer.snapshot();
    expect(buffer.size).toBe(5);
    expect(knee).toEqual([107, 108, 109, 110, 111]);
    expect(impact[0]).toBeCloseTo(0.7);
  });

  it('marks a strike peak a few samples back, and ignores ones scrolled out', () => {
    const buffer = new LiveBuffer(5);
    for (let i = 0; i < 8; i++) buffer.push(i, 0, 0);
    buffer.mark(5);
    buffer.mark(1); // already gone
    expect(buffer.snapshot().markers).toEqual([false, false, true, false, false]);
    buffer.push(8, 0, 0);
    expect(buffer.snapshot().markers).toEqual([false, true, false, false, false]);
  });
});

describe('bad landings (hike-charts.js rule)', () => {
  it('flags hard impacts on a nearly straight knee (180 = straight)', () => {
    const result = classifyLandings([
      { t: 0, accel: 2.5, angle: 170 }, // hard, bent 10: bad
      { t: 1, accel: 2.5, angle: 150 }, // hard, bent 30: ok
      { t: 2, accel: 1.0, angle: 178 }, // soft: ok
    ]);
    expect(result.straightIs180).toBe(true);
    expect(result.bad).toEqual([true, false, false]);
    expect(result.angleLimit).toBe(165);
  });

  it('understands older hikes stored as 0 = straight', () => {
    const result = classifyLandings([
      { t: 0, accel: 2.1, angle: 5 },
      { t: 1, accel: 2.1, angle: 40 },
      { t: 2, accel: 2.1, angle: 8 },
    ]);
    expect(result.straightIs180).toBe(false);
    expect(result.bad).toEqual([true, false, true]);
  });
});

describe('chart decimation', () => {
  it('keeps extremes and every bad landing', () => {
    const points: StepPoint[] = Array.from({ length: 10_000 }, (_, i) => ({
      step: i + 1,
      value: Math.sin(i / 50),
      bad: i % 997 === 0,
    }));
    const out = decimate(points, 100);
    expect(out.length).toBeLessThan(400);
    expect(out.filter((p) => p.bad)).toHaveLength(points.filter((p) => p.bad).length);
    expect(Math.max(...out.map((p) => p.value))).toBeCloseTo(Math.max(...points.map((p) => p.value)));
  });
});
