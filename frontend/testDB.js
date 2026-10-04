
import {
  openDatabase,
  createSession,
  saveReading,
  getSessionReadings,
  endSession
} from "./indexedDB.js";

async function testDatabase() {

  // 1. Initialize database
  await openDatabase();
  console.log("Database opened!");

  // 2. Simulate starting a hike
  const sessionId = await createSession();
  console.log("Created session:", sessionId);

  // 3. Simulate three sensor readings
  const fakeReadings = [
    { kneeAngle: 45, impact: 1.2 },
    { kneeAngle: 60, impact: 1.8 },
    { kneeAngle: 30, impact: 0.9 }
  ];

  for (const reading of fakeReadings) {
    await saveReading(sessionId, reading);
  }

  console.log("All readings saved!");

  // 4. Retrieve data from IndexedDB
  const storedData = await getSessionReadings(sessionId);

  console.log("Retrieved readings:", storedData);

  // 5. Simulate stopping the hike
  await endSession(sessionId);

  console.log("Session ended!");
}

testDatabase().catch(console.error);
