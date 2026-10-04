import { supabase } from "./supabase.js";
import { saveHike, loadHike } from "./hikeStorage.js";

function fakeHike(minutes = 30){
    const impacts = [];
    for (let t = 0; t < minutes * 60000; t += 9000 + Math.random() * 300){
        const fatigue = 1 + (t/(minutes * 60000)) * 0.3;

        impacts.push({
            t,
            accel : (1.5 + Math.random() * 1.5) * fatigue,
            angle: 10 + Math.random() * 25,
        })
    }

    return impacts;
}


const impacts = fakeHike(30);
const id = await saveHike(impacts, {
    startedAt: Date.now(),
    durationMs: 30 * 60000,
    stepThreshold: 1.5,
    highThreshold: 3.5,
    name: 'Test hike',
});

console.log(await loadHike(id));