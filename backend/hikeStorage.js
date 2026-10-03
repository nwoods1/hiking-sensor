// hikeStorage.js
import { supabase } from './supabase';
import { computeStats } from './stats';

async function gzipJson(obj) {
  const stream = new Blob([JSON.stringify(obj)]).stream()
    .pipeThrough(new CompressionStream('gzip'));
  return await new Response(stream).blob();
}

async function gunzipJson(blob) {
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).json();
}

export async function saveHike(impacts, { startedAt, durationMs, stepThreshold, highThreshold, name }) {
  const id = crypto.randomUUID();
  const path = `${id}.json.gz`;

  // 1. build the compact file: parallel arrays, rounded values
  const file = {
    v: 1,
    t: impacts.map(i => Math.round(i.t)),                 // ms since start
    accel: impacts.map(i => +i.accel.toFixed(2)),
    angle: impacts.map(i => +i.angle.toFixed(1)),
  };
  const blob = await gzipJson(file);

  // 2. upload it
  const { error: upErr } = await supabase.storage
    .from('hike-data')
    .upload(path, blob, { contentType: 'application/gzip' });
  if (upErr) throw upErr;

  // 3. compute stats and insert the row
  const stats = computeStats(impacts, { durationMs, stepThreshold, highThreshold });
  const { error: dbErr } = await supabase.from('hikes').insert({
    id,
    name: name ?? null,
    started_at: new Date(startedAt).toISOString(),
    data_path: path,
    ...stats,
  });

  if (dbErr) {
    await supabase.storage.from('hike-data').remove([path]);  // don't leave orphan files
    throw dbErr;
  }
  return id;
}

// list page: summaries only, no file downloads
export async function listHikes() {
  const { data, error } = await supabase
    .from('hikes').select('*').order('started_at', { ascending: false });
  if (error) throw error;
  return data;
}

// detail page: row + full impact data rebuilt into objects
export async function loadHike(id) {
  const { data: hike, error } = await supabase
    .from('hikes').select('*').eq('id', id).single();
  if (error) throw error;

  const { data: blob, error: dlErr } = await supabase.storage
    .from('hike-data').download(hike.data_path);
  if (dlErr) throw dlErr;

  const f = await gunzipJson(blob);
  const impacts = f.t.map((t, i) => ({ t, accel: f.accel[i], angle: f.angle[i] }));
  return { hike, impacts };
}