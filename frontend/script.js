import {
  openDatabase,
  createSession,
  saveReading,
  endSession,
} from "./indexedDB.js";

let kneeZeroOffset = 0;
let kneeCalibrated = false;

("use strict");

// =====================================================
// BLE UUIDs
// =====================================================

const SERVICE_UUID = "12345678-1234-1234-1234-1234567890ab";
const CHARACTERISTIC_UUID = "abcdefab-1234-5678-1234-abcdefabcdef";

// =====================================================
// CONFIGURATION
// =====================================================

// MPU6050 configuration must match Arduino.
//
// Accelerometer: +/- 4g
// Gyroscope: +/- 250 degrees/sec

const ACCEL_SCALE = 8192;
const GYRO_SCALE = 131;

const RAD_TO_DEG = 180 / Math.PI;

// Complementary filter
const FILTER_ALPHA = 0.98;

// Impact detection settings
const IMPACT_THRESHOLD = 0.8; // g
const IMPACT_RESET_THRESHOLD = 0.35; // g
const IMPACT_COOLDOWN = 300; // milliseconds

// How long to continue sampling after detecting
// the beginning of a potential foot strike.
const IMPACT_WINDOW = 120; // milliseconds

// Impacts at or above this count as "hard" in the Supabase hike stats.
const HIGH_IMPACT_THRESHOLD = 2.0; // g

// Graph settings
const MAX_POINTS = 250;
const MAX_SERIAL_LINES = 100;

// =====================================================
// PAGE ELEMENTS
// =====================================================

const statusText = document.getElementById("status");
const connectButton = document.getElementById("connect");
const serialOutput = document.getElementById("serialOutput");

// =====================================================
// GRAPH SETUP
// =====================================================

const kneeCanvas = document.getElementById("kneeGraph");
const kneeCtx = kneeCanvas.getContext("2d");

const impactCanvas = document.getElementById("impactGraph");
const impactCtx = impactCanvas.getContext("2d");

const kneeData = [];
const impactData = [];
const impactMarkers = [];
const serialLines = [];

// =====================================================
// SENSOR STATE
// =====================================================

let thighAngle = 0;
let shinAngle = 0;
let kneeAngle = 0;

let filterInitialized = false;
let previousTime = null;

// Impact state
let impactArmed = true;
let lastImpactTime = -Infinity;

let impactKnee = 0;
let impactStrength = 0;

// Peak impact tracking
let trackingImpact = false;
let impactStartTime = 0;

let peakImpact = 0;
let peakKneeAngle = 0;
let peakThighAngle = 0;
let peakTimestamp = null;

let peakGraphIndex = -1;

// =====================================================
// ACTIVITY RECORDING
// =====================================================

let activity = createActivity();

let activeSessionId = null;
let activityStarting = false;

// Initialize IndexedDB
openDatabase()
  .then(() => console.log("Hiking database ready"))
  .catch((error) => console.error("Database error:", error));

function createActivity() {
  return {
    startedAt: null,
    endedAt: null,

    recording: false,

    readings: [],
    footStrikes: [],

    totalSteps: 0,

    impactSum: 0,
    maxImpact: 0,

    kneeAngleSum: 0,

    // Experimental step-size proxy
    swingAmplitudeSum: 0,
    swingAmplitudeCount: 0,
  };
}

// =====================================================
// START ACTIVITY
// =====================================================

// details: optional info stored on the session, e.g. { name }.
async function startActivity(details = {}) {
  // Prevent accidentally starting multiple sessions.
  if (activity.recording || activityStarting) {
    console.warn("Activity already running or starting.");
    return;
  }

  activityStarting = true;

  try {
    // Create the database session FIRST.
    // Thresholds are saved so the Supabase upload uses the
    // values this hike was actually recorded with.
    activeSessionId = await createSession({
      ...details,
      stepThreshold: IMPACT_THRESHOLD,
      highThreshold: HIGH_IMPACT_THRESHOLD,
    });

    // Reset activity statistics.
    activity = createActivity();

    activity.startedAt = new Date().toISOString();

    resetProcessing();

    updateStepCount();

    // Begin recording only after the database is ready.
    activity.recording = true;

    console.log("Activity started.");
    console.log("Database session ID:", activeSessionId);

    return activeSessionId;
  } catch (error) {
    activeSessionId = null;

    console.error("Failed to start activity:", error);

    throw error;
  } finally {
    activityStarting = false;
  }
}

