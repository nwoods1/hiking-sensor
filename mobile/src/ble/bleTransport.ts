// ESP32 connection over react-native-ble-plx: connect, discover the
// sensor service, subscribe to notifications, report unexpected
// disconnects. Holds at most one connection and one notification
// subscription at a time.

import { Platform } from 'react-native';
import { BleErrorCode, type BleError, type Subscription } from 'react-native-ble-plx';

import { CHARACTERISTIC_UUID, DEVICE_NAME, PACKET_BYTES, SERVICE_UUID } from '@/sensor/constants';

import { getBleManager, requestBluetoothPermissions, waitForBluetooth } from './bleManager';
import type { ConnectOptions, ConnectedDevice, SensorTransport, TransportHandlers } from './transport';

// ATT payload = MTU - 3, so 24-byte packets need an MTU of at least 27.
// Android starts at 23 and must ask; iOS negotiates a larger MTU itself.
const REQUIRED_MTU = PACKET_BYTES + 3;
const REQUESTED_MTU = 185; // matches BLEDevice::setMTU(185) in the firmware

// Like the web app's connectToSensorCharacteristic: links often drop right
// after connecting, and an immediate retry usually works.
const MAX_CONNECT_ATTEMPTS = 3;

const MONITOR_TRANSACTION = 'softsteps-sensor-notify';

class ConnectionCancelledError extends Error {
  constructor() {
    super('Connection cancelled');
  }
}

export class NotTheSensorError extends Error {
  constructor() {
    super("That device isn't the hiking sensor. Pick the ESP32 named “Hiking Sensor”.");
  }
}

function isCancellation(error: BleError): boolean {
  return (
    error.errorCode === BleErrorCode.OperationCancelled ||
    error.errorCode === BleErrorCode.DeviceDisconnected ||
    error.errorCode === BleErrorCode.BluetoothManagerDestroyed
  );
}

export class BleTransport implements SensorTransport {
  readonly kind = 'ble' as const;

  private deviceId: string | null = null;
  private monitor: Subscription | null = null;
  private disconnectWatch: Subscription | null = null;
  private connecting: Promise<ConnectedDevice> | null = null;
  // Bumped on every connect/disconnect so callbacks from an old link are ignored.
  private generation = 0;
  private cancelRequested = false;

  connect(deviceId: string, handlers: TransportHandlers, options: ConnectOptions): Promise<ConnectedDevice> {
    // A second tap (or a reconnect racing a manual connect) joins the
    // attempt in progress instead of opening another connection.
    if (this.connecting) return this.connecting;
    this.cancelRequested = false;
    this.connecting = this.connectWithRetries(deviceId, handlers, options).finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async connectWithRetries(
    deviceId: string,
    handlers: TransportHandlers,
    options: ConnectOptions,
  ): Promise<ConnectedDevice> {
    await requestBluetoothPermissions();
    await waitForBluetooth();
    await this.teardown();

    for (let attempt = 1; ; attempt++) {
      try {
        return await this.connectOnce(deviceId, handlers, options);
      } catch (error) {
        await this.teardown();
        const retryable =
          !this.cancelRequested &&
          !(error instanceof NotTheSensorError) &&
          !(error instanceof ConnectionCancelledError) &&
          (error as BleError)?.errorCode !== BleErrorCode.OperationCancelled &&
          (error as BleError)?.errorCode !== BleErrorCode.OperationTimedOut;
        if (!retryable || attempt >= MAX_CONNECT_ATTEMPTS) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    }
  }

  private async connectOnce(
    deviceId: string,
    handlers: TransportHandlers,
    { timeoutMs }: ConnectOptions,
  ): Promise<ConnectedDevice> {
    const ble = getBleManager();
    const generation = ++this.generation;
    const ensureCurrent = () => {
      if (generation !== this.generation) throw new ConnectionCancelledError();
    };
    await ble.stopDeviceScan().catch(() => {});

    // Set before connecting so disconnect() can cancel a pending attempt.
    this.deviceId = deviceId;
    let device = await ble.connectToDevice(deviceId, {
      ...(timeoutMs > 0 ? { timeout: timeoutMs } : {}),
      ...(Platform.OS === 'android' ? { requestMTU: REQUESTED_MTU } : {}),
    });
    ensureCurrent();

    device = await device.discoverAllServicesAndCharacteristics();
    ensureCurrent();
    const services = await device.services();
    const service = services.find((s) => s.uuid.toLowerCase() === SERVICE_UUID);
    if (!service) throw new NotTheSensorError();
    const characteristics = await service.characteristics();
    if (!characteristics.some((c) => c.uuid.toLowerCase() === CHARACTERISTIC_UUID)) {
      throw new NotTheSensorError();
    }

    if (Platform.OS === 'android' && device.mtu < REQUIRED_MTU) {
      device = await device.requestMTU(REQUESTED_MTU);
      if (device.mtu < REQUIRED_MTU) {
        throw new Error(`Bluetooth MTU ${device.mtu} is too small for 24-byte sensor packets.`);
      }
    }
    ensureCurrent();

    this.disconnectWatch = ble.onDeviceDisconnected(device.id, (error) => {
      if (generation !== this.generation) return;
      this.clearSubscriptions();
      this.deviceId = null;
      handlers.onDisconnected(error?.message ?? null);
    });

    this.monitor = ble.monitorCharacteristicForDevice(
      device.id,
      SERVICE_UUID,
      CHARACTERISTIC_UUID,
      (error, characteristic) => {
        if (generation !== this.generation) return;
        if (error) {
          // Removing the subscription or losing the link reports here too;
          // the disconnect listener handles real link loss.
          if (!isCancellation(error)) console.warn('Sensor notification error:', error.message);
          return;
        }
        if (characteristic?.value) {
          handlers.onPacket(characteristic.value, performance.now(), Date.now());
        }
      },
      MONITOR_TRANSACTION,
      'notification',
    );

    return { id: device.id, name: device.localName ?? device.name ?? DEVICE_NAME };
  }

  async disconnect(): Promise<void> {
    this.cancelRequested = true;
    await this.teardown();
  }

  private clearSubscriptions() {
    this.monitor?.remove();
    this.monitor = null;
    this.disconnectWatch?.remove();
    this.disconnectWatch = null;
  }

  private async teardown(): Promise<void> {
    this.generation++;
    this.clearSubscriptions();
    const id = this.deviceId;
    this.deviceId = null;
    if (id) {
      // Also cancels a pending (not yet established) connection.
      await getBleManager()
        .cancelDeviceConnection(id)
        .catch(() => {});
    }
  }
}
