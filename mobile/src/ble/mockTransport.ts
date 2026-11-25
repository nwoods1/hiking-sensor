// Simulated ESP32 for development without hardware (the web app's
// ?mockBluetooth=1). Emits the same Base64 packets a real notification
// carries, every 20 ms, so decoding and processing are exercised too.
//
// JS timers pause when the app is backgrounded, so this does not simulate
// locked-screen behaviour.

import { bytesToBase64 } from '@/sensor/base64';
import { mockPacketAt } from '@/sensor/mockSignal';

import type { ConnectedDevice, SensorTransport, TransportHandlers } from './transport';

export const MOCK_DEVICE: ConnectedDevice = { id: 'mock-sensor', name: 'Simulated sensor' };

const PACKET_INTERVAL_MS = 20;

export class MockTransport implements SensorTransport {
  readonly kind = 'mock' as const;
  private timer: ReturnType<typeof setInterval> | null = null;
  private handlers: TransportHandlers | null = null;
  private readonly startedAt = performance.now();
  // While true, connect() fails, to test reconnection.
  outOfRange = false;

  async connect(_deviceId: string, handlers: TransportHandlers): Promise<ConnectedDevice> {
    if (this.outOfRange) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      throw new Error('Simulated sensor is out of range');
    }
    this.stop();
    this.handlers = handlers;
    this.timer = setInterval(() => {
      const t = (performance.now() - this.startedAt) / 1000;
      handlers.onPacket(bytesToBase64(mockPacketAt(t)), performance.now(), Date.now());
    }, PACKET_INTERVAL_MS);
    return MOCK_DEVICE;
  }

  async disconnect(): Promise<void> {
    this.stop();
    this.handlers = null;
  }

  // Drop the link as if the sensor went out of range for `forMs`.
  simulateDropout(forMs: number): void {
    const handlers = this.handlers;
    if (!handlers) return;
    this.stop();
    this.handlers = null;
    this.outOfRange = true;
    setTimeout(() => {
      this.outOfRange = false;
    }, forMs);
    handlers.onDisconnected('Simulated dropout');
  }

  private stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
