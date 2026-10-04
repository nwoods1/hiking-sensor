// =====================================================
// BLE UUIDs
// =====================================================

const SERVICE_UUID = "12345678-1234-1234-1234-1234567890ab";

const CHARACTERISTIC_UUID = "abcdefab-1234-5678-1234-abcdefabcdef";

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

const kneeCtx = kneeCanvas?.getContext("2d");

const impactCanvas = document.getElementById("impactGraph");

const impactCtx = impactCanvas?.getContext("2d");

// Store the last 250 readings.
//
// Arduino sends about 50 readings / second,
// so this represents about 5 seconds.
const MAX_POINTS = 250;

// Serial-style log
const MAX_SERIAL_LINES = 100;

// Graph data
const kneeData = [];

const impactData = [];

// Stores whether an impact happened
// at each point on the graph
const impactMarkers = [];

const serialLines = [];
let stepCount = 0;
let isCountingSteps = false;
let impactSignalActive = false;

// =====================================================
// CONNECT BUTTON
// =====================================================

connectButton?.addEventListener("click", connectToESP32);
window.HikingSensor = {
  connectToESP32,
  startStepCounting,
  stopStepCounting,
};

function startStepCounting() {
  stepCount = 0;
  isCountingSteps = true;
  const stepCountElement = document.getElementById("step-count");
  if (stepCountElement) stepCountElement.textContent = String(stepCount);
}

function stopStepCounting() {
  isCountingSteps = false;
}

// mock esp32
function createMockDevice() {
  let connected = true;
  let timer;
  const disconnectListeners = new Set();

  const device = {
    name: "Mock ESP32",
    gatt: {
      get connected() {
        return connected;
      },
      disconnect() {
        if (!connected) return;
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

  let lastImpact = 0;
  timer = setInterval(() => {
    const elapsed = Date.now() / 1000;
    const kneeAngle = Math.round(3500 + Math.sin(elapsed * 2) * 1200);
    const impactDetected = Math.floor(elapsed / 5) > lastImpact ? 1 : 0;

    if (impactDetected) lastImpact = Math.floor(elapsed / 5);

    const packet = new DataView(new ArrayBuffer(12));
    packet.setInt16(0, kneeAngle, true);
    packet.setInt16(2, 1000 + Math.round(Math.sin(elapsed) * 100), true);
    packet.setInt16(4, impactDetected ? 350 : 30, true);
    packet.setInt16(6, impactDetected, true);
    packet.setInt16(8, kneeAngle, true);
    packet.setInt16(10, impactDetected ? 500 : 30, true);

    handleSensorData({ target: { value: packet } });
  }, 100);

  return device;
}

// =====================================================
// CONNECT TO ESP32
// =====================================================

async function connectToESP32() {

  if (new URLSearchParams(window.location.search).get("mockBluetooth") === "1") {
    statusText.textContent = "Connected to Mock ESP32 (test mode)";
    return createMockDevice();
  }

  try {
    statusText.textContent = "Searching for Bluetooth devices...";

    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,

      optionalServices: [SERVICE_UUID],
    });

    statusText.textContent = "Connecting...";

    const server = await device.gatt.connect();

    const service = await server.getPrimaryService(SERVICE_UUID);

    const characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);

    await characteristic.startNotifications();

    characteristic.addEventListener(
      "characteristicvaluechanged",
      handleSensorData,
    );

    statusText.textContent = "Connected to " + (device.name || "ESP32");
    return device;
  } catch (error) {
    console.error(error);

    statusText.textContent = "Connection failed: " + error.message;
    return null;
  }
}

// =====================================================
// RECEIVE BLE SENSOR DATA
// =====================================================

