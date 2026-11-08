import { config } from './config.js';

/**
 * One clock for the whole process. `DEMO_CLOCK` freezes it so the demo tells the
 * same story every time — 21:40, with two medications still due.
 */
export function now(): Date {
  const override = config.demoClock;
  if (!override) return new Date();

  if (/^\d{2}:\d{2}$/.test(override)) {
    const [hours, minutes] = override.split(':').map(Number) as [number, number];
    const today = new Date();
    today.setHours(hours, minutes, 0, 0);
    return today;
  }

  return new Date(override);
}

/** Local calendar day, e.g. `2026-11-08`. */
export function todayKey(at: Date = now()): string {
  const year = at.getFullYear();
  const month = `${at.getMonth() + 1}`.padStart(2, '0');
  const day = `${at.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Validate a `YYYY-MM-DD` day key and confirm it is a real calendar date. */
export function isDayKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const stamp = new Date(year, month - 1, day, 12, 0, 0, 0);
  return stamp.getFullYear() === year && stamp.getMonth() === month - 1 && stamp.getDate() === day;
}

/** ISO timestamp for a local wall-clock time on a given calendar day. */
export function atLocalTime(dayKey: string, time: string): string {
  const [year, month, day] = dayKey.split('-').map(Number) as [number, number, number];
  const [hours, minutes] = time.split(':').map(Number) as [number, number];
  const stamp = new Date(year, month - 1, day, hours, minutes, 0, 0);
  return stamp.toISOString();
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function formatClock(at: Date = now()): string {
  return at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function minutesUntil(iso: string, at: Date = now()): number {
  return Math.round((new Date(iso).getTime() - at.getTime()) / 60_000);
}

export function addMinutes(at: Date, minutes: number): Date {
  return new Date(at.getTime() + minutes * 60_000);
}

export function timeAgo(iso: string, at: Date = now()): string {
  const minutes = Math.max(0, Math.round((at.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}
