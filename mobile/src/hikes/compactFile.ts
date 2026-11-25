// The per-hike data file stored in the Supabase `hike-data` bucket at
// `<user id>/<hike id>.json.gz`. Format (frontend/hikeStorage.js):
//
//   gzip(JSON.stringify({ v: 1, t: [...], accel: [...], angle: [...] }))
//
// Parallel arrays, one entry per detected step: t = ms since the hike
// started (integer), accel = impact proxy in g (2 dp), angle = knee angle
// in deg (1 dp). The browser used CompressionStream('gzip'); pako produces
// standard gzip that both sides can read.

import { gzip, inflate } from 'pako';

import type { Impact } from './stats';

export const COMPACT_FILE_VERSION = 1;

export type CompactFile = {
  v: number;
  t: number[];
  accel: number[];
  angle: number[];
};

export function toCompactFile(impacts: Impact[]): CompactFile {
  return {
    v: COMPACT_FILE_VERSION,
    t: impacts.map((i) => Math.round(i.t)),
    accel: impacts.map((i) => +i.accel.toFixed(2)),
    angle: impacts.map((i) => +i.angle.toFixed(1)),
  };
}

export function encodeCompactFile(impacts: Impact[]): Uint8Array {
  return gzip(JSON.stringify(toCompactFile(impacts)));
}

function asciiDecode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return out;
}

// Accepts gzip bytes, or plain JSON bytes in case an HTTP layer already
// decompressed the body.
export function decodeCompactFile(bytes: Uint8Array): Impact[] {
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  // The JSON is plain ASCII (numbers and keys), so the non-gzip branch
  // doesn't need a full UTF-8 decoder (TextDecoder isn't in every Hermes).
  const text = isGzip ? inflate(bytes, { toText: true }) : asciiDecode(bytes);
  const file = JSON.parse(text) as Partial<CompactFile>;

  if (file.v !== COMPACT_FILE_VERSION) {
    throw new Error(`Unsupported hike data version: ${String(file.v)}`);
  }
  if (!Array.isArray(file.t) || !Array.isArray(file.accel) || !Array.isArray(file.angle)) {
    throw new Error('Hike data file is malformed');
  }
  const { t, accel, angle } = file;
  return t.map((time, i) => ({ t: time, accel: accel[i], angle: angle[i] }));
}
