import { CALIBRATION_SAMPLES, CALIBRATION_SETTLE_SAMPLES, IMPACT_COOLDOWN, IMPACT_WINDOW } from '@/sensor/constants';
import { mockPacketAt } from '@/sensor/mockSignal';
import { SensorProcessor, normalizeAngle, type FootStrike } from '@/sensor/processor';
import { decodePacket, encodePacket, type RawImu } from '@/sensor/protocol';

import { loadWebSensor } from './helpers/webReference';

const WALL_START = Date.UTC(2026, 9, 1, 8, 0, 0);

// Packets for a pose: segment pitch in degrees, gravity magnitude on the shin.
function pose(thighDeg: number, shinDeg: number, shinG = 1): Uint8Array {
  const imu = (deg: number, g: number): RawImu => {
    const rad = (deg * Math.PI) / 180;
    return {
      ax: 0,
      ay: Math.round(Math.sin(rad) * g * 8192),
      az: Math.round(Math.cos(rad) * g * 8192),
      gx: 0,
      gy: 0,
      gz: 0,
    };
  };
  return encodePacket({ thigh: imu(thighDeg, 1), shin: imu(shinDeg, shinG) });
}

function run(processor: SensorProcessor, packets: Uint8Array[], stepMs = 20, startMs = 1000) {
  const strikes: FootStrike[] = [];
  const samples = packets.map((bytes, i) => {
    const now = startMs + i * stepMs;
    const sample = processor.process(decodePacket(bytes)!, now, WALL_START + now);
    if (sample.footStrike) strikes.push(sample.footStrike);
    return sample;
  });
  return { samples, strikes };
}

// Packets until the straight-leg calibration completes.
const CALIBRATION_PACKETS = CALIBRATION_SETTLE_SAMPLES + CALIBRATION_SAMPLES;

function repeat(packet: Uint8Array, count: number): Uint8Array[] {
  return Array.from({ length: count }, () => packet);
}

describe('SensorProcessor', () => {
  it('normalizes angles into -180..180', () => {
    expect(normalizeAngle(190)).toBe(-170);
    expect(normalizeAngle(-190)).toBe(170);
    expect(normalizeAngle(360)).toBe(0);
    expect(normalizeAngle(45)).toBe(45);
  });

  it('calibrates the straight leg (180 deg) from the first seconds of a hike', () => {
    const p = new SensorProcessor();
    const { samples } = run(p, repeat(pose(10, -20), CALIBRATION_PACKETS + 2));
    const done = CALIBRATION_PACKETS - 1;

    expect(samples[0].calibrating).toBe(true);
    expect(samples[0].kneeAngle).toBe(180);
    expect(p.calibrationOffset).toBeCloseTo(30, 2);
    expect(samples.filter((s) => s.calibratedNow)).toHaveLength(1);
    expect(samples[done].calibratedNow).toBe(true);
    expect(samples[done].calibrating).toBe(false);
    expect(samples[done - 1].calibrating).toBe(true);
    expect(samples.at(-1)!.kneeAngle).toBeCloseTo(180, 6);
  });

  it('is not thrown off by a bent leg in the first packet', () => {
    const p = new SensorProcessor();
    // The old single-packet calibration would have used 60 deg here. These
    // packets carry no gyro rotation, so only the accelerometer pulls the
    // filter back to 30 and a little of the jump is left at the end.
    run(p, [pose(0, -60), ...repeat(pose(10, -20), CALIBRATION_PACKETS - 1)]);
    expect(p.calibrationOffset).toBeGreaterThan(29.9);
    expect(p.calibrationOffset).toBeLessThan(35);
  });

  it('averages a straight-leg pose that sits across +/-180 deg', () => {
    const p = new SensorProcessor();
    // thigh - shin alternates between 179 and -179 (= 181).
    const packets = Array.from({ length: CALIBRATION_PACKETS }, (_, i) => (i % 2 ? pose(90, -89) : pose(90, -91)));
    run(p, packets);
    expect(Math.abs(p.calibrationOffset!)).toBeGreaterThan(178);
  });

  it('reports knee flexion relative to the calibrated pose', () => {
    const p = new SensorProcessor();
    const packets = [...repeat(pose(0, 0), CALIBRATION_PACKETS), ...repeat(pose(0, -40), 400)];
    const { samples } = run(p, packets);
    // Accelerometer-only correction converges toward 180 - 40.
    expect(samples.at(-1)!.kneeAngle).toBeCloseTo(140, 0);
  });

  it('detects one strike per spike, at the window peak, with the peak timestamp', () => {
    const p = new SensorProcessor();
    const packets = [
      ...Array.from({ length: 10 }, () => pose(0, 0)),
      pose(0, 0, 2.0), // crosses threshold (impact 1.0)
      pose(0, 0, 2.6), // peak (impact 1.6)
      pose(0, 0, 2.2),
      ...Array.from({ length: 20 }, () => pose(0, 0)),
    ];
    const { strikes } = run(p, packets);
    expect(strikes).toHaveLength(1);
    expect(strikes[0].impact).toBeCloseTo(1.6, 2);
    expect(strikes[0].sampleIndex).toBe(11);
    expect(strikes[0].timestamp).toBe(WALL_START + 1000 + 11 * 20);
  });

  it('finalizes a strike only after the 120 ms window', () => {
    const p = new SensorProcessor();
    const packets = [pose(0, 0), pose(0, 0, 2.5), ...Array.from({ length: 10 }, () => pose(0, 0))];
    const { samples } = run(p, packets);
    const finalIndex = samples.findIndex((s) => s.footStrike);
    // threshold crossed at sample 1 (t=20 ms); window closes at >= 140 ms.
    expect(finalIndex * 20 - 20).toBeGreaterThanOrEqual(IMPACT_WINDOW);
    expect((finalIndex - 1) * 20 - 20).toBeLessThan(IMPACT_WINDOW);
  });

  it('applies the rearm threshold and the cooldown', () => {
    const p = new SensorProcessor();
    // Two spikes 200 ms apart (within the 300 ms cooldown) then one 600 ms later.
    const packets: Uint8Array[] = [];
    for (let i = 0; i < 60; i++) {
      const spike = i === 5 || i === 15 || i === 45;
      packets.push(pose(0, 0, spike ? 2.5 : 1));
    }
    const { strikes } = run(p, packets);
    expect(strikes).toHaveLength(2);
    expect(strikes[1].timestamp - strikes[0].timestamp).toBeGreaterThanOrEqual(IMPACT_COOLDOWN);
  });

  it('does not rearm while the signal stays above the reset threshold', () => {
    const p = new SensorProcessor();
    const packets = [
      pose(0, 0),
      pose(0, 0, 2.5),
      ...Array.from({ length: 40 }, () => pose(0, 0, 1.5)), // impact 0.5 > reset 0.35
      pose(0, 0, 2.5),
    ];
    expect(run(p, packets).strikes).toHaveLength(1);
  });

  it('resetAfterGap keeps calibration, drops a pending strike and re-seeds the filter', () => {
    const p = new SensorProcessor();
    run(p, [...repeat(pose(5, -25), CALIBRATION_PACKETS), pose(0, 0, 2.5)]);
    expect(p.isTrackingImpact).toBe(true);
    const offset = p.calibrationOffset;
    expect(offset).toBeCloseTo(30, 2);

    p.resetAfterGap();
    expect(p.isTrackingImpact).toBe(false);
    expect(p.calibrationOffset).toBe(offset);

    // After the gap the angle comes straight from the accelerometer.
    const sample = p.process(decodePacket(pose(5, -55))!, 999_999, WALL_START);
    expect(sample.calibratedNow).toBe(false);
    expect(sample.kneeAngle).toBeCloseTo(150, 1);
  });

  it('restarts a calibration that a gap interrupts', () => {
    const p = new SensorProcessor();
    run(p, repeat(pose(0, -60), CALIBRATION_PACKETS - 1));
    expect(p.calibrationOffset).toBeNull();

    p.resetAfterGap();
    const { samples } = run(p, repeat(pose(10, -20), CALIBRATION_PACKETS), 20, 100_000);
    expect(samples.findIndex((s) => s.calibratedNow)).toBe(CALIBRATION_PACKETS - 1);
    expect(p.calibrationOffset).toBeCloseTo(30, 2);
  });

  it('restores a saved calibration offset', () => {
    const p = new SensorProcessor({ calibrationOffset: 30 });
    const sample = p.process(decodePacket(pose(10, -20))!, 0, WALL_START);
    expect(sample.calibratedNow).toBe(false);
    expect(sample.kneeAngle).toBeCloseTo(180, 1);
  });

  it('counts about one strike per simulated step', () => {
    const p = new SensorProcessor();
    const packets = Array.from({ length: 50 * 10 }, (_, i) => mockPacketAt(i * 0.02));
    const { strikes } = run(p, packets);
    expect(strikes.length).toBeGreaterThanOrEqual(9);
    expect(strikes.length).toBeLessThanOrEqual(10);
  });
});

