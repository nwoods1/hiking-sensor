
#include <Wire.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ======================================
// MPU6050 ADDRESSES
// ======================================

#define THIGH_ADDR 0x68
#define SHIN_ADDR  0x69

// ======================================
// BLE SETTINGS
// ======================================


#define SERVICE_UUID \
"12345678-1234-1234-1234-1234567890ab"

#define CHARACTERISTIC_UUID \
"abcdefab-1234-5678-1234-abcdefabcdef"

BLECharacteristic *sensorCharacteristic;

bool deviceConnected = false;

// ======================================
// SENSOR DATA STRUCTURE
// ======================================

// Each MPU6050 provides:
// 3 acceleration measurements
// 3 gyroscope measurements

struct SensorData {

  int16_t ax;
  int16_t ay;
  int16_t az;

  int16_t gx;
  int16_t gy;
  int16_t gz;

};

SensorData thigh;
SensorData shin;

// ======================================
// BLE CONNECTION CALLBACKS
// ======================================

class ServerCallbacks : public BLEServerCallbacks {

  void onConnect(BLEServer *server) override {

    deviceConnected = true;

    Serial.println("BLE connected");

  }

  void onDisconnect(BLEServer *server) override {

    deviceConnected = false;

    Serial.println("BLE disconnected");

    server->startAdvertising();

  }

};

// ======================================
// INITIALIZE MPU6050
// ======================================

bool initializeMPU(uint8_t address) {

  // Wake up MPU6050

  Wire.beginTransmission(address);

  Wire.write(0x6B);

  Wire.write(0x00);

  if (Wire.endTransmission() != 0) {
    return false;
  }

  // Accelerometer range: +/- 4g
  // Sensitivity: 8192 LSB/g

  Wire.beginTransmission(address);

  Wire.write(0x1C);

  Wire.write(0x08);

  if (Wire.endTransmission() != 0) {
    return false;
  }

  // Gyroscope range: +/- 250 degrees/s
  // Sensitivity: 131 LSB/(degrees/s)

  Wire.beginTransmission(address);

  Wire.write(0x1B);

  Wire.write(0x00);

  if (Wire.endTransmission() != 0) {
    return false;
  }

  // Digital low-pass filter

  Wire.beginTransmission(address);

  Wire.write(0x1A);

  Wire.write(0x03);

  if (Wire.endTransmission() != 0) {
    return false;
  }

  return true;

}

// ======================================
// READ RAW MPU6050 DATA
// ======================================

bool readMPU(uint8_t address, SensorData &sensor) {

  Wire.beginTransmission(address);

  Wire.write(0x3B);

  if (Wire.endTransmission(false) != 0) {
    return false;
  }

  // Request 14 bytes:
  // Accel XYZ = 6
  // Temperature = 2
  // Gyro XYZ = 6

  if (Wire.requestFrom(address, (uint8_t)14, true) != 14) {
    return false;
  }

  sensor.ax = (int16_t)((Wire.read() << 8) | Wire.read());

  sensor.ay = (int16_t)((Wire.read() << 8) | Wire.read());

  sensor.az = (int16_t)((Wire.read() << 8) | Wire.read());

  // Skip temperature

  Wire.read();
  Wire.read();

  sensor.gx = (int16_t)((Wire.read() << 8) | Wire.read());

  sensor.gy = (int16_t)((Wire.read() << 8) | Wire.read());

  sensor.gz = (int16_t)((Wire.read() << 8) | Wire.read());

  return true;

}

// ======================================
// BLE TRANSMISSION
// ======================================

