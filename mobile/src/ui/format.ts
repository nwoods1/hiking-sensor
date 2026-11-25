// Formatting helpers matching the web app (dashboard.js / hike-detail.js).

export const DASH = '–';

export function show(value: number | null | undefined, unit = ''): string {
  return value == null ? DASH : `${value}${unit}`;
}

export function fixed(value: number | null | undefined, digits: number, unit = ''): string {
  return value == null || !Number.isFinite(value) ? DASH : `${value.toFixed(digits)}${unit}`;
}

// 4520 -> "1:15:20", 95 -> "1:35"
export function clock(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null) return DASH;
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

// 4520 -> "01:15:20" (live timer)
export function timer(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}

// 4520 -> "1h 15m"
export function longDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null) return DASH;
  const s = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const fullDateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' });

export function formatDateTime(value: number | string): string {
  return dateTime.format(new Date(value));
}

export function formatFullDateTime(value: number | string): string {
  return fullDateTime.format(new Date(value));
}
