// What the recording service needs from a sensor connection. Implemented
// by the real BLE transport (react-native-ble-plx) and the simulated
// sensor, so recording logic is the same for both.

export type ConnectedDevice = { id: string; name: string };

export type TransportHandlers = {
  // value: the characteristic value as Base64, exactly as BLE delivers it.
  // receivedAt: performance.now() and Date.now() when the JS callback ran.
  onPacket(value: string, monoMs: number, wallMs: number): void;
  // Link dropped without disconnect() being called.
  onDisconnected(reason: string | null): void;
};

export type ConnectOptions = {
  // Give up after this long; 0 waits until the device appears (iOS keeps a
  // pending connection, which can complete while the app is backgrounded).
  timeoutMs: number;
};

export interface SensorTransport {
  readonly kind: 'ble' | 'mock';
  connect(deviceId: string, handlers: TransportHandlers, options: ConnectOptions): Promise<ConnectedDevice>;
  // Intentional disconnect; does not call onDisconnected.
  disconnect(): Promise<void>;
}