void transmitSensorData() {

  // 12 signed 16-bit integers = 24 bytes
  //
  // Packet layout:
  //
  // 0  : thigh ax
  // 2  : thigh ay
  // 4  : thigh az
  // 6  : thigh gx
  // 8  : thigh gy
  // 10 : thigh gz
  //
  // 12 : shin ax
  // 14 : shin ay
  // 16 : shin az
  // 18 : shin gx
  // 20 : shin gy
  // 22 : shin gz

  // Explicit little-endian encoding so JavaScript
  // can decode every value using getInt16(offset, true).

  int16_t values[12] = {

    thigh.ax,
    thigh.ay,
    thigh.az,

    thigh.gx,
    thigh.gy,
    thigh.gz,

    shin.ax,
    shin.ay,
    shin.az,

    shin.gx,
    shin.gy,
    shin.gz

  };

  uint8_t packet[24];

  for (int i = 0; i < 12; i++) {

    uint16_t value = (uint16_t)values[i];

    packet[i * 2] = value & 0xFF;

    packet[i * 2 + 1] = (value >> 8) & 0xFF;

  }

  if (deviceConnected) {

    sensorCharacteristic->setValue(
      packet,
      sizeof(packet)
    );

    sensorCharacteristic->notify();

  }

}

// ======================================
// SERIAL OUTPUT
// ======================================

void printSensorData() {

  // Convert raw values only for debugging.
  // BLE still transmits the original raw values.

  Serial.print("THIGH | ");

  Serial.print("AX: ");
  Serial.print(thigh.ax / 8192.0, 3);

  Serial.print(" AY: ");
  Serial.print(thigh.ay / 8192.0, 3);

  Serial.print(" AZ: ");
  Serial.print(thigh.az / 8192.0, 3);

  Serial.print(" | SHIN | ");

  Serial.print("AX: ");
  Serial.print(shin.ax / 8192.0, 3);

  Serial.print(" AY: ");
  Serial.print(shin.ay / 8192.0, 3);

  Serial.print(" AZ: ");
  Serial.println(shin.az / 8192.0, 3);

}

// ======================================
// SETUP
// ======================================

void setup() {

  Serial.begin(115200);

  delay(500);

  Serial.println();
  Serial.println("Starting Hiking Sensor...");

  // ESP32 I2C pins
  // SDA = GPIO21
  // SCL = GPIO22

  Wire.begin(21, 22, 100000);

  // Initialize both sensors

  if (!initializeMPU(THIGH_ADDR)) {

    Serial.println("ERROR: Thigh MPU6050 not detected!");

    while (true) {
      delay(1000);
    }

  }

  Serial.println("Thigh MPU6050 initialized.");

  if (!initializeMPU(SHIN_ADDR)) {

    Serial.println("ERROR: Shin MPU6050 not detected!");

    while (true) {
      delay(1000);
    }

  }

  Serial.println("Shin MPU6050 initialized.");

  // ====================================
  // BLE SETUP
  // ====================================

  BLEDevice::init("Hiking Sensor");

  // 24-byte notifications require an
  // ATT MTU of at least 27 bytes.
  // Request a larger MTU where supported.

  BLEDevice::setMTU(185);

  BLEServer *server = BLEDevice::createServer();

  server->setCallbacks(new ServerCallbacks());

  BLEService *service =
    server->createService(SERVICE_UUID);

  sensorCharacteristic =
    service->createCharacteristic(

      CHARACTERISTIC_UUID,

      BLECharacteristic::PROPERTY_READ |
      BLECharacteristic::PROPERTY_NOTIFY

    );

  sensorCharacteristic->addDescriptor(
    new BLE2902()
  );

  service->start();

  BLEAdvertising *advertising =
    BLEDevice::getAdvertising();

  advertising->addServiceUUID(SERVICE_UUID);

  advertising->start();

  Serial.println("BLE advertising started.");
  Serial.println("Device name: Hiking Sensor");
  Serial.println("Ready!");

}

// ======================================
// MAIN LOOP
// ======================================

void loop() {

  static unsigned long previousSample = 0;

  const unsigned long SAMPLE_INTERVAL = 20;

  unsigned long currentTime = millis();

  // Approximately 50 samples per second

  if (currentTime - previousSample < SAMPLE_INTERVAL) {
    return;
  }

  previousSample = currentTime;

  // Read both MPU6050 sensors

  bool thighOK = readMPU(THIGH_ADDR, thigh);

  bool shinOK = readMPU(SHIN_ADDR, shin);

  if (!thighOK || !shinOK) {

    Serial.println("Sensor read failed.");

    return;

  }

  // Transmit raw measurements

  transmitSensorData();

  // Debug output

  printSensorData();

}