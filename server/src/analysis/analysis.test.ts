import { describe, it, expect } from 'vitest';
import { getGame, chiSquarePValue, normalCdf, choose, waysToMatch, makeRng, type Draw } from '@numberiq/shared';
import { runRandomnessAudit } from './randomness.js';
import { estimatePopularity, numberPopularityWeight } from './popularity.js';

const fantasy5 = getGame('fantasy5');

function makeDraws(count: number, pick: (rng: () => number) => number[], seed = 1): Draw[] {
  const rng = makeRng(seed);
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    gameId: 'fantasy5' as const,
    drawDate: new Date(Date.UTC(2010, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
    drawSlot: 'evening',
    numbers: pick(rng),
    extras: {},
    source: 'synthetic',
  }));
}

const uniformPick = (rng: () => number) => {
  const s = new Set<number>();
  while (s.size < 5) s.add(1 + Math.floor(rng() * 36));
  return [...s].sort((a, b) => a - b);
};

describe('statistical primitives match published critical values', () => {
  it('chi-square p-values match standard tables', () => {
    // Critical values at alpha = 0.05.
    expect(chiSquarePValue(3.841, 1)).toBeCloseTo(0.05, 3);
    expect(chiSquarePValue(11.070, 5)).toBeCloseTo(0.05, 3);
    expect(chiSquarePValue(18.307, 10)).toBeCloseTo(0.05, 3);
    expect(chiSquarePValue(49.802, 35)).toBeCloseTo(0.05, 3);
    // Critical values at alpha = 0.01.
    expect(chiSquarePValue(6.635, 1)).toBeCloseTo(0.01, 3);
    expect(chiSquarePValue(23.209, 10)).toBeCloseTo(0.01, 3);
  });

  it('a chi-square equal to its df gives a middling p-value', () => {
    expect(chiSquarePValue(35, 35)).toBeGreaterThan(0.4);
    expect(chiSquarePValue(35, 35)).toBeLessThan(0.6);
  });

  it('normal CDF matches known quantiles', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 4);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
    expect(normalCdf(2.576)).toBeCloseTo(0.995, 3);
  });

  it('combinatorics are exact', () => {
    expect(choose(36, 5)).toBe(376_992);
    expect(choose(69, 5)).toBe(11_238_513);
    expect(choose(10, 0)).toBe(1);
    expect(choose(5, 7)).toBe(0);
    expect(waysToMatch(36, 5, 5)).toBe(1);
    expect(waysToMatch(36, 5, 4)).toBe(155);
  });
});