// =====================================================
// STOP ACTIVITY
// =====================================================

// completed: true when the user finished the hike, which marks
// the session for upload to Supabase.
async function stopActivity({ completed = false } = {}) {
  if (!activity.recording) {
    return getActivitySummary();
  }

  activity.recording = false;
  activity.endedAt = new Date().toISOString();

  const summary = getActivitySummary();

  const sessionId = activeSessionId;
  activeSessionId = null;

  try {
    if (sessionId !== null) {
      await endSession(sessionId, { completed });

      console.log("Database session ended:", sessionId);
    }
  } catch (error) {
    console.error("Failed to end database session:", error);
  }

  console.log("Activity stopped.");
  console.table(summary);

  return {
    ...summary,
    sessionId,
  };
}

// =====================================================
// RESET PROCESSING STATE
// =====================================================

function resetProcessing() {
  peakGraphIndex = -1;
  kneeZeroOffset = 0;
  kneeCalibrated = false;

  thighAngle = 0;
  shinAngle = 0;
  kneeAngle = 0;

  filterInitialized = false;
  previousTime = null;

  // Reset impact detection
  impactArmed = true;
  lastImpactTime = -Infinity;

  impactKnee = 0;
  impactStrength = 0;

  // Reset peak tracking
  trackingImpact = false;
  impactStartTime = 0;

  peakImpact = 0;
  peakKneeAngle = 0;
  peakThighAngle = 0;
  peakTimestamp = null;
  kneeData.length = 0;
  impactData.length = 0;
  impactMarkers.length = 0;
  serialLines.length = 0;

  swingMinimum = Infinity;
  swingMaximum = -Infinity;
}

// =====================================================
// BLE CONNECTION
// =====================================================

// data.html: start recording as soon as the sensor connects.
// hike-session.html uses window.HikingSensor instead (see bottom).

connectButton?.addEventListener("click", async () => {
  if (await connectToESP32()) {
    await startActivity();
  }
});

// Returns the connected device, or null if connecting failed.
async function connectToESP32() {
  if (
    new URLSearchParams(window.location.search).get("mockBluetooth") === "1"
  ) {
    const device = createMockDevice();

    device.addEventListener("gattserverdisconnected", () => {
      statusText.textContent = "Disconnected";

      stopActivity();
    });

    statusText.textContent = "Connected to Mock ESP32 (test mode)";

    return device;
  }

  try {
    statusText.textContent = "Searching for Bluetooth devices...";

    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [SERVICE_UUID],
    });

    statusText.textContent = "Connecting...";

    const characteristic = await connectToSensorCharacteristic(device);

    characteristic.addEventListener("characteristicvaluechanged", (event) => {
      console.log("BLE packet received:", event.target.value);

      handleSensorData(event);
    });

    device.addEventListener("gattserverdisconnected", () => {
      statusText.textContent = "Disconnected";

      stopActivity();
    });

    statusText.textContent = "Connected to " + (device.name || "ESP32");

    return device;
  } catch (error) {
    console.error(error);

    if (error.name === "NetworkError") {
      statusText.textContent =
        "Connection failed: the ESP32 keeps dropping the connection. " +
        "Make sure no other phone or app is connected to it, restart it, and try again.";
    } else if (
      error.name === "NotFoundError" &&
      error.message.includes("Service")
    ) {
      statusText.textContent =
        "Connection failed: that device isn't the hiking sensor. Pick the ESP32 from the list.";
    } else {
      statusText.textContent = "Connection failed: " + error.message;
    }

    return null;
  }
}

// =====================================================
// CONNECT GATT WITH RETRIES
// =====================================================

// Chrome (especially on Windows) can drop the link right after
// gatt.connect(), so service discovery fails with
// "NetworkError: GATT Server is disconnected". Reconnecting
// usually works, so retry a few times before giving up.

const MAX_CONNECT_ATTEMPTS = 3;