// The strongest check: same packets and clocks through the original web
// code and the port must give the same angles, readings and strikes.
const web = loadWebSensor();
(web ? describe : describe.skip)('parity with frontend/script.js', () => {
  it('matches knee angle, impact and foot strikes sample by sample', async () => {
    const reference = loadWebSensor()!;
    await reference.start();
    const port = new SensorProcessor();

    // Simulated walk plus timing jitter and a long pause (dt clamp path).
    const strikes: FootStrike[] = [];
    let now = 5000;
    for (let i = 0; i < 1500; i++) {
      now += i === 700 ? 450 : 18 + ((i * 7) % 5);
      const bytes = mockPacketAt(now / 1000);
      reference.handle(bytes, now, WALL_START + now);
      const sample = port.process(decodePacket(bytes)!, now, WALL_START + now);
      if (sample.footStrike) strikes.push(sample.footStrike);

      const ref = reference.readings().at(-1)!;
      expect(sample.kneeAngle).toBeCloseTo(ref.kneeAngle, 9);
      expect(sample.acceleration).toBeCloseTo(ref.acceleration, 9);
      expect(sample.impact).toBeCloseTo(ref.impact, 9);
      expect(Boolean(sample.footStrike)).toBe(ref.impactDetected);
    }

    const refStrikes = reference.footStrikes();
    expect(strikes.length).toBe(refStrikes.length);
    expect(strikes.length).toBeGreaterThan(20);
    strikes.forEach((s, i) => {
      expect(s.impact).toBeCloseTo(refStrikes[i].impact, 9);
      expect(s.kneeAngle).toBeCloseTo(refStrikes[i].kneeAngle, 9);
      expect(new Date(s.timestamp).toISOString()).toBe(refStrikes[i].timestamp);
      if (refStrikes[i].swingAmplitude == null) expect(s.swingAmplitude).toBeNull();
      else expect(s.swingAmplitude).toBeCloseTo(refStrikes[i].swingAmplitude!, 9);
    });
  });
});
