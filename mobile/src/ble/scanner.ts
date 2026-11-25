// Foreground scan for the ESP32.
//
// The web app let the user pick from all devices (acceptAllDevices), and
// it isn't certain the firmware's advertisement fits the 128-bit service
// UUID alongside the name. So this scans without a UUID filter and marks a
// device as the sensor if it advertises SERVICE_UUID or the firmware's
// name. An empty array (not null) means "no filter": passing null crashes
// react-native-ble-plx 3.5 on iOS with the New Architecture
// (dotintent/react-native-ble-plx#1278).

import { Platform } from 'react-native';
import { ScanMode, type Device } from 'react-native-ble-plx';

import { DEVICE_NAME, SERVICE_UUID } from '@/sensor/constants';

import { getBleManager, requestBluetoothPermissions, waitForBluetooth } from './bleManager';

export type ScannedDevice = {
  id: string;
  name: string | null;
  rssi: number | null;
  isSensor: boolean;
};

export function isSensorDevice(device: Pick<Device, 'name' | 'localName' | 'serviceUUIDs'>): boolean {
  const uuids = (device.serviceUUIDs ?? []).map((u) => u.toLowerCase());
  const name = device.localName ?? device.name ?? '';
  return uuids.includes(SERVICE_UUID) || name === DEVICE_NAME;
}

export type ScanHandle = { stop(): void };

export async function startScan(
  onDevice: (device: ScannedDevice) => void,
  onError: (message: string) => void,
): Promise<ScanHandle> {
  await requestBluetoothPermissions();
  await waitForBluetooth();

  const ble = getBleManager();
  let active = true;
  const stop = () => {
    if (!active) return;
    active = false;
    ble.stopDeviceScan().catch(() => {});
  };

  await ble.startDeviceScan(
    [],
    Platform.OS === 'android' ? { allowDuplicates: false, scanMode: ScanMode.LowLatency } : { allowDuplicates: false },
    async (error, device) => {
      if (!active) return;
      if (error) {
        stop();
        onError(error.message);
        return;
      }
      if (!device) return;
      onDevice({
        id: device.id,
        name: device.localName ?? device.name ?? null,
        rssi: device.rssi ?? null,
        isSensor: isSensorDevice(device),
      });
    },
  );

  return { stop };
}
