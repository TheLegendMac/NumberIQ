import { describe, expect, it } from 'vitest';
import {
  compareWatermarks,
  readLiveWatermarks,
  type DataWatermark,
} from './verify-live-watermarks.js';

const local: DataWatermark[] = [
  { gameId: 'powerball', slot: 'double_play', last: '2026-07-20' },
  { gameId: 'powerball', slot: 'main', last: '2026-07-20' },
];

describe('live data watermark verification', () => {
  it('accepts matching per-game/per-slot dates', () => {
    const live = readLiveWatermarks([
      {
        id: 'powerball',
        data: [
          { slot: 'main', count: 100, first: '2021-08-23', last: '2026-07-20' },
          { slot: 'double_play', count: 100, first: '2021-08-23', last: '2026-07-20' },
        ],
      },
    ]);

    expect(compareWatermarks(local, live)).toEqual([]);
  });

  it('reports stale, missing, and unexpected live summaries', () => {
    const live: DataWatermark[] = [
      { gameId: 'powerball', slot: 'main', last: '2026-07-18' },
      { gameId: 'powerball', slot: 'bonus', last: '2026-07-20' },
    ];

    expect(compareWatermarks(local, live)).toEqual([
      {
        gameId: 'powerball',
        slot: 'bonus',
        local: null,
        live: '2026-07-20',
      },
      {
        gameId: 'powerball',
        slot: 'double_play',
        local: '2026-07-20',
        live: null,
      },
      {
        gameId: 'powerball',
        slot: 'main',
        local: '2026-07-20',
        live: '2026-07-18',
      },
    ]);
  });

  it('rejects malformed and duplicate live summaries', () => {
    expect(() => readLiveWatermarks({})).toThrow('response is not an array');
    expect(() => readLiveWatermarks([{ id: 'powerball', data: [{ slot: 'main' }] }]))
      .toThrow('last is not an ISO date');
    expect(() => readLiveWatermarks([{
      id: 'powerball',
      data: [
        { slot: 'main', last: '2026-07-20' },
        { slot: 'main', last: '2026-07-20' },
      ],
    }])).toThrow('duplicate data for powerball/main');
  });
});
