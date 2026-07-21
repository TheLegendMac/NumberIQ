import { describe, it, expect } from 'vitest';
import { getGame, mean } from '../index.js';
import { generateTickets, isTrivialPattern, scoreTicket } from './generate.js';
import { estimatePopularity } from './popularity.js';

const fantasy5 = getGame('fantasy5');
const powerball = getGame('powerball');
const pick3 = getGame('pick3');

function popIndexes(strategy: 'unpopular' | 'random' | 'balanced', game = fantasy5, n = 60) {
  const out: number[] = [];
  for (let seed = 0; seed < n; seed++) {
    const { tickets } = generateTickets({
      game, history: [], strategy, count: 1, seed, batchMode: 'independent',
    });
    out.push(estimatePopularity(game, tickets[0]!.numbers, {}).index);
  }
  return out;
}

describe('generation validity', () => {
  it('produces the right number of distinct in-range numbers', () => {
    for (const game of [fantasy5, powerball]) {
      const { tickets } = generateTickets({ game, history: [], strategy: 'random', count: 25, seed: 1 });
      for (const t of tickets) {
        expect(t.numbers).toHaveLength(game.pick);
        expect(new Set(t.numbers).size).toBe(game.pick);
        for (const n of t.numbers) {
          expect(n).toBeGreaterThanOrEqual(game.min);
          expect(n).toBeLessThanOrEqual(game.max);
        }
      }
    }
  });

  it('digit games allow repeated digits and stay in 0-9', () => {
    const { tickets } = generateTickets({ game: pick3, history: [], strategy: 'random', count: 50, seed: 3 });
    for (const t of tickets) {
      expect(t.numbers).toHaveLength(3);
      for (const n of t.numbers) expect(n).toBeGreaterThanOrEqual(0), expect(n).toBeLessThanOrEqual(9);
    }
  });

  it('draws an extra ball within its pool', () => {
    const { tickets } = generateTickets({ game: powerball, history: [], strategy: 'random', count: 20, seed: 5 });
    for (const t of tickets) {
      const pb = t.extras.powerball!;
      expect(pb).toBeGreaterThanOrEqual(1);
      expect(pb).toBeLessThanOrEqual(26);
    }
  });

  it('honours exclusions', () => {
    const exclude = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const { tickets } = generateTickets({
      game: fantasy5, history: [], strategy: 'random', count: 20, exclude, seed: 9,
    });
    for (const t of tickets) for (const n of t.numbers) expect(exclude).not.toContain(n);
  });

  it('honours required numbers', () => {
    const { tickets } = generateTickets({
      game: fantasy5, history: [], strategy: 'random', count: 15, require: [7, 19], seed: 11,
    });
    for (const t of tickets) {
      expect(t.numbers).toContain(7);
      expect(t.numbers).toContain(19);
    }
  });

  it('never deadlocks when exclusions make a ticket impossible', () => {
    const exclude = Array.from({ length: 34 }, (_, i) => i + 1); // leaves only 2 of 36
    const { tickets, warnings } = generateTickets({
      game: fantasy5, history: [], strategy: 'random', count: 3, exclude, seed: 13,
    });
    expect(tickets).toHaveLength(3);
    expect(tickets[0]!.numbers).toHaveLength(5);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('is deterministic for a given seed', () => {
    const a = generateTickets({ game: fantasy5, history: [], strategy: 'balanced', count: 5, seed: 777 });
    const b = generateTickets({ game: fantasy5, history: [], strategy: 'balanced', count: 5, seed: 777 });
    expect(a.tickets.map((t) => t.numbers)).toEqual(b.tickets.map((t) => t.numbers));
  });

  it('low_overlap batches share fewer numbers than independent ones', () => {
    const low = generateTickets({ game: fantasy5, history: [], strategy: 'random', count: 8, batchMode: 'low_overlap', seed: 21 });
    const ind = generateTickets({ game: fantasy5, history: [], strategy: 'random', count: 8, batchMode: 'independent', seed: 21 });
    expect(low.batch.averageOverlap).toBeLessThanOrEqual(ind.batch.averageOverlap);
  });
});

describe('trivial pattern detection', () => {
  it('flags arithmetic sequences and long runs', () => {
    expect(isTrivialPattern(fantasy5, [1, 2, 3, 4, 5])).toBe(true);
    expect(isTrivialPattern(fantasy5, [5, 10, 15, 20, 25])).toBe(true);
    expect(isTrivialPattern(fantasy5, [11, 12, 13, 14, 30])).toBe(true);
  });

  it('flags single-decade combinations', () => {
    expect(isTrivialPattern(fantasy5, [21, 23, 25, 27, 29])).toBe(true);
  });

  it('accepts ordinary spreads', () => {
    expect(isTrivialPattern(fantasy5, [3, 14, 22, 29, 35])).toBe(false);
  });

  it('never flags digit games, where repeats are legitimate', () => {
    expect(isTrivialPattern(pick3, [1, 2, 3])).toBe(false);
    expect(isTrivialPattern(pick3, [7, 7, 7])).toBe(false);
  });
});

describe('EV-positive strategies actually optimise their objective', () => {
  /**
   * This is the load-bearing test for the product's only legitimate claim. If
   * "Unpopular Numbers" does not reliably produce less-popular combinations than
   * chance, the feature is decoration and should be removed rather than shipped.
   */
  it('unpopular beats random on estimated popularity, in a 5/36 game', () => {
    const unpopular = mean(popIndexes('unpopular'));
    const random = mean(popIndexes('random'));
    expect(unpopular).toBeLessThan(random);
    // Meaningful, not merely directional.
    expect(random - unpopular).toBeGreaterThan(5);
  });

  it('unpopular beats random by a wider margin in a 5/69 game', () => {
    const unpopular = mean(popIndexes('unpopular', powerball, 40));
    const random = mean(popIndexes('random', powerball, 40));
    expect(unpopular).toBeLessThan(random);
    // Powerball has far more numbers above 31, so there is more room to exploit.
    expect(random - unpopular).toBeGreaterThan(10);
  });

  it('balanced also lands below random on popularity', () => {
    expect(mean(popIndexes('balanced'))).toBeLessThan(mean(popIndexes('random')));
  });
});

describe('Strategy Score honesty', () => {
  it('drops the popularity component entirely on fixed-payout games', () => {
    const score = scoreTicket(pick3, [4, 7, 1], []);
    expect(score.components.some((c) => c.key === 'unpopularity')).toBe(false);
    expect(score.explanation).toMatch(/identical odds/i);
  });

  it('includes popularity on shared-prize games', () => {
    const score = scoreTicket(fantasy5, [3, 14, 22, 29, 35], []);
    expect(score.components.some((c) => c.key === 'unpopularity')).toBe(true);
  });

  it('component weights sum to 1', () => {
    for (const game of [pick3, fantasy5, powerball]) {
      const score = scoreTicket(game, game.kind === 'digits' ? [1, 2, 3] : [3, 14, 22, 29, 35], []);
      const total = score.components.reduce((s, c) => s + c.weight, 0);
      expect(total, game.name).toBeCloseTo(1, 6);
    }
  });

  it('stays within 0-100 and never expresses a probability', () => {
    for (let seed = 0; seed < 30; seed++) {
      const { tickets } = generateTickets({ game: fantasy5, history: [], strategy: 'random', count: 1, seed });
      const s = tickets[0]!.score;
      expect(s.total).toBeGreaterThanOrEqual(0);
      expect(s.total).toBeLessThanOrEqual(100);
      expect(s.explanation).not.toMatch(/%|chance of winning|probability of winning/i);
    }
  });

  it('penalises trivial patterns', () => {
    const trivial = scoreTicket(fantasy5, [1, 2, 3, 4, 5], []);
    const ordinary = scoreTicket(fantasy5, [3, 14, 22, 29, 35], []);
    expect(trivial.total).toBeLessThan(ordinary.total);
  });
});

describe('most_frequent strategy', () => {
  it('overwhelmingly picks the numbers drawn most across full history', () => {
    // Numbers 2, 9, 14, 21, 30 appear in every draw; nothing else is ever drawn.
    const hotSet = [2, 9, 14, 21, 30];
    const history = Array.from({ length: 120 }, (_, i) => ({
      id: i,
      gameId: 'fantasy5' as const,
      drawDate: `2020-01-${String((i % 28) + 1).padStart(2, '0')}`,
      drawSlot: 'evening',
      numbers: hotSet,
      extras: {},
      source: 'test',
    }));

    let fromHot = 0;
    let total = 0;
    for (let seed = 0; seed < 40; seed++) {
      const { tickets } = generateTickets({
        game: fantasy5, history, strategy: 'most_frequent', count: 1, seed, batchMode: 'independent',
      });
      for (const n of tickets[0]!.numbers) {
        total++;
        if (hotSet.includes(n)) fromHot++;
      }
    }
    // The most-drawn numbers should dominate — this is a deterministic-feeling mode.
    expect(fromHot / total).toBeGreaterThan(0.85);
  });
});