describe('randomness audit', () => {
  it('passes fair uniform draws', () => {
    const audit = runRandomnessAudit(fantasy5, 'evening', makeDraws(4000, uniformPick, 42));
    expect(audit.verdict).toBe('consistent_with_random');
    for (const t of audit.tests) expect(t.significant, t.name).toBe(false);
  });

  /**
   * The audit is worthless if it can only ever say "looks fine". This feeds it a
   * machine with a genuinely weighted ball and asserts the frequency test catches it.
   */
  it('DETECTS a biased machine that over-draws one number', () => {
    const biased = makeDraws(3000, (rng) => {
      const s = new Set<number>();
      // Number 17 appears in ~45% of draws instead of ~14%.
      if (rng() < 0.45) s.add(17);
      while (s.size < 5) s.add(1 + Math.floor(rng() * 36));
      return [...s].sort((a, b) => a - b);
    }, 7);

    const audit = runRandomnessAudit(fantasy5, 'evening', biased);
    expect(audit.verdict).toBe('anomaly_detected');
    const freq = audit.tests.find((t) => t.name === 'Frequency uniformity')!;
    expect(freq.significant).toBe(true);
    expect(freq.pValue).toBeLessThan(0.001);
  });

  it('DETECTS serial dependence between consecutive draws', () => {
    // Each draw copies three numbers from the previous one — strongly non-independent.
    const rng = makeRng(3);
    let prev = uniformPick(rng);
    const dependent: Draw[] = Array.from({ length: 2000 }, (_, i) => {
      const s = new Set<number>(prev.slice(0, 3));
      while (s.size < 5) s.add(1 + Math.floor(rng() * 36));
      prev = [...s].sort((a, b) => a - b);
      return {
        id: i + 1, gameId: 'fantasy5' as const,
        drawDate: new Date(Date.UTC(2010, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
        drawSlot: 'evening', numbers: prev, extras: {}, source: 'synthetic',
      };
    });

    const audit = runRandomnessAudit(fantasy5, 'evening', dependent);
    expect(audit.verdict).toBe('anomaly_detected');
    const repeat = audit.tests.find((t) => t.name === 'Repeat rate from previous draw')!;
    expect(repeat.significant).toBe(true);
  });

  it('refuses to opine on a small sample', () => {
    const audit = runRandomnessAudit(fantasy5, 'evening', makeDraws(50, uniformPick));
    expect(audit.verdict).toBe('insufficient_data');
    expect(audit.tests).toHaveLength(0);
  });

  it('explains that a clean result undermines hot/cold reasoning', () => {
    const audit = runRandomnessAudit(fantasy5, 'evening', makeDraws(3000, uniformPick, 99));
    expect(audit.summary).toMatch(/no predictive value/i);
  });
});

describe('popularity model', () => {
  it('rates calendar numbers as more popular than high numbers', () => {
    expect(numberPopularityWeight(7)).toBeGreaterThan(numberPopularityWeight(35));
    expect(numberPopularityWeight(12)).toBeGreaterThan(numberPopularityWeight(45));
    // 13 is avoided as unlucky, so it is *less* popular than its neighbours.
    expect(numberPopularityWeight(13)).toBeLessThan(numberPopularityWeight(14));
  });

  it('flags arithmetic sequences as heavily over-picked', () => {
    const seq = estimatePopularity(fantasy5, [1, 2, 3, 4, 5], {});
    const ordinary = estimatePopularity(fantasy5, [3, 14, 22, 29, 35], {});
    expect(seq.index).toBeGreaterThan(ordinary.index);
    expect(seq.factors.some((f) => f.key === 'arithmetic')).toBe(true);
  });

  it('flags a combination that repeats a recent winning draw', () => {
    const recent: Draw[] = [{
      id: 1, gameId: 'fantasy5', drawDate: '2026-01-01', drawSlot: 'evening',
      numbers: [4, 11, 19, 27, 33], extras: {}, source: 't',
    }];
    const est = estimatePopularity(fantasy5, [4, 11, 19, 27, 33], { recentDraws: recent });
    expect(est.factors.some((f) => f.key === 'recent_winner')).toBe(true);
  });

  it('rates a spread of high numbers as less popular than an all-calendar ticket', () => {
    const high = estimatePopularity(getGame('powerball'), [38, 44, 52, 61, 67], {});
    const calendar = estimatePopularity(getGame('powerball'), [3, 8, 14, 22, 29], {});
    expect(high.index).toBeLessThan(calendar.index);
  });

  it('declines to apply at all on fixed-payout games', () => {
    for (const id of ['pick3', 'pick4', 'cashpop'] as const) {
      const est = estimatePopularity(getGame(id), [1, 2, 3].slice(0, getGame(id).pick), {});
      expect(est.index, id).toBe(50);
      expect(est.factors, id).toHaveLength(0);
      expect(est.summary, id).toMatch(/never split|no effect/i);
    }
  });

  it('keeps the index inside its stated bounds', () => {
    const extreme = estimatePopularity(fantasy5, [1, 2, 3, 4, 5], {});
    expect(extreme.index).toBeLessThanOrEqual(99);
    expect(extreme.index).toBeGreaterThanOrEqual(1);
  });
});
