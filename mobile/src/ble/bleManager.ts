// One BleManager for the app's lifetime (react-native-ble-plx allows a
// single instance), plus permission and adapter-state helpers.

import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, State } from 'react-native-ble-plx';

// iOS state restoration key. Also avoids a reported crash in
// react-native-ble-plx 3.5 on the New Architecture when createClient
// receives null (dotintent/react-native-ble-plx#1278): always pass a string.
const RESTORE_ID = 'softsteps-ble-central';

let manager: BleManager | null = null;

export function getBleManager(): BleManager {
  if (!manager) {
    manager = new BleManager({
      restoreStateIdentifier: RESTORE_ID,
      // Restored peripherals are reconnected by the recording service using
      // the device id saved with the session; nothing to do here.
      restoreStateFunction: () => {},
    });
  }
  return manager;
}

export class BluetoothUnavailableError extends Error {}

const STATE_MESSAGES: Partial<Record<State, string>> = {
  [State.PoweredOff]: 'Bluetooth is turned off. Turn it on in Control Center or Settings.',
  [State.Unauthorized]: 'Soft Steps does not have Bluetooth permission. Allow it in Settings > Soft Steps > Bluetooth.',
  [State.Unsupported]: 'This device does not support Bluetooth Low Energy.',
};

export function describeBluetoothState(state: State): string | null {
  return STATE_MESSAGES[state] ?? null;
}

// Android 12+ needs runtime BLUETOOTH_SCAN/CONNECT; older Android needs
// location for scanning. iOS asks on first use (Info.plist text comes from
// the react-native-ble-plx config plugin).
export async function requestBluetoothPermissions(): Promise<void> {
  if (Platform.OS !== 'android') return;

  const apiLevel = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
  const permissions =
    apiLevel >= 31
      ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];

  const result = await PermissionsAndroid.requestMultiple(permissions);
  const denied = permissions.filter((p) => result[p] !== PermissionsAndroid.RESULTS.GRANTED);
  if (denied.length > 0) {
    throw new BluetoothUnavailableError(
      apiLevel >= 31
        ? 'Soft Steps needs the Nearby devices permission to find your sensor. Allow it in Settings.'
        : 'Soft Steps needs location permission to scan for Bluetooth devices on this Android version.',
    );
  }
}

// Resolves when the adapter is powered on; rejects with a readable message
// if it is off, unauthorized or unsupported.
export async function waitForBluetooth(timeoutMs = 5000): Promise<void> {
  const ble = getBleManager();
  const initial = await ble.state();
  if (initial === State.PoweredOn) return;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      subscription.remove();
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      finish(new BluetoothUnavailableError('Bluetooth is not ready. Check that it is turned on.'));
    }, timeoutMs);
    const subscription = ble.onStateChange((state) => {
      if (state === State.PoweredOn) finish();
      const message = describeBluetoothState(state);
      if (message) finish(new BluetoothUnavailableError(message));
    }, true);
  });
}