function handleSensorData(event) {
  const data = event.target.value;

  // Arduino sends 6 int16_t numbers.
  //
  // 6 × 2 bytes = 12 bytes.
  if (data.byteLength < 12) {
    return;
  }

  // ===================================================
  // DECODE BLE PACKET
  // ===================================================

  const kneeAngle = data.getInt16(0, true) / 100;

  const acceleration = data.getInt16(2, true) / 1000;

  const impact = data.getInt16(4, true) / 1000;

  const impactDetected = data.getInt16(6, true);
  const hasImpact = impactDetected === 1;

  if (isCountingSteps && hasImpact && !impactSignalActive) {
    stepCount += 1;
    const stepCountElement = document.getElementById("step-count");
    if (stepCountElement) stepCountElement.textContent = String(stepCount);
  }
  impactSignalActive = hasImpact;

  const impactKnee = data.getInt16(8, true) / 100;

  const impactStrength = data.getInt16(10, true) / 1000;

  // ===================================================
  // UPDATE LIVE NUMBERS
  // ===================================================

  const kneeValue = document.getElementById("knee");
  if (kneeValue) kneeValue.textContent = kneeAngle.toFixed(2);

  const accelerationValue = document.getElementById("acceleration");
  if (accelerationValue) accelerationValue.textContent = acceleration.toFixed(3);

  const impactValue = document.getElementById("impact");
  if (impactValue) impactValue.textContent = impact.toFixed(3);

  const impactDetectedValue = document.getElementById("impactDetected");
  if (impactDetectedValue) {
    impactDetectedValue.textContent = impactDetected === 1 ? "YES" : "NO";
  }

  const impactKneeValue = document.getElementById("impactKnee");
  if (impactKneeValue) impactKneeValue.textContent = impactKnee.toFixed(2);

  const impactStrengthValue = document.getElementById("impactStrength");
  if (impactStrengthValue) {
    impactStrengthValue.textContent = impactStrength.toFixed(3);
  }

  // ===================================================
  // NEW FOOT STRIKE
  // ===================================================

  if (hasImpact) {
    const impactKneeLarge = document.getElementById("impactKneeLarge");
    if (impactKneeLarge) impactKneeLarge.textContent = impactKnee.toFixed(1);

    const impactStrengthLarge = document.getElementById("impactStrengthLarge");
    if (impactStrengthLarge) {
      impactStrengthLarge.textContent = impactStrength.toFixed(2);
    }
  }

  // ===================================================
  // ADD VALUES TO GRAPH
  // ===================================================

  kneeData.push(kneeAngle);

  impactData.push(impact);

  impactMarkers.push(hasImpact);

  // Only keep the newest 250 values.
  //
  // This makes the graph continuously scroll.
  if (kneeData.length > MAX_POINTS) {
    kneeData.shift();

    impactData.shift();

    impactMarkers.shift();
  }

  // ===================================================
  // DRAW KNEE GRAPH
  // ===================================================

  if (kneeCanvas && kneeCtx) {
    drawGraph(kneeCanvas, kneeCtx, kneeData, impactMarkers, 120, "deg");
  }

  // ===================================================
  // DRAW IMPACT GRAPH
  // ===================================================

  if (impactCanvas && impactCtx) {
    drawGraph(impactCanvas, impactCtx, impactData, impactMarkers, 3, "g");
  }

  // ===================================================
  // SERIAL-STYLE LOG
  // ===================================================

  const time = new Date().toLocaleTimeString();

  const line =
    time +
    " | Knee=" +
    kneeAngle.toFixed(2) +
    " deg" +
    " | Accel=" +
    acceleration.toFixed(3) +
    " g" +
    " | Impact=" +
    impact.toFixed(3) +
    " g" +
    " | Detected=" +
    (impactDetected === 1 ? "YES" : "NO") +
    " | LastImpactKnee=" +
    impactKnee.toFixed(2) +
    " deg" +
    " | LastImpactAccel=" +
    impactStrength.toFixed(3) +
    " g";

  serialLines.push(line);

  if (serialLines.length > MAX_SERIAL_LINES) {
    serialLines.shift();
  }

  if (serialOutput) {
    serialOutput.textContent = serialLines.join("\n");
    serialOutput.scrollTop = serialOutput.scrollHeight;
  }
}

// =====================================================
// DRAW LIVE GRAPH
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

  // Clear previous graph
  ctx.clearRect(0, 0, width, height);

  // White background
  ctx.fillStyle = "#ffffff";

  ctx.fillRect(0, 0, width, height);

  // ===================================================
  // GRID + Y AXIS
  // ===================================================

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

    ctx.fillText(
      value.toFixed(1) + " " + unit,

      3,

      y + 4,
    );
  }

  // ===================================================
  // TIME LABELS
  // ===================================================

  ctx.fillStyle = "#555555";

  ctx.fillText("Older", left, height - 8);

  ctx.fillText("Now", width - 40, height - 8);

  // No sensor data yet
  if (values.length < 2) {
    return;
  }

  // ===================================================
  // DRAW SENSOR LINE
  // ===================================================

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

  // ===================================================
  // DRAW IMPACT MARKERS
  // ===================================================

  values.forEach((value, index) => {
    // Only draw a dot if the Arduino
    // reported an impact at this reading.
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
// DRAW EMPTY GRAPHS ON PAGE LOAD
// =====================================================

drawGraph(kneeCanvas, kneeCtx, [], [], 120, "deg");

drawGraph(impactCanvas, impactCtx, [], [], 3, "g");
