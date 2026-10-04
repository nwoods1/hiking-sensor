
const DB_NAME = "HikingDatabase";
const DB_VERSION = 1;

const SESSION_STORE = "sessions";
const READING_STORE = "readings";

// Save at most one reading every 100 ms (10 Hz).
const SAMPLE_INTERVAL = 100;

let db = null;

// Track sampling time for the active session.
let lastSampleTime = -Infinity;


// ======================================
// 1. OPEN DATABASE
// ======================================

export function openDatabase() {

  return new Promise((resolve, reject) => {

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {

      const database = event.target.result;

      // Hiking sessions
      if (!database.objectStoreNames.contains(SESSION_STORE)) {

        database.createObjectStore(SESSION_STORE, {
          keyPath: "id",
          autoIncrement: true
        });

      }

      // Sensor readings
      if (!database.objectStoreNames.contains(READING_STORE)) {

        const store = database.createObjectStore(READING_STORE, {
          keyPath: "id",
          autoIncrement: true
        });

        store.createIndex("sessionId", "sessionId", {
          unique: false
        });

      }

    };

    request.onsuccess = () => {

      db = request.result;

      resolve(db);

    };

    request.onerror = () => reject(request.error);

  });

}


// ======================================
// 2. CREATE HIKING SESSION
// ======================================

export async function createSession() {

  const database = db || await openDatabase();

  return new Promise((resolve, reject) => {

    const transaction = database.transaction(
      SESSION_STORE,
      "readwrite"
    );

    const store = transaction.objectStore(SESSION_STORE);

    const request = store.add({

      startTime: Date.now(),

      endTime: null,

      synced: false

    });

    request.onsuccess = () => {

      // Reset sampling for the new session.
      lastSampleTime = -Infinity;

      resolve(request.result);

    };

    request.onerror = () => reject(request.error);

  });

}


// ======================================
// 3. SAVE PROCESSED SENSOR READING
// ======================================

// Expected input:
// saveReading(sessionId, {
//   kneeAngle: kneeAngle,
//   kneeAcceleration: impact
// });


export async function saveReading(sessionId, reading, forceSave = false) {

  const now = Date.now();

  // Regular samples: maximum 10 Hz.
  // Detected impacts: always save.
  if (!forceSave && now - lastSampleTime < SAMPLE_INTERVAL) {
    return null;
  }

  // Reserve the sample time immediately to prevent
  // overlapping BLE notifications from saving duplicates.
  if (!forceSave) {
    lastSampleTime = now;
  }

  const database = db || await openDatabase();

  return new Promise((resolve, reject) => {

    const transaction = database.transaction(
      READING_STORE,
      "readwrite"
    );

    const store = transaction.objectStore(READING_STORE);

    const request = store.add({
      sessionId,
      timestamp: now,
      kneeAngle: reading.kneeAngle,
      kneeAcceleration: reading.kneeAcceleration
    });

    request.onsuccess = () => resolve(request.result);

    request.onerror = () => reject(request.error);

  });
}


// ======================================
// 4. RETRIEVE SESSION READINGS
// ======================================

export async function getSessionReadings(sessionId) {

  const database = db || await openDatabase();

  return new Promise((resolve, reject) => {

    const transaction = database.transaction(
      READING_STORE,
      "readonly"
    );

    const store = transaction.objectStore(READING_STORE);

    const index = store.index("sessionId");

    const request = index.getAll(sessionId);

    request.onsuccess = () => resolve(request.result);

    request.onerror = () => reject(request.error);

  });

}


// ======================================
// 5. END HIKING SESSION
// ======================================

export async function endSession(sessionId) {

  const database = db || await openDatabase();

  return new Promise((resolve, reject) => {

    const transaction = database.transaction(
      SESSION_STORE,
      "readwrite"
    );

    const store = transaction.objectStore(SESSION_STORE);

    const request = store.get(sessionId);

    request.onsuccess = () => {

      const session = request.result;

      if (!session) {
        reject(new Error("Session not found"));
        return;
      }

      session.endTime = Date.now();

      const updateRequest = store.put(session);

      updateRequest.onsuccess = () => {

        lastSampleTime = -Infinity;

        resolve(session);

      };

      updateRequest.onerror = () => reject(updateRequest.error);

    };

    request.onerror = () => reject(request.error);

  });

}
