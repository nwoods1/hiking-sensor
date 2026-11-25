import { base64ToBytes, bytesToBase64 } from '@/sensor/base64';
import { ACCEL_SCALE, GYRO_SCALE } from '@/sensor/constants';
import { mockPacketAt } from '@/sensor/mockSignal';
import { convertImu, decodeBase64Packet, decodePacket, encodePacket } from '@/sensor/protocol';

// Byte layout written by esp32/hiking_sensor.ino transmitSensorData():
// packet[i*2] = value & 0xFF; packet[i*2+1] = (value >> 8) & 0xFF.
function firmwarePacket(values: number[]): Uint8Array {
  const packet = new Uint8Array(24);
  values.forEach((v, i) => {
    const u = v & 0xffff;
    packet[i * 2] = u & 0xff;
    packet[i * 2 + 1] = (u >> 8) & 0xff;
  });
  return packet;
}

const VALUES = [1, -2, 8192, -32768, 32767, 131, -8192, 0, 4096, -131, 300, -1];

describe('packet decoding', () => {
  it('decodes the firmware layout as 12 little-endian int16 values', () => {
    const decoded = decodePacket(firmwarePacket(VALUES));
    expect(decoded).toEqual({
      thigh: { ax: 1, ay: -2, az: 8192, gx: -32768, gy: 32767, gz: 131 },
      shin: { ax: -8192, ay: 0, az: 4096, gx: -131, gy: 300, gz: -1 },
    });
  });

  it('respects byteOffset when the bytes are a view into a larger buffer', () => {
    const backing = new Uint8Array(40).fill(0x7f);
    backing.set(firmwarePacket(VALUES), 9);
    const view = backing.subarray(9, 33);
    expect(view.byteOffset).toBe(9);
    expect(decodePacket(view)).toEqual(decodePacket(firmwarePacket(VALUES)));
  });

  it('rejects packets that are not 24 bytes', () => {
    expect(decodePacket(new Uint8Array(20))).toBeNull();
    expect(decodePacket(new Uint8Array(25))).toBeNull();
    expect(decodeBase64Packet(bytesToBase64(new Uint8Array(23)))).toBeNull();
  });

  it('decodes Base64 notification values (as delivered by react-native-ble-plx)', () => {
    const bytes = firmwarePacket(VALUES);
    const b64 = Buffer.from(bytes).toString('base64');
    expect(decodeBase64Packet(b64)).toEqual(decodePacket(bytes));
  });

  it('round-trips Base64 for every padding length', () => {
    for (let len = 0; len < 30; len++) {
      const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 37 + 11) & 0xff);
      const encoded = bytesToBase64(bytes);
      expect(encoded).toBe(Buffer.from(bytes).toString('base64'));
      expect(Array.from(base64ToBytes(encoded))).toEqual(Array.from(bytes));
    }
  });

  it('rejects invalid Base64', () => {
    expect(() => base64ToBytes('ab$d')).toThrow();
    expect(() => base64ToBytes('abcde')).toThrow();
  });

  it('converts raw values with the firmware scales', () => {
    const imu = convertImu({ ax: 8192, ay: -4096, az: 0, gx: 131, gy: -262, gz: 0 });
    expect(imu).toEqual({ ax: 1, ay: -0.5, az: 0, gx: 1, gy: -2, gz: 0 });
    expect(ACCEL_SCALE).toBe(8192);
    expect(GYRO_SCALE).toBe(131);
  });

  it('encodePacket is the inverse of decodePacket', () => {
    const packet = decodePacket(firmwarePacket(VALUES))!;
    expect(decodePacket(encodePacket(packet))).toEqual(packet);
  });

  it('simulated sensor produces valid 24-byte packets with a shin strike spike', () => {
    const resting = decodePacket(mockPacketAt(0.5))!;
    const strike = decodePacket(mockPacketAt(0.01))!;
    const mag = (p: typeof resting) => Math.hypot(p.shin.ax, p.shin.ay, p.shin.az) / ACCEL_SCALE;
    expect(mockPacketAt(0.5)).toHaveLength(24);
    expect(mag(resting)).toBeCloseTo(1, 2);
    expect(mag(strike)).toBeCloseTo(2.5, 2);
  });
});
