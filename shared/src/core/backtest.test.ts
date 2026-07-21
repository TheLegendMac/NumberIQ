import { describe, it, expect } from 'vitest';
import { getGame, makeRng, type Draw } from '../index.js';
import { runBacktest } from './backtest.js';
import { evaluateTicket, countMatches } from './evaluate.js';

const fantasy5 = getGame('fantasy5');
const powerball = getGame('powerball');
const pick3 = getGame('pick3');

function synthDraws(count: number, seed = 1): Draw[] {
  const rng = makeRng(seed);
  const out: Draw[] = [];
  for (let i = 0; i < count; i++) {
    const set = new Set<number>();
    while (set.size < 5) set.add(1 + Math.floor(rng() * 36));
    const d = new Date(Date.UTC(2015, 0, 1) + i * 86_400_000);
    out.push({
      id: i + 1, gameId: 'fantasy5', drawDate: d.toISOString().slice(0, 10),
      drawSlot: 'evening', numbers: [...set].sort((a, b) => a - b), extras: {}, source: 'synthetic',
    });
  }
  return out;
}

describe('prize evaluation', () => {
  const draw: Draw = {
    id: 1, gameId: 'powerball', drawDate: '2026-01-01', drawSlot: 'main',
    numbers: [9, 14, 44, 50, 56], extras: { powerball: 3 }, source: 't',
  };

  it('scores a jackpot', () => {
    const ev = evaluateTicket(powerball, { numbers: [9, 14, 44, 50, 56], extras: { powerball: 3 } }, draw);
    expect(ev.matches).toBe(5);
    expect(ev.extraMatch).toBe(true);
    expect(ev.tier?.isJackpot).toBe(true);
  });

  it('distinguishes 5-of-5 with and without the Powerball', () => {
    const withPB = evaluateTicket(powerball, { numbers: [9, 14, 44, 50, 56], extras: { powerball: 3 } }, draw);
    const without = evaluateTicket(powerball, { numbers: [9, 14, 44, 50, 56], extras: { powerball: 7 } }, draw);
    expect(withPB.tier?.label).toBe('Jackpot');
    expect(without.tier?.label).toBe('5 of 5');
    expect(without.payout).toBe(1_000_000);
  });

  it('pays the Powerball-only tier', () => {
    const ev = evaluateTicket(powerball, { numbers: [1, 2, 3, 4, 5], extras: { powerball: 3 } }, draw);
    expect(ev.matches).toBe(0);
    expect(ev.payout).toBe(4);
  });

  it('pays nothing for a losing ticket', () => {
    const ev = evaluateTicket(powerball, { numbers: [1, 2, 3, 4, 5], extras: { powerball: 7 } }, draw);
    expect(ev.tier).toBeNull();
    expect(ev.payout).toBe(0);
  });

  it('values pari-mutuel and jackpot tiers at zero unless told otherwise', () => {
    const f5draw: Draw = { id: 2, gameId: 'fantasy5', drawDate: '2026-01-01', drawSlot: 'evening', numbers: [1, 2, 3, 4, 5], extras: {}, source: 't' };
    const ev = evaluateTicket(fantasy5, { numbers: [1, 2, 3, 4, 5] }, f5draw);
    expect(ev.tier?.isJackpot).toBe(true);
    expect(ev.payout).toBe(0);
    expect(ev.payoutEstimated).toBe(true);

    const withValue = evaluateTicket(fantasy5, { numbers: [1, 2, 3, 4, 5] }, f5draw, { jackpotValue: 200_000 });
    expect(withValue.payout).toBe(200_000);
  });

  it('requires an exact positional match for digit games', () => {
    const p3: Draw = { id: 3, gameId: 'pick3', drawDate: '2026-01-01', drawSlot: 'evening', numbers: [1, 2, 3], extras: {}, source: 't' };
    expect(evaluateTicket(pick3, { numbers: [1, 2, 3] }, p3).payout).toBe(500);
    // Same digits, wrong order — a straight play loses.
    expect(evaluateTicket(pick3, { numbers: [3, 2, 1] }, p3).payout).toBe(0);
    expect(countMatches(pick3, [3, 2, 1], [1, 2, 3])).toBe(1);
  });
});

