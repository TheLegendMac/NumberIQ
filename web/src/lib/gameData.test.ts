import { describe, expect, it } from 'vitest';
import { latestDataDate, latestResultSlot } from './gameData.js';

describe('game data presentation', () => {
  const tiedPowerball = {
    slots: ['main', 'double_play'],
    data: [
      { slot: 'double_play', count: 20, last: '2026-07-20' },
      { slot: 'main', count: 20, last: '2026-07-20' },
    ],
  };

  it('prefers the primary drawing when latest result dates tie', () => {
    expect(latestResultSlot(tiedPowerball)).toBe('main');
  });

  it('still uses an alternate drawing when it is genuinely newer', () => {
    expect(latestResultSlot({
      ...tiedPowerball,
      data: [
        { slot: 'main', count: 20, last: '2026-07-18' },
        { slot: 'double_play', count: 21, last: '2026-07-20' },
      ],
    })).toBe('double_play');
  });

  it('reports freshness overall or for a requested slot', () => {
    expect(latestDataDate(tiedPowerball.data)).toBe('2026-07-20');
    expect(latestDataDate(tiedPowerball.data, 'main')).toBe('2026-07-20');
    expect(latestDataDate([{ slot: 'main', count: 0, last: '2026-07-21' }])).toBeNull();
  });
});