async function connectToSensorCharacteristic(device) {
  for (let attempt = 1; ; attempt++) {
    try {
      const server = await device.gatt.connect();

      const service = await server.getPrimaryService(SERVICE_UUID);

      const characteristic =
        await service.getCharacteristic(CHARACTERISTIC_UUID);

      await characteristic.startNotifications();

      return characteristic;
    } catch (error) {
      if (error.name !== "NetworkError" || attempt >= MAX_CONNECT_ATTEMPTS) {
        throw error;
      }

      console.warn(`Connection attempt ${attempt} failed, retrying:`, error);

      statusText.textContent = `Connection dropped, retrying (${attempt + 1}/${MAX_CONNECT_ATTEMPTS})...`;

      if (device.gatt.connected) {
        device.gatt.disconnect();
      }

      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
}

// =====================================================
// MOCK ESP32 (?mockBluetooth=1)
// =====================================================

// Sends 24-byte packets in the same format as the Arduino:
// a walking leg at 1 step per second with a foot strike
// on the shin at the start of each step.

function createMockDevice() {
  let connected = true;

  const disconnectListeners = new Set();

  const mockStart = performance.now();

  const toRaw = (value, scale) => Math.round(value * scale);

  const timer = setInterval(() => {
    const t = (performance.now() - mockStart) / 1000;

    const phase = 2 * Math.PI * t;

    // Segment angles (deg) and their rates (deg/s).
    const thighDeg = 15 * Math.sin(phase);

    const thighRate = 15 * 2 * Math.PI * Math.cos(phase);

    const shinDeg = thighDeg - 30 - 15 * Math.sin(phase + 1);

    const shinRate = thighRate - 15 * 2 * Math.PI * Math.cos(phase + 1);

    // Foot strike: short acceleration spike on the shin.
    const strike = t % 1 < 0.05 ? 2.5 : 1;

    const packet = new DataView(new ArrayBuffer(24));

    const writeSensor = (offset, deg, rate, gravity) => {
      const rad = deg / RAD_TO_DEG;

      packet.setInt16(offset, 0, true);

      packet.setInt16(
        offset + 2,
        toRaw(Math.sin(rad) * gravity, ACCEL_SCALE),
        true,
      );

      packet.setInt16(
        offset + 4,
        toRaw(Math.cos(rad) * gravity, ACCEL_SCALE),
        true,
      );

      packet.setInt16(offset + 6, toRaw(rate, GYRO_SCALE), true);

      packet.setInt16(offset + 8, 0, true);

      packet.setInt16(offset + 10, 0, true);
    };

    writeSensor(0, thighDeg, thighRate, 1);

    writeSensor(12, shinDeg, shinRate, strike);

    handleSensorData({
      target: {
        value: packet,
      },
    });
  }, 20);

  return {
    name: "Mock ESP32",

    gatt: {
      get connected() {
        return connected;
      },

      disconnect() {
        if (!connected) {
          return;
        }

        connected = false;

        clearInterval(timer);

        disconnectListeners.forEach((listener) => listener());
      },
    },

    addEventListener(type, listener) {
      if (type === "gattserverdisconnected") {
        disconnectListeners.add(listener);
      }
    },
  };
}

// =====================================================
// DECODE RAW BLE DATA
// =====================================================

function decodeSensorData(data) {
  // New Arduino sends 12 int16_t values.
  // Total packet size = 24 bytes.

  if (data.byteLength !== 24) {
    return null;
  }

  const thigh = {
    ax: data.getInt16(0, true),

    ay: data.getInt16(2, true),

    az: data.getInt16(4, true),

    gx: data.getInt16(6, true),

    gy: data.getInt16(8, true),

    gz: data.getInt16(10, true),
  };

  const shin = {
    ax: data.getInt16(12, true),

    ay: data.getInt16(14, true),

    az: data.getInt16(16, true),

    gx: data.getInt16(18, true),

    gy: data.getInt16(20, true),

    gz: data.getInt16(22, true),
  };

  return {
    thigh,
    shin,
  };
}

// =====================================================
// CONVERT RAW SENSOR VALUES
// =====================================================

function convertSensorData(raw) {
  return {
    ax: raw.ax / ACCEL_SCALE,

    ay: raw.ay / ACCEL_SCALE,

    az: raw.az / ACCEL_SCALE,

    gx: raw.gx / GYRO_SCALE,

    gy: raw.gy / GYRO_SCALE,

    gz: raw.gz / GYRO_SCALE,
  };
}

// =====================================================
// CALCULATE ACCELERATION MAGNITUDE
// =====================================================

function calculateAcceleration(sensor) {
  return Math.sqrt(sensor.ax ** 2 + sensor.ay ** 2 + sensor.az ** 2);
}

// =====================================================
// ANGLE HELPERS
// =====================================================

// Normalize angle to -180 to +180 degrees.

function normalizeAngle(angle) {
  return ((((angle + 180) % 360) + 360) % 360) - 180;
}

// =====================================================
// CALCULATE KNEE ANGLE
// =====================================================

function calculateKneeAngle(thigh, shin, dt) {
  // Accelerometer orientation estimates.
  // Assumes sensor X axes correspond to the
  // intended knee flexion/extension rotation.

  const thighAccelAngle = Math.atan2(thigh.ay, thigh.az) * RAD_TO_DEG;

  const shinAccelAngle = Math.atan2(shin.ay, shin.az) * RAD_TO_DEG;

  // Initialize filter using accelerometer readings.

  if (!filterInitialized) {
    thighAngle = thighAccelAngle;

    shinAngle = shinAccelAngle;

    filterInitialized = true;
  } else {
    // Predict orientation using gyroscope.

    const thighPrediction = thighAngle + thigh.gx * dt;

    const shinPrediction = shinAngle + shin.gx * dt;

    // Correct using accelerometer.
    // Normalize angular differences to avoid
    // discontinuities around +/-180 degrees.

    thighAngle = normalizeAngle(
      thighPrediction +
        (1 - FILTER_ALPHA) * normalizeAngle(thighAccelAngle - thighPrediction),
    );

    shinAngle = normalizeAngle(
      shinPrediction +
        (1 - FILTER_ALPHA) * normalizeAngle(shinAccelAngle - shinPrediction),
    );
  }

  // Relative thigh/shin orientation.
  const relativeAngle = normalizeAngle(thighAngle - shinAngle);

  // Measure how far the knee has bent away from
  // the calibrated straight-leg position.
  const bendAngle = Math.abs(normalizeAngle(relativeAngle - kneeZeroOffset));

  // Anatomical-style knee angle:
  // straight leg = 180 degrees
  // more knee flexion = a smaller angle
  kneeAngle = 180 - bendAngle;

  return kneeAngle;
}

function calibrateKnee() {
  kneeZeroOffset = normalizeAngle(thighAngle - shinAngle);

  console.log("Knee calibrated. Offset:", kneeZeroOffset);
}

// =====================================================
// CALCULATE IMPACT ACCELERATION
// =====================================================

function calculateImpact(acceleration) {
  // Simple dynamic acceleration proxy.
  //
  // At rest, acceleration magnitude is ~1g.
  // This is not a direct measurement of
  // knee force or true gravity-compensated
  // linear acceleration.

  return Math.abs(acceleration - 1.0);
}

// =====================================================
// DETECT FOOT STRIKE
// =====================================================

function detectFootStrike(
  impact,
  currentKneeAngle,
  currentThighAngle,
  currentTime,
) {
  // ====================================
  // 1. CONTINUE TRACKING AN ACTIVE IMPACT
  // ====================================

  if (trackingImpact) {
    // Update the peak whenever we receive
    // a stronger acceleration measurement.
    if (impact > peakImpact) {
      peakImpact = impact;
      peakKneeAngle = currentKneeAngle;
      peakThighAngle = currentThighAngle;
      peakTimestamp = new Date().toISOString();

       peakGraphIndex = impactData.length;
    }

    // Continue collecting measurements
    // until the 120 ms window finishes.
    if (currentTime - impactStartTime < IMPACT_WINDOW) {
      return null;
    }

    // ====================================
    // 2. FINALIZE THE IMPACT
    // ====================================

    trackingImpact = false;
    impactArmed = false;

    lastImpactTime = currentTime;

    return {
      impact: peakImpact,
      kneeAngle: peakKneeAngle,
      thighAngle: peakThighAngle,
      timestamp: peakTimestamp,
       graphIndex: peakGraphIndex
    };
  }

  // ====================================
  // 3. REARM WHEN ACCELERATION SETTLES
  // ====================================

  if (impact < IMPACT_RESET_THRESHOLD) {
    impactArmed = true;
  }

  // ====================================
  // 4. START TRACKING A NEW IMPACT
  // ====================================

  if (
    impactArmed &&
    impact > IMPACT_THRESHOLD &&
    currentTime - lastImpactTime >= IMPACT_COOLDOWN
  ) {
    trackingImpact = true;
    impactArmed = false;

    impactStartTime = currentTime;

    // Initialize the peak using the
    // first measurement above the threshold.
    peakImpact = impact;
    peakKneeAngle = currentKneeAngle;
    peakThighAngle = currentThighAngle;
    peakTimestamp = new Date().toISOString();

    peakGraphIndex = impactData.length;
  }

  // No completed foot strike yet.
  return null;
}

// =====================================================
// STEP-SIZE ESTIMATION
// =====================================================

// Track thigh angular excursion between
// detected foot strikes.
//
// This is an experimental step-size proxy,
// NOT a physical distance measurement.

let swingMinimum = Infinity;

let swingMaximum = -Infinity;

function updateSwingAmplitude(angle) {
  // Track unwrapped-equivalent local angle.
  // Assumes a normal walking range that does
  // not cross the +/-180-degree boundary.

  swingMinimum = Math.min(swingMinimum, angle);

  swingMaximum = Math.max(swingMaximum, angle);
}

function calculateSwingAmplitude() {
  if (!Number.isFinite(swingMinimum) || !Number.isFinite(swingMaximum)) {
    return null;
  }

  return swingMaximum - swingMinimum;
}

function resetSwingAmplitude(angle) {
  swingMinimum = angle;

  swingMaximum = angle;
}

// =====================================================
// RECORD INDIVIDUAL FOOT STRIKE
// =====================================================

function recordFootStrike(kneeAngle, impact, timestamp, swingAmplitude) {
  if (!activity.recording) {
    return;
  }

  const strike = {
    timestamp,

    kneeAngle,
    impact,

    swingAmplitude,
  };

  activity.footStrikes.push(strike);

  // Update running statistics.

  activity.totalSteps++;

  activity.impactSum += impact;

  activity.kneeAngleSum += kneeAngle;

  activity.maxImpact = Math.max(activity.maxImpact, impact);

  updateStepCount();

  if (swingAmplitude !== null) {
    activity.swingAmplitudeSum += swingAmplitude;

    activity.swingAmplitudeCount++;
  }

  console.log("Foot strike:", strike);
}

function updateStepCount() {
  const stepCountElement = document.getElementById("step-count");

  if (stepCountElement) {
    stepCountElement.textContent = String(activity.totalSteps);
  }
}

// =====================================================
// CALCULATE ACTIVITY STATISTICS
// =====================================================

function getActivitySummary() {
  const steps = activity.totalSteps;

  return {
    startedAt: activity.startedAt,

    endedAt: activity.endedAt,

    totalSteps: steps,

    averageKneeAngleAtImpact: steps > 0 ? activity.kneeAngleSum / steps : 0,

    maxImpact: activity.maxImpact,

    averageImpact: steps > 0 ? activity.impactSum / steps : 0,

    // Angular proxy, measured in degrees.
    // Not actual stride length in metres.

    averageSwingAmplitude:
      activity.swingAmplitudeCount > 0
        ? activity.swingAmplitudeSum / activity.swingAmplitudeCount
        : null,
  };
}

// =====================================================
// RECEIVE BLE SENSOR DATA
// =====================================================

function handleSensorData(event) {
  if (!activity.recording) {
    return;
  }

  const data = event.target.value;

  // Decode raw measurements.

  const decoded = decodeSensorData(data);

  if (!decoded) {
    console.warn("Unexpected BLE packet size:", data.byteLength);

    return;
  }

  // Convert raw values to physical units.

  const thigh = convertSensorData(decoded.thigh);

  const shin = convertSensorData(decoded.shin);

  // ====================================
  // TIME DELTA
  // ====================================

  const currentTime = performance.now();

  let dt = 0.02;

  if (previousTime !== null) {
    dt = (currentTime - previousTime) / 1000;

    // Avoid unusually large integration steps.

    if (dt <= 0 || dt > 0.2) {
      dt = 0.02;
    }
  }

  previousTime = currentTime;

  // ====================================
  // CALCULATE KNEE ANGLE
  // ====================================

  // Calculate the current knee angle using both IMUs.
  calculateKneeAngle(thigh, shin, dt);

  // Automatically calibrate the first valid position as a straight leg.
  // Keep the leg straight when starting the hike.
  if (!kneeCalibrated) {
    calibrateKnee();

    kneeCalibrated = true;

    // The calibrated straight-leg position is 180 degrees.
    kneeAngle = 180;

    console.log(
      "Automatic knee calibration completed. Straight leg = 180 degrees.",
    );
  }

  // ====================================
  // CALCULATE ACCELERATION
  // ====================================

  const acceleration = calculateAcceleration(shin);

  // ====================================
  // CALCULATE IMPACT
  // ====================================

  const impact = calculateImpact(acceleration);

  // ====================================
  // TRACK LEG SWING
  // ====================================

  updateSwingAmplitude(thighAngle);

  // ====================================
  // DETECT FOOT STRIKE
  // ====================================

  // The function now returns an object containing
  // the peak measurements, or null if no strike
  // has finished its tracking window.

  const footStrike = detectFootStrike(
    impact,
    kneeAngle,
    thighAngle,
    currentTime,
  );

  const impactDetected = footStrike !== null;

  if (impactDetected) {
    // Use the highest acceleration recorded
    // during the 120 ms tracking window.

    impactKnee = footStrike.kneeAngle;
    impactStrength = footStrike.impact;

    const swingAmplitude = calculateSwingAmplitude();

    recordFootStrike(
      footStrike.kneeAngle,
      footStrike.impact,
      footStrike.timestamp,
      swingAmplitude,
    );

    resetSwingAmplitude(footStrike.thighAngle);
  }

  // ====================================
  // SAVE SENSOR READING
  // ====================================

  // Create the reading object once.

  const reading = {
    timestamp: new Date().toISOString(),

    thigh: {
      ...thigh,
    },

    shin: {
      ...shin,
    },

    kneeAngle,

    acceleration,

    impact,

    impactDetected,
  };

  // Continue storing in memory.
  activity.readings.push(reading);

  // SAVE DETECTED IMPACTS ONLY

  const sessionId = activeSessionId;

  if (sessionId !== null && impactDetected) {
    saveReading(
      sessionId,
      {
        kneeAngle: footStrike.kneeAngle,
        kneeAcceleration: footStrike.impact,
      },
      true,
    ).catch((error) => {
      console.error("Failed to save impact:", error);
    });
  }

  // ====================================
  // UPDATE EXISTING HTML ELEMENTS
  // ====================================

  document.getElementById("knee").textContent = kneeAngle.toFixed(2);

  document.getElementById("acceleration").textContent = acceleration.toFixed(3);

  document.getElementById("impact").textContent = impact.toFixed(3);

  document.getElementById("impactDetected").textContent = impactDetected
    ? "YES"
    : "NO";

  document.getElementById("impactKnee").textContent = impactKnee.toFixed(2);

  document.getElementById("impactStrength").textContent =
    impactStrength.toFixed(3);

  // ====================================
  // UPDATE LAST FOOT STRIKE
  // ====================================

  if (impactDetected) {
    document.getElementById("impactKneeLarge").textContent =
      impactKnee.toFixed(1);

    document.getElementById("impactStrengthLarge").textContent =
      impactStrength.toFixed(2);
  }

  // ====================================
  // UPDATE GRAPH DATA
  // ====================================

  
kneeData.push(kneeAngle);

impactData.push(impact);

// Add a marker placeholder for the current measurement.
impactMarkers.push(false);

// When the 120 ms window finishes, go back and mark
// the measurement that actually had the highest impact.
if (impactDetected) {

  const peakIndex = footStrike.graphIndex;

  if (
    peakIndex >= 0 &&
    peakIndex < impactMarkers.length
  ) {

    impactMarkers[peakIndex] = true;

  }
}


  if (kneeData.length > MAX_POINTS) {
  kneeData.shift();
  impactData.shift();
  impactMarkers.shift();

  if (trackingImpact) {
    peakGraphIndex--;
  }
}

  // ====================================
  // DRAW GRAPHS
  // ====================================

  drawGraph(kneeCanvas, kneeCtx, kneeData, impactMarkers, 180, "deg");

  drawGraph(impactCanvas, impactCtx, impactData, impactMarkers, 3, "g");

  // ====================================
  // SERIAL-STYLE LOG
  // ====================================

  const time = new Date().toLocaleTimeString();

  const line =
    time +
    " | Knee=" +
    kneeAngle.toFixed(2) +
    " deg | Accel=" +
    acceleration.toFixed(3) +
    " g | Impact=" +
    impact.toFixed(3) +
    " g | Detected=" +
    (impactDetected ? "YES" : "NO") +
    " | Steps=" +
    activity.totalSteps;

  serialLines.push(line);

  if (serialLines.length > MAX_SERIAL_LINES) {
    serialLines.shift();
  }

  serialOutput.textContent = serialLines.join("\n");

  serialOutput.scrollTop = serialOutput.scrollHeight;
}

// =====================================================
// DRAW GRAPH
// =====================================================

function drawGraph(canvas, ctx, values, markers, maxValue, unit) {
  const width = canvas.width;

  const height = canvas.height;

  const left = 55;
  const right = 15;
  const top = 15;
  const bottom = 30;

  const graphWidth = width - left - right;

  const graphHeight = height - top - bottom;

  // Clear canvas.

  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = "#ffffff";

  ctx.fillRect(0, 0, width, height);

  // ====================================
  // GRID AND Y AXIS
  // ====================================

  ctx.strokeStyle = "#dddddd";

  ctx.lineWidth = 1;

  ctx.font = "12px Arial";

  ctx.fillStyle = "#555555";

  const divisions = 6;

  for (let i = 0; i <= divisions; i++) {
    const value = maxValue * (i / divisions);

    const y = top + graphHeight - (value / maxValue) * graphHeight;

    ctx.beginPath();

    ctx.moveTo(left, y);

    ctx.lineTo(width - right, y);

    ctx.stroke();

    ctx.fillText(value.toFixed(1) + " " + unit, 3, y + 4);
  }

  // ====================================
  // TIME LABELS
  // ====================================

  ctx.fillStyle = "#555555";

  ctx.fillText("Older", left, height - 8);

  ctx.fillText("Now", width - 40, height - 8);

  if (values.length < 2) {
    return;
  }

  // ====================================
  // DRAW SENSOR LINE
  // ====================================

  ctx.beginPath();

  ctx.strokeStyle = "#2563eb";

  ctx.lineWidth = 2;

  values.forEach((value, index) => {
    const x = left + (index / (MAX_POINTS - 1)) * graphWidth;

    const clampedValue = Math.min(Math.max(value, 0), maxValue);

    const y = top + graphHeight - (clampedValue / maxValue) * graphHeight;

    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });

  ctx.stroke();

  // ====================================
  // DRAW IMPACT MARKERS
  // ====================================

  values.forEach((value, index) => {
    if (!markers[index]) {
      return;
    }

    const x = left + (index / (MAX_POINTS - 1)) * graphWidth;

    const clampedValue = Math.min(Math.max(value, 0), maxValue);

    const y = top + graphHeight - (clampedValue / maxValue) * graphHeight;

    ctx.beginPath();

    ctx.fillStyle = "#ef4444";

    ctx.arc(x, y, 6, 0, Math.PI * 2);

    ctx.fill();
  });
}

// =====================================================
// INITIAL EMPTY GRAPHS
// =====================================================

drawGraph(kneeCanvas, kneeCtx, [], [], 180, "deg");

drawGraph(impactCanvas, impactCtx, [], [], 3, "g");

// =====================================================
// API FOR THE HIKE SESSION PAGE (hike-flow.js)
// =====================================================

window.HikingSensor = {
  connectToESP32,

  // startStepCounting({ name }) -> IndexedDB session id
  startStepCounting: startActivity,

  // stopStepCounting({ completed: true }) when the user finishes
  stopStepCounting: stopActivity,
};

// =====================================================
// EXPOSE ACTIVITY FUNCTIONS FOR TESTING
// =====================================================

// Allows testing from Chrome Developer Console
// without modifying index.html.

window.hikingActivity = {
  start: startActivity,

  stop: stopActivity,

  summary: getActivitySummary,

  calibrate: calibrateKnee,

  getReadings: () => activity.readings,

  getFootStrikes: () => activity.footStrikes,

  getAngles: () => ({
    thighAngle,
    shinAngle,
    kneeAngle,
    kneeZeroOffset,
  }),
};
