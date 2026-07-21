import { describe, it, expect } from 'vitest';
import {
  nextDrawingForSlot, nextDrawing, describeSchedule, formatCountdown, DRAW_SCHEDULE,
} from './schedule.js';
import { GAME_LIST } from './games.js';

/** A fixed instant: Tue 21 Jul 2026, 10:00 EDT (14:00 UTC). */
const TUE_10AM_ET = new Date('2026-07-21T14:00:00Z');

describe('drawing schedule', () => {
  it('covers every game and every declared slot', () => {
    for (const game of GAME_LIST) {
      const slots = DRAW_SCHEDULE[game.id];
      expect(slots, game.name).toBeDefined();
      for (const slot of game.slots) {
        expect(slots[slot], `${game.name}/${slot}`).toBeDefined();
      }
    }
  });

  it('finds the next Pick 3 midday drawing later the same day', () => {
    const next = nextDrawingForSlot('pick3', 'midday', TUE_10AM_ET)!;
    expect(next.drawDate).toBe('2026-07-21');
    expect(next.timeLabel).toBe('1:30 PM ET');
    expect(next.msUntil).toBeGreaterThan(0);
  });

  it('rolls to tomorrow once the day\'s drawing has passed', () => {
    // 11pm ET Tuesday — the 1:30pm midday drawing is long gone.
    const late = new Date('2026-07-22T03:00:00Z');
    const next = nextDrawingForSlot('pick3', 'midday', late)!;
    expect(next.drawDate).toBe('2026-07-22');
  });

  it('skips to the correct weekday for twice-weekly games', () => {
    // Powerball draws Mon/Wed/Sat. From Tuesday morning the next is Wednesday.
    const next = nextDrawingForSlot('powerball', 'main', TUE_10AM_ET)!;
    expect(next.drawDate).toBe('2026-07-22');
    expect(next.timeLabel).toBe('10:59 PM ET');
  });

  it('Mega Millions draws Tuesday and Friday', () => {
    const next = nextDrawingForSlot('megamillions', 'main', TUE_10AM_ET)!;
    expect(next.drawDate).toBe('2026-07-21'); // same Tuesday, 11pm
    const afterTue = nextDrawingForSlot('megamillions', 'main', new Date('2026-07-22T06:00:00Z'))!;
    expect(afterTue.drawDate).toBe('2026-07-24'); // Friday
  });

  it('picks the soonest slot across a multi-draw game', () => {
    // Cash Pop draws 5x daily; at 10am ET the next is the 11:45am matinee.
    const next = nextDrawing('cashpop', TUE_10AM_ET)!;
    expect(next.slot).toBe('matinee');
    expect(next.drawDate).toBe('2026-07-21');
  });

  /**
   * Drawing times are Florida wall-clock. If the arithmetic were done in UTC or
   * in the viewer's zone, this would drift by an hour for half the year.
   */
  it('holds the same Florida wall-clock time across a DST boundary', () => {
    const summer = nextDrawingForSlot('pick3', 'evening', new Date('2026-07-01T12:00:00Z'))!;
    const winter = nextDrawingForSlot('pick3', 'evening', new Date('2026-12-01T12:00:00Z'))!;
    expect(summer.timeLabel).toBe('9:45 PM ET');
    expect(winter.timeLabel).toBe('9:45 PM ET');

    // EDT is UTC-4, EST is UTC-5, so the UTC hour must differ by exactly one.
    expect(summer.at.getUTCHours()).toBe(1);  // 21:45 EDT -> 01:45 UTC next day
    expect(winter.at.getUTCHours()).toBe(2);  // 21:45 EST -> 02:45 UTC next day
  });

  it('always returns a drawing in the future', () => {
    const now = new Date();
    for (const game of GAME_LIST) {
      const next = nextDrawing(game.id, now);
      expect(next, game.name).not.toBeNull();
      expect(next!.at.getTime(), game.name).toBeGreaterThan(now.getTime());
      expect(next!.msUntil, game.name).toBeGreaterThan(0);
    }
  });

  it('never proposes a drawing more than a week out', () => {
    const now = new Date();
    for (const game of GAME_LIST) {
      expect(nextDrawing(game.id, now)!.msUntil, game.name).toBeLessThan(8 * 86_400_000);
    }
  });

  it('describes schedules in plain language', () => {
    expect(describeSchedule('pick3')).toBe('Daily at 1:30 PM and 9:45 PM ET');
    expect(describeSchedule('powerball')).toMatch(/Monday, Wednesday, Saturday/);
    expect(describeSchedule('megamillions')).toBe('Tuesday, Friday at 11:00 PM ET');
  });

  it('formats countdowns readably', () => {
    expect(formatCountdown(30_000)).toBe('in under a minute');
    expect(formatCountdown(25 * 60_000)).toBe('in 25m');
    expect(formatCountdown(3 * 3_600_000 + 12 * 60_000)).toBe('in 3h 12m');
    expect(formatCountdown(26 * 3_600_000)).toBe('tomorrow');
    expect(formatCountdown(3 * 86_400_000)).toBe('in 3 days');
  });
});

