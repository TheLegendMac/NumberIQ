/**
 * Florida Lottery drawing schedule.
 *
 * Every drawing happens on Florida time, so all arithmetic here is done in
 * `America/New_York` and converted to the viewer's local zone only for display.
 * Doing it the other way around silently breaks twice a year at DST boundaries,
 * and breaks permanently for anyone outside Eastern time.
 *
 * Times are as published by the Florida Lottery. They do change occasionally —
 * `SCHEDULE_VERIFIED` records when these were last checked, and the UI surfaces
 * that rather than presenting them as permanently authoritative.
 */
import type { GameId } from './types.js';

export const SCHEDULE_VERIFIED = '2026-07-21';
export const LOTTERY_TIMEZONE = 'America/New_York';

/** 0 = Sunday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
const DAILY: Weekday[] = [0, 1, 2, 3, 4, 5, 6];

export interface SlotSchedule {
  /** Days this slot draws on. */
  days: Weekday[];
  /** Drawing time in Florida local time. */
  hour: number;
  minute: number;
}

/** Per game, per draw slot. */
export const DRAW_SCHEDULE: Record<GameId, Record<string, SlotSchedule>> = {
  pick2: {
    midday: { days: DAILY, hour: 13, minute: 30 },
    evening: { days: DAILY, hour: 21, minute: 45 },
  },
  pick3: {
    midday: { days: DAILY, hour: 13, minute: 30 },
    evening: { days: DAILY, hour: 21, minute: 45 },
  },
  pick4: {
    midday: { days: DAILY, hour: 13, minute: 30 },
    evening: { days: DAILY, hour: 21, minute: 45 },
  },
  pick5: {
    midday: { days: DAILY, hour: 13, minute: 30 },
    evening: { days: DAILY, hour: 21, minute: 45 },
  },
  fantasy5: {
    midday: { days: DAILY, hour: 13, minute: 5 },
    evening: { days: DAILY, hour: 23, minute: 15 },
  },
  cashpop: {
    morning: { days: DAILY, hour: 8, minute: 45 },
    matinee: { days: DAILY, hour: 11, minute: 45 },
    afternoon: { days: DAILY, hour: 14, minute: 45 },
    evening: { days: DAILY, hour: 18, minute: 45 },
    late_night: { days: DAILY, hour: 23, minute: 45 },
  },
  lotto: {
    // Wednesday and Saturday. Double Play is drawn immediately after.
    main: { days: [3, 6], hour: 23, minute: 15 },
    double_play: { days: [3, 6], hour: 23, minute: 20 },
  },
  jackpot_triple_play: {
    main: { days: [2, 5], hour: 23, minute: 15 },
  },
  megamillions: {
    main: { days: [2, 5], hour: 23, minute: 0 },
  },
  powerball: {
    // Monday, Wednesday, Saturday. Double Play is drawn immediately after.
    main: { days: [1, 3, 6], hour: 22, minute: 59 },
    double_play: { days: [1, 3, 6], hour: 23, minute: 4 },
  },
};

/** Milliseconds that `tz` is offset from UTC at a given instant. */
function tzOffsetMs(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
  const asUtc = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour) % 24, Number(p.minute), Number(p.second),
  );
  return asUtc - date.getTime();
}

/**
 * Convert a Florida wall-clock time to a real instant.
 * Applied twice so the result is correct across DST transitions, where the
 * offset at the naive guess differs from the offset at the true instant.
 */
function floridaTimeToInstant(y: number, m: number, d: number, hh: number, mm: number): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const firstPass = guess - tzOffsetMs(new Date(guess), LOTTERY_TIMEZONE);
  const offset = tzOffsetMs(new Date(firstPass), LOTTERY_TIMEZONE);
  return new Date(guess - offset);
}

/** Calendar parts of an instant, as seen in Florida. */
function floridaParts(date: Date): { y: number; m: number; d: number; weekday: Weekday } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: LOTTERY_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
  const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday ?? 'Sun');
  return {
    y: Number(p.year), m: Number(p.month), d: Number(p.day),
    weekday: (weekdayIndex < 0 ? 0 : weekdayIndex) as Weekday,
  };
}

/**
 * The calendar date of an instant *in Florida*, as `yyyy-mm-dd`.
 *
 * This is the only correct way to compare a wall-clock instant against a
 * `drawDate`, which is always a Florida date. Slicing an ISO timestamp yields a
 * UTC date instead, which runs a day ahead of Florida every evening — so an
 * evening drawing would be judged to have happened "tomorrow".
 */
export function floridaDate(date = new Date()): string {
  const { y, m, d } = floridaParts(date);
  return `${y}-${pad(m)}-${pad(d)}`;
}

export interface NextDrawing {
  /** ISO date of the drawing, in Florida terms — the key used for tickets. */
  drawDate: string;
  slot: string;
  /** The actual instant the drawing happens. */
  at: Date;
  msUntil: number;
  /** Drawing time rendered in Florida time, e.g. "9:45 PM ET". */
  timeLabel: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

function formatTime(hour: number, minute: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${pad(minute)} ${hour < 12 ? 'AM' : 'PM'} ET`;
}

/** The next drawing for one slot, searching forward up to two weeks. */
export function nextDrawingForSlot(gameId: GameId, slot: string, now = new Date()): NextDrawing | null {
  const schedule = DRAW_SCHEDULE[gameId]?.[slot];
  if (!schedule) return null;

  for (let offset = 0; offset < 15; offset++) {
    const probe = new Date(now.getTime() + offset * 86_400_000);
    const { y, m, d, weekday } = floridaParts(probe);
    if (!schedule.days.includes(weekday)) continue;

    const at = floridaTimeToInstant(y, m, d, schedule.hour, schedule.minute);
    if (at.getTime() <= now.getTime()) continue;

    return {
      drawDate: `${y}-${pad(m)}-${pad(d)}`,
      slot,
      at,
      msUntil: at.getTime() - now.getTime(),
      timeLabel: formatTime(schedule.hour, schedule.minute),
    };
  }
  return null;
}

/** The soonest upcoming drawing across every slot of a game. */
export function nextDrawing(gameId: GameId, now = new Date()): NextDrawing | null {
  const slots = Object.keys(DRAW_SCHEDULE[gameId] ?? {});
  let best: NextDrawing | null = null;
  for (const slot of slots) {
    const candidate = nextDrawingForSlot(gameId, slot, now);
    if (candidate && (!best || candidate.at < best.at)) best = candidate;
  }
  return best;
}

/** Human countdown, e.g. "in 3h 12m" or "in 2 days". */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return 'now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'in under a minute';
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'tomorrow' : `in ${days} days`;
}

/** Plain-language schedule for a game, e.g. "Daily at 1:30 PM and 9:45 PM ET". */
export function describeSchedule(gameId: GameId): string {
  const slots = DRAW_SCHEDULE[gameId];
  if (!slots) return '';
  const entries = Object.values(slots);
  if (entries.length === 0) return '';

  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const days = entries[0]!.days;
  const dayLabel = days.length === 7 ? 'Daily' : days.map((d) => names[d]).join(', ');
  const times = entries.map((e) => formatTime(e.hour, e.minute).replace(' ET', ''));
  const timeLabel = times.length === 1
    ? times[0]
    : `${times.slice(0, -1).join(', ')} and ${times[times.length - 1]}`;
  return `${dayLabel} at ${timeLabel} ET`;
}
