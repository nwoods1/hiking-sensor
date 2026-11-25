// Supabase access for the existing `hikes` table and `hike-data` bucket.
// Row level security restricts every query to the signed-in user.

import { fetch } from 'expo/fetch';

import { env, HIKE_DATA_BUCKET } from '@/config/env';
import { decodeCompactFile } from '@/hikes/compactFile';
import type { HikeStats, Impact } from '@/hikes/stats';
import type { HikeRow, RemoteHikeStore } from '@/sync/uploader';

import { accessToken, supabase } from './client';

export type RemoteHike = HikeStats & {
  id: string;
  user_id?: string;
  name: string | null;
  started_at: string;
  data_path: string;
};

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

export async function listHikes(): Promise<RemoteHike[]> {
  const { data, error } = await supabase.from('hikes').select('*').order('started_at', { ascending: false });
  if (error) throw new Error(errorMessage(error));
  return data as RemoteHike[];
}

export async function getHike(id: string): Promise<RemoteHike | null> {
  const { data, error } = await supabase.from('hikes').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(errorMessage(error));
  return data as RemoteHike | null;
}

// Download hike-data/<path> as raw bytes. Uses the Storage REST endpoint
// with expo/fetch so the body arrives as an ArrayBuffer, rather than going
// through React Native's Blob implementation.
export async function downloadHikeImpacts(dataPath: string): Promise<Impact[]> {
  const token = await accessToken();
  const objectPath = dataPath.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`${env.supabaseUrl}/storage/v1/object/authenticated/${HIKE_DATA_BUCKET}/${objectPath}`, {
    headers: { Authorization: `Bearer ${token}`, apikey: env.supabaseKey },
  });
  if (!response.ok) {
    throw new Error(`Could not download step data (HTTP ${response.status})`);
  }
  return decodeCompactFile(new Uint8Array(await response.arrayBuffer()));
}

function isAlreadyExists(error: unknown): boolean {
  const e = error as { statusCode?: string | number; status?: number; message?: string };
  return String(e?.statusCode) === '409' || e?.status === 409 || /already exists|duplicate/i.test(e?.message ?? '');
}

export const supabaseHikeStore: RemoteHikeStore = {
  async uploadFile(path, bytes) {
    // Exact-length ArrayBuffer: supabase-js uploads ArrayBuffers as-is in
    // React Native.
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const { error } = await supabase.storage
      .from(HIKE_DATA_BUCKET)
      .upload(path, body as ArrayBuffer, { contentType: 'application/gzip', upsert: false });
    if (!error) return 'created';
    // Same path = same hike from an earlier attempt; the content is
    // generated from the same finished local data.
    if (isAlreadyExists(error)) return 'exists';
    throw new Error(`Storage upload failed: ${errorMessage(error)}`);
  },

  async hikeExists(id) {
    const { data, error } = await supabase.from('hikes').select('id').eq('id', id).maybeSingle();
    if (error) throw new Error(errorMessage(error));
    return data != null;
  },

  async insertHike(row: HikeRow) {
    const { error } = await supabase.from('hikes').insert(row);
    if (!error) return 'created';
    if (error.code === '23505') return 'exists'; // unique_violation on id
    throw new Error(`Saving the hike summary failed: ${errorMessage(error)}`);
  },
};
