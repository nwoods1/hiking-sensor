// Values copied from frontend/script.js and esp32/hiking_sensor.ino.
// Changing any of these changes how hikes are measured, so keep them in
// sync with the firmware and the web app.

// BLE UUIDs (esp32/hiking_sensor.ino SERVICE_UUID / CHARACTERISTIC_UUID).
export const SERVICE_UUID = '12345678-1234-1234-1234-1234567890ab';
export const CHARACTERISTIC_UUID = 'abcdefab-1234-5678-1234-abcdefabcdef';

// The firmware advertises with this name (BLEDevice::init).
export const DEVICE_NAME = 'Hiking Sensor';

// 12 little-endian int16 values: thigh ax ay az gx gy gz, shin ax ay az gx gy gz.
export const PACKET_BYTES = 24;

// MPU6050 configured by the firmware as +/- 4 g and +/- 250 deg/s.
export const ACCEL_SCALE = 8192; // LSB per g
export const GYRO_SCALE = 131; // LSB per deg/s

export const RAD_TO_DEG = 180 / Math.PI;

// Complementary filter weight on the gyroscope prediction.
export const FILTER_ALPHA = 0.98;

// Straight-leg calibration at the start of a hike: skip packets while the
// filter settles, then average thigh - shin over the next packets.
// At ~50 Hz that is 1.5 s of settling and 1 s of averaging.
export const CALIBRATION_SETTLE_SAMPLES = 75;
export const CALIBRATION_SAMPLES = 50;

// Default integration step when the packet interval is unusable
// (firmware samples every 20 ms, ~50 Hz).
export const DEFAULT_DT = 0.02; // s
export const MAX_DT = 0.2; // s

// Foot-strike detection, applied to the dynamic impact proxy |accel - 1 g|.
export const IMPACT_THRESHOLD = 0.8; // g
export const IMPACT_RESET_THRESHOLD = 0.35; // g
export const IMPACT_COOLDOWN = 300; // ms
// How long to keep looking for the peak after the threshold is crossed.
export const IMPACT_WINDOW = 120; // ms

// Impacts at or above this count as "hard" in the hike stats.
export const HIGH_IMPACT_THRESHOLD = 2.0; // g

// Live chart length (frontend MAX_POINTS).
export const LIVE_CHART_POINTS = 250;