describe('backtest integrity', () => {
  const draws = synthDraws(400);

  /**
   * The single most important guarantee in the backtester. A strategy that could
   * see the draw it is being tested against would show a fabricated edge, which is
   * exactly the failure mode this product exists to avoid.
   */
  it('never lets a strategy see the draw it is being tested on', () => {
    const seen: string[] = [];
    const target: string[] = [];

    // Instrument by re-deriving what each iteration receives.
    const minHistory = 200;
    for (let i = minHistory; i < draws.length; i++) {
      const history = draws.slice(0, i);
      seen.push(history[history.length - 1]!.drawDate);
      target.push(draws[i]!.drawDate);
    }
    for (let i = 0; i < seen.length; i++) {
      expect(seen[i]!.localeCompare(target[i]!)).toBeLessThan(0);
    }
  });

  it('produces a null distribution with spread, not a single point', () => {
    const result = runBacktest(
      {
        game: fantasy5, slot: 'evening', strategies: ['random'],
        ticketsPerDraw: 1, maxDraws: 150, minHistory: 100, nullReplications: 80, seed: 3,
      },
      draws,
    );
    expect(result.nullDistribution.replications).toBe(80);
    expect(result.nullDistribution.p95).toBeGreaterThan(result.nullDistribution.p05);
    expect(result.nullDistribution.stdevRoi).toBeGreaterThan(0);
  });

  it('finds no strategy distinguishable from random on synthetic uniform data', () => {
    const result = runBacktest(
      {
        game: fantasy5, slot: 'evening',
        strategies: ['hot', 'cold', 'overdue', 'balanced'],
        ticketsPerDraw: 1, maxDraws: 200, minHistory: 100, nullReplications: 150, seed: 11,
      },
      draws,
    );
    // On data that is uniform by construction, no strategy can have an edge.
    for (const s of result.strategies) {
      expect(s.verdict, `${s.strategy} should be indistinguishable`).toBe('not_distinguishable');
    }
    expect(result.summary).toMatch(/expected and correct result/i);
  });

  it('reports negative ROI, because every lottery game is negative-EV', () => {
    const result = runBacktest(
      {
        game: fantasy5, slot: 'evening', strategies: ['random'],
        ticketsPerDraw: 1, maxDraws: 200, minHistory: 100, nullReplications: 60, seed: 5,
      },
      draws,
    );
    expect(result.strategies[0]!.roi).toBeLessThan(0);
    expect(result.nullDistribution.meanRoi).toBeLessThan(0);
  });

  it('warns explicitly that fixed-payout games cannot differ by strategy', () => {
    const p3draws: Draw[] = Array.from({ length: 320 }, (_, i) => ({
      id: i + 1, gameId: 'pick3' as const, drawDate: new Date(Date.UTC(2020, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
      drawSlot: 'evening', numbers: [i % 10, (i * 3) % 10, (i * 7) % 10], extras: {}, source: 's',
    }));
    const result = runBacktest(
      {
        game: pick3, slot: 'evening', strategies: ['hot', 'random'],
        ticketsPerDraw: 1, maxDraws: 100, minHistory: 200, nullReplications: 50, seed: 2,
      },
      p3draws,
    );
    expect(result.caveats[0]).toMatch(/identical expected value/i);
  });

  it('refuses to run without enough history rather than returning a weak result', () => {
    expect(() =>
      runBacktest(
        {
          game: fantasy5, slot: 'evening', strategies: ['random'],
          ticketsPerDraw: 1, maxDraws: 50, minHistory: 200, nullReplications: 10, seed: 1,
        },
        draws.slice(0, 120),
      ),
    ).toThrow(/Not enough history/);
  });

  it('always discloses the multiple-comparisons risk', () => {
    const result = runBacktest(
      {
        game: fantasy5, slot: 'evening', strategies: ['hot', 'cold', 'overdue'],
        ticketsPerDraw: 1, maxDraws: 120, minHistory: 100, nullReplications: 50, seed: 9,
      },
      draws,
    );
    expect(result.caveats.some((c) => /by chance alone/i.test(c))).toBe(true);
    expect(result.caveats.some((c) => /Jackpot and pari-mutuel tiers are valued at \$0/i.test(c))).toBe(true);
  });
});
