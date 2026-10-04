// hike-sync.js (module)
// Uploads finished hikes from IndexedDB to Supabase.
// Needs these classic scripts loaded first: supabase-config.js (`sb`),
// stats.js (`computeStats`) and hikeStorage.js (`saveHike`).

import {
  getSession,
  getSessionReadings,
  getUnsyncedSessions,
  markSessionSynced
} from "./indexedDB.js";

// One upload per session at a time, so a finish click and the
// background retry can't save the same hike twice.
const uploads = new Map();

export function uploadSession(sessionId) {
  if (!uploads.has(sessionId)) {
    uploads.set(
      sessionId,
      upload(sessionId).finally(() => uploads.delete(sessionId))
    );
  }
  return uploads.get(sessionId);
}

async function upload(sessionId) {
  const session = await getSession(sessionId);
  if (!session) throw new Error("Hike session not found on this device");
  if (session.synced) return session.hikeId;
  if (!session.endTime) throw new Error("Hike has not finished yet");

  // IndexedDB readings -> the { t, accel, angle } impacts saveHike expects,
  // with t in ms since the start of the hike.
  const readings = await getSessionReadings(sessionId);
  const impacts = readings.map((reading) => ({
    t: reading.timestamp - session.startTime,
    accel: reading.kneeAcceleration,
    angle: reading.kneeAngle
  }));

  const hikeId = await saveHike(impacts, {
    startedAt: session.startTime,
    durationMs: session.endTime - session.startTime,
    stepThreshold: session.stepThreshold,
    highThreshold: session.highThreshold,
    name: session.name
  });

  await markSessionSynced(sessionId, hikeId);
  return hikeId;
}

// Retry hikes whose upload failed earlier (offline, signed out, ...).
export async function syncPendingSessions() {
  const sessions = await getUnsyncedSessions();
  for (const session of sessions) {
    try {
      const hikeId = await uploadSession(session.id);
      console.log("Uploaded pending hike:", session.id, "->", hikeId);
    } catch (error) {
      console.warn("Pending hike still not uploaded:", session.id, error);
    }
  }
}

window.HikeSync = { uploadSession, syncPendingSessions };

syncPendingSessions().catch((error) =>
  console.error("Could not check for pending hikes:", error)
);
