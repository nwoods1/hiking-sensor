// Packet generator for the simulated sensor, ported from the web app's
// createMockDevice (frontend/script.js, ?mockBluetooth=1): a leg walking
// at one step per second, with a shin acceleration spike at the start of
// each step.

import { ACCEL_SCALE, GYRO_SCALE, RAD_TO_DEG } from './constants';
import { encodePacket, type RawImu } from './protocol';

const toRaw = (value: number, scale: number) => {
  // int16 range; the web mock relied on DataView wrapping instead.
  const raw = Math.round(value * scale);
  return Math.max(-32768, Math.min(32767, raw));
};

function sensor(deg: number, rate: number, gravity: number): RawImu {
  const rad = deg / RAD_TO_DEG;
  return {
    ax: 0,
    ay: toRaw(Math.sin(rad) * gravity, ACCEL_SCALE),
    az: toRaw(Math.cos(rad) * gravity, ACCEL_SCALE),
    gx: toRaw(rate, GYRO_SCALE),
    gy: 0,
    gz: 0,
  };
}

// t: seconds since the simulation started.
export function mockPacketAt(t: number): Uint8Array {
  const phase = 2 * Math.PI * t;
  const thighDeg = 15 * Math.sin(phase);
  const thighRate = 15 * 2 * Math.PI * Math.cos(phase);
  const shinDeg = thighDeg - 30 - 15 * Math.sin(phase + 1);
  const shinRate = thighRate - 15 * 2 * Math.PI * Math.cos(phase + 1);
  const strike = t % 1 < 0.05 ? 2.5 : 1;

  return encodePacket({
    thigh: sensor(thighDeg, thighRate, 1),
    shin: sensor(shinDeg, shinRate, strike),
  });
}
