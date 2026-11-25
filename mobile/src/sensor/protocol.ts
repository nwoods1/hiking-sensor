import { base64ToBytes } from './base64';
import { ACCEL_SCALE, GYRO_SCALE, PACKET_BYTES } from './constants';

export type RawImu = {
  ax: number;
  ay: number;
  az: number;
  gx: number;
  gy: number;
  gz: number;
};

// Accelerations in g, angular rates in deg/s.
export type Imu = RawImu;

export type RawPacket = { thigh: RawImu; shin: RawImu };

function readImu(view: DataView, offset: number): RawImu {
  return {
    ax: view.getInt16(offset, true),
    ay: view.getInt16(offset + 2, true),
    az: view.getInt16(offset + 4, true),
    gx: view.getInt16(offset + 6, true),
    gy: view.getInt16(offset + 8, true),
    gz: view.getInt16(offset + 10, true),
  };
}

// Decode the firmware's 24-byte packet (frontend decodeSensorData).
// Returns null for any other length, like the web app.
//
// The DataView is built from the array's own byteOffset/byteLength: a
// Uint8Array can be a window onto a larger ArrayBuffer, and reading
// `bytes.buffer` from offset 0 would decode the wrong bytes.
export function decodePacket(bytes: Uint8Array): RawPacket | null {
  if (bytes.byteLength !== PACKET_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { thigh: readImu(view, 0), shin: readImu(view, 12) };
}

export function decodeBase64Packet(value: string): RawPacket | null {
  return decodePacket(base64ToBytes(value));
}

// frontend convertSensorData
export function convertImu(raw: RawImu): Imu {
  return {
    ax: raw.ax / ACCEL_SCALE,
    ay: raw.ay / ACCEL_SCALE,
    az: raw.az / ACCEL_SCALE,
    gx: raw.gx / GYRO_SCALE,
    gy: raw.gy / GYRO_SCALE,
    gz: raw.gz / GYRO_SCALE,
  };
}

// Inverse of decodePacket, used by the simulated sensor and tests.
export function encodePacket(packet: RawPacket): Uint8Array {
  const bytes = new Uint8Array(PACKET_BYTES);
  const view = new DataView(bytes.buffer);
  const write = (offset: number, imu: RawImu) => {
    view.setInt16(offset, imu.ax, true);
    view.setInt16(offset + 2, imu.ay, true);
    view.setInt16(offset + 4, imu.az, true);
    view.setInt16(offset + 6, imu.gx, true);
    view.setInt16(offset + 8, imu.gy, true);
    view.setInt16(offset + 10, imu.gz, true);
  };
  write(0, packet.thigh);
  write(12, packet.shin);
  return bytes;
}
